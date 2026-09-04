import { createModel } from '../db/model.js';

export default createModel({
  name: 'NotificationLog',
  table: 'notificationlogs',
  columns: [
    { name: '_id', db: 'id', type: 'text' },
    { name: 'transaction', db: 'transaction_id', type: 'text' },
    { name: 'type', db: 'type', type: 'text' },
    { name: 'sentTo', db: 'sent_to', type: 'json' },
    { name: 'sentAt', db: 'sent_at', type: 'text' },
    { name: 'status', db: 'status', type: 'text' },
    { name: 'attempts', db: 'attempts', type: 'int' },
    { name: 'maxAttempts', db: 'max_attempts', type: 'int' },
    { name: 'error', db: 'error', type: 'text' },
    { name: 'subject', db: 'subject', type: 'text' },
    { name: 'bookTitle', db: 'book_title', type: 'text' },
    { name: 'employeeName', db: 'employee_name', type: 'text' },
    { name: 'createdAt', db: 'created_at', type: 'text' },
    { name: 'updatedAt', db: 'updated_at', type: 'text' },
  ],
  requireds: [
    { field: 'transaction', message: 'Transaction is required' },
    { field: 'type', message: 'Type is required' },
  ],
  defaults: {
    status: 'Queued',
    sentTo: [],
    sentAt: () => new Date().toISOString(),
    attempts: 0,
    maxAttempts: 3,
    error: '',
    subject: '',
    bookTitle: '',
    employeeName: '',
  },
  relations: {
    transaction: 'Borrowing',
  },
});
