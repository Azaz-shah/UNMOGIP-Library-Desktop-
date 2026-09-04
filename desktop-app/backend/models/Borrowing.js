import { createModel } from '../db/model.js';

const parseD = (v) => (v == null || v === '' ? null : new Date(v).getTime());

export default createModel({
  name: 'Borrowing',
  table: 'borrowings',
  columns: [
    { name: '_id', db: 'id', type: 'text' },
    { name: 'book', db: 'book', type: 'text' },
    { name: 'employee', db: 'employee', type: 'text' },
    { name: 'borrowedBy', db: 'borrowed_by', type: 'text' },
    { name: 'returnedTo', db: 'returned_to', type: 'text' },
    { name: 'borrowDate', db: 'borrow_date', type: 'text' },
    { name: 'dueDate', db: 'due_date', type: 'text' },
    { name: 'returnDate', db: 'return_date', type: 'text' },
    { name: 'status', db: 'status', type: 'text' },
    { name: 'isReturnedLate', db: 'is_returned_late', type: 'bool' },
    { name: 'notificationsSent', db: 'notifications_sent', type: 'json' },
    { name: 'issuedByScan', db: 'issued_by_scan', type: 'bool' },
    { name: 'returnedByScan', db: 'returned_by_scan', type: 'bool' },
    { name: 'notes', db: 'notes', type: 'text' },
    { name: 'createdAt', db: 'created_at', type: 'text' },
    { name: 'updatedAt', db: 'updated_at', type: 'text' },
  ],
  requireds: [
    { field: 'book', message: 'Book is required' },
    { field: 'employee', message: 'Employee is required' },
    { field: 'dueDate', message: 'Due date is required' },
  ],
  defaults: {
    status: 'borrowed',
    borrowDate: () => new Date().toISOString(),
    isReturnedLate: false,
    notificationsSent: { reminder1Day: false, reminderDueDate: false, overdueAlert: false },
    issuedByScan: false,
    returnedByScan: false,
    notes: '',
    returnDate: null,
  },
  preSave(doc, { isNew }) {
    const now = Date.now();
    // Update status based on dates (same behaviour as the Mongoose pre-save hooks)
    if (doc.status === 'borrowed' && doc.dueDate && parseD(doc.dueDate) < now) {
      doc.status = 'overdue';
    }
    if (doc.returnDate) {
      doc.status = 'returned';
      if (!doc.isReturnedLate && doc.dueDate && parseD(doc.returnDate) > parseD(doc.dueDate)) {
        doc.isReturnedLate = true;
      }
    }
    // Auto-calculate due date if not set
    if (isNew && !doc.dueDate) {
      const duration = parseInt(process.env.BORROW_DURATION_DAYS || '30', 10) || 30;
      const base = parseD(doc.borrowDate) || Date.now();
      doc.dueDate = new Date(base + duration * 24 * 60 * 60 * 1000).toISOString();
    }
    if (doc.notificationsSent == null) {
      doc.notificationsSent = { reminder1Day: false, reminderDueDate: false, overdueAlert: false };
    }
  },
  relations: {
    book: 'Book',
    employee: 'Employee',
    borrowedBy: 'User',
    returnedTo: 'User',
  },
});
