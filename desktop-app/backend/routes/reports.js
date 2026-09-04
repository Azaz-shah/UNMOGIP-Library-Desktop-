import express from 'express';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import Borrowing from '../models/Borrowing.js';
import Book from '../models/Book.js';
import Employee from '../models/Employee.js';
import NotificationLog from '../models/NotificationLog.js';

const router = express.Router();

// GET /api/reports/stats - Dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    const totalBooks = await Book.countDocuments({ isActive: true });
    const totalEmployees = await Employee.countDocuments({ isActive: true });
    const activeBorrowings = await Borrowing.countDocuments({ status: { $in: ['borrowed', 'overdue'] } });
    const overdueBooks = await Borrowing.countDocuments({
      status: { $in: ['borrowed', 'overdue'] },
      dueDate: { $lt: new Date() },
    });
    const totalBorrowings = await Borrowing.countDocuments();
    const returnedBooks = await Borrowing.countDocuments({ status: 'returned' });
    const returnedLate = await Borrowing.countDocuments({ isReturnedLate: true });

    // Most borrowed books
    const mostBorrowed = await Borrowing.aggregate([
      { $group: { _id: '$book', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'books', localField: '_id', foreignField: '_id', as: 'book' } },
      { $unwind: '$book' },
      { $project: { title: '$book.title', author: '$book.author', count: 1 } },
    ]);

    res.json({
      totalBooks,
      totalMembers: totalEmployees,
      totalEmployees,
      activeBorrowings,
      overdueBooks,
      totalBorrowings,
      returnedBooks,
      returnedLate,
      mostBorrowed,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/most-borrowed - Most borrowed books report (Rule 7A: date range filter)
router.get('/most-borrowed', async (req, res) => {
  try {
    const { limit = 10, startDate, endDate } = req.query;

    const matchStage = {};
    if (startDate || endDate) {
      matchStage.borrowDate = {};
      if (startDate) matchStage.borrowDate.$gte = new Date(startDate);
      if (endDate) matchStage.borrowDate.$lte = new Date(endDate);
    }

    const pipeline = [];
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push(
      { $group: { _id: '$book', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit) },
      { $lookup: { from: 'books', localField: '_id', foreignField: '_id', as: 'book' } },
      { $unwind: '$book' },
      { $project: { title: '$book.title', author: '$book.author', isbn: '$book.isbn', count: 1 } }
    );

    const report = await Borrowing.aggregate(pipeline);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/overdue - Overdue books report (Rule 7B)
router.get('/overdue', async (req, res) => {
  try {
    const overdue = await Borrowing.find({
      status: { $in: ['borrowed', 'overdue'] },
      dueDate: { $lt: new Date() },
    })
      .populate('book', 'title author isbn barcode')
      .populate('employee', 'name email employeeId department')
      .sort({ dueDate: 1 });

    const report = overdue.map((b) => ({
      bookTitle: b.book?.title,
      author: b.book?.author,
      barcode: b.book?.barcode,
      employeeName: b.employee?.name,
      employeeId: b.employee?.employeeId,
      department: b.employee?.department,
      email: b.employee?.email,
      borrowDate: b.borrowDate,
      dueDate: b.dueDate,
      daysOverdue: Math.ceil((Date.now() - new Date(b.dueDate)) / (1000 * 60 * 60 * 24)),
    }));

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/employee-wise - Employee-wise borrowing history (Rule 7C)
router.get('/employee-wise', async (req, res) => {
  try {
    const { employeeId } = req.query;
    const query = {};
    if (employeeId) query.employee = employeeId;

    const report = await Borrowing.find(query)
      .populate('book', 'title author isbn barcode')
      .populate('employee', 'name email employeeId department')
      .sort({ borrowDate: -1 });

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/stock - Stock/inventory report (Rule 7D: includes Lost)
router.get('/stock', async (req, res) => {
  try {
    const books = await Book.find({ isActive: true })
      .select('title author isbn category copies available barcode status')
      .sort({ title: 1 });

    const report = books.map((b) => ({
      title: b.title,
      author: b.author,
      isbn: b.isbn,
      category: b.category,
      totalCopies: b.copies,
      available: b.available,
      issued: b.copies - b.available,
      lost: b.status === 'Lost' ? 1 : 0,
      barcode: b.barcode,
      status: b.status === 'Lost' ? 'Lost' :
              b.available === 0 ? 'Out of Stock' :
              b.available < b.copies ? 'Low Stock' : 'In Stock',
    }));

    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/notification-log - Notification delivery log (Section 5)
router.get('/notification-log', async (req, res) => {
  try {
    const logs = await NotificationLog.find({})
      .populate('transaction', 'book employee')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/export/pdf/:type - Export report as PDF
router.get('/export/pdf/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate } = req.query;
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-report.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('UNMOGIP Library Management', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).font('Helvetica').text(`${type.replace(/-/g, ' ').toUpperCase()} Report`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
    if (startDate || endDate) {
      doc.moveDown(0.2);
      doc.text(`Period: ${startDate || 'Start'} to ${endDate || 'Now'}`, { align: 'center' });
    }
    doc.moveDown(1);

    // Divider
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#ccc');
    doc.moveDown(0.5);

    if (type === 'overdue') {
      const data = await Borrowing.find({
        status: { $in: ['borrowed', 'overdue'] },
        dueDate: { $lt: new Date() },
      }).populate('book', 'title author').populate('employee', 'name employeeId');

      doc.fontSize(11).font('Helvetica-Bold').text(`Total Overdue: ${data.length}`);
      doc.moveDown(0.5);

      data.forEach((b, i) => {
        doc.fontSize(9).font('Helvetica')
          .text(`${i + 1}. "${b.book?.title}" by ${b.employee?.name} (${b.employee?.employeeId}) - Due: ${new Date(b.dueDate).toLocaleDateString()} - ${Math.ceil((Date.now() - new Date(b.dueDate)) / (1000 * 60 * 60 * 24))} days overdue`);
        doc.moveDown(0.2);
      });
    } else if (type === 'stock') {
      const data = await Book.find({ isActive: true }).sort({ title: 1 });
      doc.fontSize(11).font('Helvetica-Bold').text(`Total Books: ${data.length}`);
      doc.moveDown(0.5);

      data.forEach((b, i) => {
        doc.fontSize(9).font('Helvetica')
          .text(`${i + 1}. "${b.title}" by ${b.author} — ${b.available}/${b.copies} available [${b.status}]`);
        doc.moveDown(0.2);
      });
    } else if (type === 'most-borrowed') {
      const matchStage = {};
      if (startDate || endDate) {
        matchStage.borrowDate = {};
        if (startDate) matchStage.borrowDate.$gte = new Date(startDate);
        if (endDate) matchStage.borrowDate.$lte = new Date(endDate);
      }

      const pipeline = [];
      if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });

      pipeline.push(
        { $group: { _id: '$book', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
        { $lookup: { from: 'books', localField: '_id', foreignField: '_id', as: 'book' } },
        { $unwind: '$book' },
      );

      const data = await Borrowing.aggregate(pipeline);

      data.forEach((item, i) => {
        doc.fontSize(9).font('Helvetica')
          .text(`${i + 1}. "${item.book?.title}" — Borrowed ${item.count} times`);
        doc.moveDown(0.2);
      });
    } else if (type === 'employee-wise') {
      const records = await Borrowing.find({})
        .populate('book', 'title author')
        .populate('employee', 'name employeeId department');

      records.forEach((b, i) => {
        doc.fontSize(9).font('Helvetica')
          .text(`${i + 1}. ${b.employee?.name} (${b.employee?.employeeId}) borrowed "${b.book?.title}" - ${b.status}${b.isReturnedLate ? ' (Late)' : ''}`);
        doc.moveDown(0.2);
      });
    }

    doc.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/export/excel/:type - Export report as Excel
router.get('/export/excel/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { startDate, endDate } = req.query;
    const wb = XLSX.utils.book_new();
    let data = [];
    let headers = [];

    if (type === 'stock') {
      const books = await Book.find({ isActive: true }).sort({ title: 1 });
      headers = ['Title', 'Author', 'ISBN', 'Category', 'Total Copies', 'Available', 'Issued', 'Status'];
      data = books.map((b) => [
        b.title, b.author, b.isbn, b.category,
        b.copies, b.available, b.copies - b.available,
        b.status === 'Lost' ? 'Lost' : b.available === 0 ? 'Out of Stock' : 'In Stock',
      ]);
    } else if (type === 'overdue') {
      const overdue = await Borrowing.find({
        status: { $in: ['borrowed', 'overdue'] },
        dueDate: { $lt: new Date() },
      }).populate('book', 'title author').populate('employee', 'name employeeId email');
      headers = ['Book', 'Author', 'Employee', 'Employee ID', 'Email', 'Borrow Date', 'Due Date', 'Days Overdue'];
      data = overdue.map((b) => [
        b.book?.title, b.book?.author, b.employee?.name, b.employee?.employeeId,
        b.employee?.email, b.borrowDate?.toLocaleDateString(), b.dueDate?.toLocaleDateString(),
        Math.ceil((Date.now() - new Date(b.dueDate)) / (1000 * 60 * 60 * 24)),
      ]);
    } else if (type === 'employee-wise') {
      const records = await Borrowing.find({})
        .populate('book', 'title author')
        .populate('employee', 'name employeeId department');
      headers = ['Employee', 'Employee ID', 'Department', 'Book', 'Author', 'Borrow Date', 'Due Date', 'Return Date', 'Status', 'Returned Late'];
      data = records.map((b) => [
        b.employee?.name, b.employee?.employeeId, b.employee?.department,
        b.book?.title, b.book?.author,
        b.borrowDate?.toLocaleDateString(), b.dueDate?.toLocaleDateString(),
        b.returnDate?.toLocaleDateString() || '—', b.status,
        b.isReturnedLate ? 'Yes' : 'No',
      ]);
    } else if (type === 'most-borrowed') {
      const matchStage = {};
      if (startDate || endDate) {
        matchStage.borrowDate = {};
        if (startDate) matchStage.borrowDate.$gte = new Date(startDate);
        if (endDate) matchStage.borrowDate.$lte = new Date(endDate);
      }
      const pipeline = [];
      if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });
      pipeline.push(
        { $group: { _id: '$book', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
        { $lookup: { from: 'books', localField: '_id', foreignField: '_id', as: 'book' } },
        { $unwind: '$book' },
      );
      const agg = await Borrowing.aggregate(pipeline);
      headers = ['Rank', 'Title', 'Author', 'ISBN', 'Times Borrowed'];
      data = agg.map((item, i) => [
        i + 1, item.book?.title, item.book?.author, item.book?.isbn, item.count,
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    XLSX.utils.book_append_sheet(wb, ws, type.replace(/-/g, ' '));

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-report.xlsx`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/overdue-trend - Overdue trend for last 30 days
router.get('/overdue-trend', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const today = new Date();
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));

      const count = await Borrowing.countDocuments({
        status: { $in: ['borrowed', 'overdue'] },
        dueDate: { $lt: endOfDay },
      });

      trend.push({
        date: startOfDay.toISOString().split('T')[0],
        count,
      });
    }

    res.json(trend);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reports/most-borrowed-categories - Category borrow counts for chart
router.get('/most-borrowed-categories', async (req, res) => {
  try {
    const pipeline = [
      { $lookup: { from: 'books', localField: 'book', foreignField: '_id', as: 'bookInfo' } },
      { $unwind: '$bookInfo' },
      { $group: { _id: '$bookInfo.category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      { $project: { category: '$_id', count: 1, _id: 0 } },
    ];

    const categories = await Borrowing.aggregate(pipeline);

    // If no borrowings, get categories from books
    if (categories.length === 0) {
      const bookCategories = await Book.aggregate([
        { $match: { isActive: true, category: { $exists: true, $ne: '' } } },
        { $group: { _id: '$category', count: { $sum: '$copies' } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
        { $project: { category: '$_id', count: 1, _id: 0 } },
      ]);
      return res.json(bookCategories);
    }

    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
