import express from 'express';
import Employee from '../models/Employee.js';
import Borrowing from '../models/Borrowing.js';
import { sendMemberWelcome } from '../utils/email.js';
import { generateBarcodeDataURL } from '../utils/barcode.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// GET /api/employees - Get all employees with issued book counts
router.get('/', async (req, res) => {
  try {
    const { search, department, status, page = 1, limit = 50 } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ];
    }
    if (department) query.department = department;
    if (status === 'Active') { query.isActive = true; query.status = 'Active'; }
    if (status === 'Inactive') { query.$or = [{ isActive: false }, { status: 'Inactive' }]; }

    const total = await Employee.countDocuments(query);
    const employees = await Employee.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Count currently issued books per employee
    const employeeIds = employees.map(e => e._id);
    const issuedCounts = await Borrowing.aggregate([
      { $match: { employee: { $in: employeeIds }, status: 'borrowed' } },
      { $group: { _id: '$employee', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    issuedCounts.forEach(c => { countMap[c._id.toString()] = c.count; });

    const result = employees.map(e => ({
      ...e.toJSON(),
      issuedBooks: countMap[e._id.toString()] || 0,
    }));

    res.json({ employees: result, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/employees/lookup/:barcode - Lookup employee by barcode scan
router.get('/lookup/:barcode', async (req, res) => {
  try {
    const employee = await Employee.findOne({
      $or: [
        { barcode: req.params.barcode },
        { employeeId: req.params.barcode },
      ],
      isActive: true,
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/employees/:id - Get single employee with borrowing history
router.get('/:id', async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id)
      .populate('borrowingHistory.book', 'title author isbn barcode');

    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/employees/:id/barcode - Get employee barcode image
router.get('/:id/barcode', async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const barcodeBuffer = await generateBarcodeDataURL(employee.barcode);
    res.json({ barcode: barcodeBuffer, data: employee.barcode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/employees - Create employee
// Public: the self-service kiosk registers new members without a logged-in admin
router.post('/', async (req, res) => {
  try {
    const employee = await Employee.create(req.body);

    // Send welcome email
    try {
      await sendMemberWelcome(employee);
    } catch (emailErr) {
      console.log('Welcome email skipped:', emailErr.message);
    }

    res.status(201).json(employee);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/employees/:id - Update employee
router.put('/:id', protect, async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/employees/:id - Soft delete employee
router.delete('/:id', protect, async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json({ message: 'Employee removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
