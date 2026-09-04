import express from 'express';
import Borrowing from '../models/Borrowing.js';
import Book from '../models/Book.js';
import Employee from '../models/Employee.js';
import User from '../models/User.js';
import NotificationLog from '../models/NotificationLog.js';
import { sendBorrowConfirmation, sendReturnConfirmation } from '../utils/email.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

// Debounce tracker for duplicate barcode scans (Rule 8: min 1.5s gap)
const scanTimestamps = new Map();
const DEBOUNCE_MS = 1500;

function checkDebounce(key) {
  const last = scanTimestamps.get(key);
  const now = Date.now();
  if (last && now - last < DEBOUNCE_MS) return false;
  scanTimestamps.set(key, now);
  return true;
}

// Log notification (Section 5)
async function logNotification(transactionId, type, recipients, subject, bookTitle, employeeName, error = '') {
  try {
    await NotificationLog.create({
      transaction: transactionId,
      type,
      sentTo: recipients,
      subject,
      bookTitle,
      employeeName,
      status: error ? 'Failed' : 'Sent',
      attempts: error ? 1 : 1,
      error,
    });
  } catch (err) {
    console.error('Notification log error:', err.message);
  }
}

// GET /api/borrowings - Get all borrowings
router.get('/', async (req, res) => {
  try {
    const { status, employee, book, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status) {
      if (status === 'overdue') {
        query.status = { $in: ['borrowed', 'overdue'] };
        query.dueDate = { $lt: new Date() };
      } else {
        query.status = status;
      }
    }
    if (employee) query.employee = employee;
    if (book) query.book = book;

    const total = await Borrowing.countDocuments(query);
    const borrowings = await Borrowing.find(query)
      .populate('book', 'title author isbn barcode')
      .populate('employee', 'name email employeeId barcode')
      .populate('borrowedBy', 'name')
      .populate('returnedTo', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ borrowings, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/borrowings/scan-issue - Barcode-based issue (Rule 3)
router.post('/scan-issue', protect, async (req, res) => {
  try {
    const { bookBarcode, employeeBarcode } = req.body;

    if (!bookBarcode || !employeeBarcode) {
      return res.status(400).json({ error: 'Both book barcode and employee barcode are required' });
    }

    // Debounce check (Rule 8)
    const debounceKey = `issue-${bookBarcode}-${employeeBarcode}`;
    if (!checkDebounce(debounceKey)) {
      return res.status(429).json({ error: 'Please wait before scanning again (1.5s debounce)' });
    }

    // Step 1: Find book by barcode (Rule 3.1)
    const book = await Book.findOne({
      $or: [{ barcode: bookBarcode }, { isbn: bookBarcode }],
      isActive: true,
    });
    if (!book) return res.status(404).json({ error: 'Invalid/Unregistered Book' });

    // Rule 2.3: Check book status
    if (book.status === 'Lost') {
      return res.status(400).json({ error: 'This book has been marked as Lost' });
    }
    if (book.available <= 0) {
      // Find who has it issued
      const activeBorrowing = await Borrowing.findOne({
        book: book._id,
        status: { $in: ['borrowed', 'overdue'] },
      }).populate('employee', 'name');
      const issuedTo = activeBorrowing?.employee?.name || 'Unknown';
      const dueDate = activeBorrowing?.dueDate?.toLocaleDateString() || '';
      const borrowDate = activeBorrowing?.borrowDate?.toLocaleDateString() || '';
      return res.status(400).json({
        error: `Book already issued to ${issuedTo} on ${borrowDate}, due ${dueDate}`,
      });
    }

    // Step 2: Find employee by barcode (Rule 3.2)
    const employee = await Employee.findOne({
      $or: [{ barcode: employeeBarcode }, { employeeId: employeeBarcode }],
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found with this barcode/ID' });
    }

    // Rule 8: Block inactive employees
    if (!employee.isActive || employee.status === 'Inactive') {
      return res.status(403).json({
        error: `Employee "${employee.name}" is Inactive/Offboarded and cannot borrow books`,
      });
    }

    // Rule 3.2: Check if employee already has this book
    const existingBorrowing = await Borrowing.findOne({
      book: book._id,
      employee: employee._id,
      status: { $in: ['borrowed', 'overdue'] },
    });
    if (existingBorrowing) {
      return res.status(400).json({ error: 'Employee already has this book checked out' });
    }

    // Step 3: Calculate due date (Rule 3.3)
    const borrowDuration = parseInt(process.env.BORROW_DURATION_DAYS || '30');
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + borrowDuration);

    // Step 4: Create Transaction record (Rule 3.4)
    const borrowing = await Borrowing.create({
      book: book._id,
      employee: employee._id,
      borrowedBy: req.user._id,
      dueDate,
      issuedByScan: true,
    });

    // Update Book status -> ISSUED, availableCopies -1 (Rule 3.4)
    book.available -= 1;
    await book.save();

    // Update employee borrowing history
    employee.borrowingHistory.push({
      book: book._id,
      borrowDate: new Date(),
      dueDate,
      status: 'borrowed',
    });
    await employee.save();

    // Rule 5A: Send notification emails (queued)
    const emailRecipients = [employee.email];
    if (process.env.HR_EMAIL && process.env.HR_EMAIL !== 'hr@unmogip.org') {
      emailRecipients.push(process.env.HR_EMAIL);
    }

    try {
      const admin = await User.findById(req.user._id).select('name email');
      await sendBorrowConfirmation(employee, book, dueDate, admin);
      await logNotification(borrowing._id, 'BorrowConfirmation', emailRecipients,
        `Book Issued: ${book.title}`, book.title, employee.name);
    } catch (emailErr) {
      console.log('Borrow email failed:', emailErr.message);
      await logNotification(borrowing._id, 'BorrowConfirmation', emailRecipients,
        `Book Issued: ${book.title}`, book.title, employee.name, emailErr.message);
    }

    // Populate and return
    await borrowing.populate([
      { path: 'book', select: 'title author isbn barcode' },
      { path: 'employee', select: 'name email employeeId barcode' },
      { path: 'borrowedBy', select: 'name email' },
    ]);

    res.status(201).json(borrowing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/borrowings/scan-return - Barcode-based return (Rule 4)
router.post('/scan-return', protect, async (req, res) => {
  try {
    const { borrowingId, bookBarcode, employeeBarcode } = req.body;

    let borrowing;

    if (borrowingId) {
      borrowing = await Borrowing.findById(borrowingId);
    } else if (bookBarcode && employeeBarcode) {
      // Debounce check (Rule 8)
      const debounceKey = `return-${bookBarcode}-${employeeBarcode}`;
      if (!checkDebounce(debounceKey)) {
        return res.status(429).json({ error: 'Please wait before scanning again (1.5s debounce)' });
      }

      const book = await Book.findOne({
        $or: [{ barcode: bookBarcode }, { isbn: bookBarcode }],
      });
      const employee = await Employee.findOne({
        $or: [{ barcode: employeeBarcode }, { employeeId: employeeBarcode }],
      });

      if (!book || !employee) {
        return res.status(404).json({ error: 'Book or Employee not found' });
      }

      borrowing = await Borrowing.findOne({
        book: book._id,
        employee: employee._id,
        status: { $in: ['borrowed', 'overdue'] },
      });
    } else {
      return res.status(400).json({ error: 'Provide borrowingId or both barcodes' });
    }

    if (!borrowing) {
      return res.status(404).json({ error: 'No active borrowing found for this book/employee combination' });
    }

    // Rule 4.2: Validate employee match
    if (bookBarcode && employeeBarcode) {
      const scannedEmployee = await Employee.findOne({
        $or: [{ barcode: employeeBarcode }, { employeeId: employeeBarcode }],
      });
      if (scannedEmployee && scannedEmployee._id.toString() !== borrowing.employee.toString()) {
        // Allow override but warn (Rule 4.2)
        if (!req.body.confirmOverride) {
          return res.status(400).json({
            error: `Book is issued to ${borrowing.employee?.name || 'another employee'}. Confirm override to return.`,
            requiresOverride: true,
          });
        }
      }
    }

    // Process return
    borrowing.returnDate = new Date();
    borrowing.status = 'returned';
    borrowing.returnedByScan = true;
    borrowing.returnedTo = req.user._id;

    // Rule 4.3: Mark returned late if past due date
    if (new Date() > borrowing.dueDate) {
      borrowing.isReturnedLate = true;
    }

    await borrowing.save();

    // Update book availability
    const book = await Book.findById(borrowing.book);
    if (book) {
      book.available = Math.min(book.available + 1, book.copies);
      await book.save();
    }

    // Update employee borrowing history
    const employee = await Employee.findById(borrowing.employee);
    if (employee) {
      const historyEntry = employee.borrowingHistory.find(
        (h) => h.book.toString() === borrowing.book.toString() && h.status !== 'returned'
      );
      if (historyEntry) {
        historyEntry.returnDate = new Date();
        historyEntry.status = 'returned';
        await employee.save();
      }
    }

    // Rule 5C: Send return confirmation email
    const emailRecipients = [];
    if (employee) emailRecipients.push(employee.email);
    if (process.env.HR_EMAIL && process.env.HR_EMAIL !== 'hr@unmogip.org') {
      emailRecipients.push(process.env.HR_EMAIL);
    }

    if (employee && book) {
      try {
        await sendReturnConfirmation(employee, book, borrowing.dueDate, borrowing.isReturnedLate);
        await logNotification(borrowing._id, 'ReturnConfirmation', emailRecipients,
          `Book Returned: ${book.title}`, book.title, employee.name);
      } catch (emailErr) {
        console.log('Return email failed:', emailErr.message);
        await logNotification(borrowing._id, 'ReturnConfirmation', emailRecipients,
          `Book Returned: ${book.title}`, book.title, employee.name, emailErr.message);
      }
    }

    await borrowing.populate([
      { path: 'book', select: 'title author isbn barcode' },
      { path: 'employee', select: 'name email employeeId barcode' },
    ]);

    res.json(borrowing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/borrowings - Manual issue (Rule 3)
// Public: the self-service kiosk issues books without a logged-in admin
router.post('/', async (req, res) => {
  try {
    const { bookId, employeeId, dueDate } = req.body;

    if (!bookId || !employeeId) {
      return res.status(400).json({ error: 'Book and Employee are required' });
    }

    const book = await Book.findById(bookId);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    if (book.status === 'Lost') return res.status(400).json({ error: 'This book has been marked as Lost' });
    if (book.available <= 0) return res.status(400).json({ error: 'No copies available' });

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    // Rule 8: Block inactive employees
    if (!employee.isActive || employee.status === 'Inactive') {
      return res.status(403).json({
        error: `Employee "${employee.name}" is Inactive/Offboarded and cannot borrow books`,
      });
    }

    // Rule 3.3: Configurable duration
    const borrowDuration = parseInt(process.env.BORROW_DURATION_DAYS || '30');
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + borrowDuration * 24 * 60 * 60 * 1000);

    const borrowing = await Borrowing.create({
      book: bookId,
      employee: employeeId,
      borrowedBy: req.user?._id,
      dueDate: finalDueDate,
    });

    book.available -= 1;
    await book.save();

    employee.borrowingHistory.push({
      book: bookId,
      borrowDate: new Date(),
      dueDate: finalDueDate,
      status: 'borrowed',
    });
    await employee.save();

    const emailRecipients = [employee.email];
    if (process.env.HR_EMAIL && process.env.HR_EMAIL !== 'hr@unmogip.org') {
      emailRecipients.push(process.env.HR_EMAIL);
    }

    const admin = req.user ? await User.findById(req.user._id).select('name email') : null;
    try {
      await sendBorrowConfirmation(employee, book, finalDueDate, admin);
      await logNotification(borrowing._id, 'BorrowConfirmation', emailRecipients,
        `Book Issued: ${book.title}`, book.title, employee.name);
    } catch (emailErr) {
      console.log('Borrow email skipped:', emailErr.message);
      await logNotification(borrowing._id, 'BorrowConfirmation', emailRecipients,
        `Book Issued: ${book.title}`, book.title, employee.name, emailErr.message);
    }

    await borrowing.populate([
      { path: 'book', select: 'title author isbn barcode' },
      { path: 'employee', select: 'name email employeeId barcode' },
      { path: 'borrowedBy', select: 'name email' },
    ]);

    res.status(201).json(borrowing);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/borrowings/:id/return - Manual return (Rule 4)
// Public: the self-service kiosk processes returns without a logged-in admin
router.put('/:id/return', async (req, res) => {
  try {
    const borrowing = await Borrowing.findById(req.params.id);
    if (!borrowing) return res.status(404).json({ error: 'Borrowing not found' });
    if (borrowing.status === 'returned') return res.status(400).json({ error: 'Already returned' });

    borrowing.returnDate = new Date();
    borrowing.returnedByScan = false;
    borrowing.returnedTo = req.user?._id;

    // Rule 4.3: Mark returned late
    if (new Date() > borrowing.dueDate) {
      borrowing.isReturnedLate = true;
    }

    await borrowing.save();

    const book = await Book.findById(borrowing.book);
    if (book) {
      book.available = Math.min(book.available + 1, book.copies);
      await book.save();
    }

    const employee = await Employee.findById(borrowing.employee);
    if (employee) {
      const historyEntry = employee.borrowingHistory.find(
        (h) => h.book.toString() === borrowing.book.toString() && h.status !== 'returned'
      );
      if (historyEntry) {
        historyEntry.returnDate = new Date();
        historyEntry.status = 'returned';
        await employee.save();
      }
    }

    const emailRecipients = [];
    if (employee) emailRecipients.push(employee.email);
    if (process.env.HR_EMAIL && process.env.HR_EMAIL !== 'hr@unmogip.org') {
      emailRecipients.push(process.env.HR_EMAIL);
    }

    if (employee && book) {
      try {
        await sendReturnConfirmation(employee, book, borrowing.dueDate, borrowing.isReturnedLate);
        await logNotification(borrowing._id, 'ReturnConfirmation', emailRecipients,
          `Book Returned: ${book.title}`, book.title, employee.name);
      } catch (emailErr) {
        console.log('Return email skipped:', emailErr.message);
        await logNotification(borrowing._id, 'ReturnConfirmation', emailRecipients,
          `Book Returned: ${book.title}`, book.title, employee.name, emailErr.message);
      }
    }

    await borrowing.populate([
      { path: 'book', select: 'title author isbn barcode' },
      { path: 'employee', select: 'name email employeeId barcode' },
    ]);

    res.json(borrowing);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
