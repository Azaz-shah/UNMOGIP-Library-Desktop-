import { createModel } from '../db/model.js';

export default createModel({
  name: 'Employee',
  table: 'employees',
  columns: [
    { name: '_id', db: 'id', type: 'text' },
    { name: 'name', db: 'name', type: 'text' },
    { name: 'email', db: 'email', type: 'text' },
    { name: 'phone', db: 'phone', type: 'text' },
    { name: 'employeeId', db: 'employee_id', type: 'text' },
    { name: 'barcode', db: 'barcode', type: 'text' },
    { name: 'department', db: 'department', type: 'text' },
    { name: 'designation', db: 'designation', type: 'text' },
    { name: 'status', db: 'status', type: 'text' },
    { name: 'isActive', db: 'is_active', type: 'bool' },
    { name: 'borrowingHistory', db: 'borrowing_history', type: 'json' },
    { name: 'createdAt', db: 'created_at', type: 'text' },
    { name: 'updatedAt', db: 'updated_at', type: 'text' },
  ],
  requireds: [
    { field: 'name', message: 'Name is required' },
    { field: 'email', message: 'Email is required' },
  ],
  uniques: [
    { field: 'email', label: 'Email' },
    { field: 'employeeId', label: 'Employee ID' },
    { field: 'barcode', label: 'Barcode' },
  ],
  defaults: {
    phone: '',
    department: '',
    designation: '',
    status: 'Active',
    isActive: true,
    borrowingHistory: [],
  },
  normalize(doc) {
    if (doc.name != null) doc.name = String(doc.name).trim();
    if (doc.email != null) doc.email = String(doc.email).trim().toLowerCase();
    ['phone', 'department', 'designation'].forEach((f) => {
      if (doc[f] != null) doc[f] = String(doc[f]).trim();
    });
  },
  preSave(doc) {
    // Generate barcode before saving if not provided (Rule 6a)
    if (!doc.barcode) {
      doc.barcode = `EMP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    }
    if (!doc.employeeId) {
      doc.employeeId = `UNMOGIP-${String(Date.now()).slice(-6)}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    }
    if (doc.status !== 'Inactive') doc.status = doc.status || 'Active';
    if (!Array.isArray(doc.borrowingHistory)) doc.borrowingHistory = [];
  },
  nestedPopulates: {
    'borrowingHistory.book': 'Book',
  },
  virtuals: {
    canBorrow(doc) {
      return !!doc.isActive && doc.status === 'Active';
    },
  },
});
