import bcrypt from 'bcryptjs';
import { createModel } from '../db/model.js';

export default createModel({
  name: 'User',
  table: 'users',
  columns: [
    { name: '_id', db: 'id', type: 'text' },
    { name: 'name', db: 'name', type: 'text' },
    { name: 'email', db: 'email', type: 'text' },
    { name: 'password', db: 'password', type: 'text' },
    { name: 'role', db: 'role', type: 'text' },
    { name: 'isActive', db: 'is_active', type: 'bool' },
    { name: 'createdAt', db: 'created_at', type: 'text' },
    { name: 'updatedAt', db: 'updated_at', type: 'text' },
  ],
  requireds: [
    { field: 'name', message: 'Name is required' },
    { field: 'email', message: 'Email is required' },
    { field: 'password', message: 'Password is required' },
  ],
  uniques: [{ field: 'email', label: 'Email' }],
  defaults: {
    role: 'employee',
    isActive: true,
  },
  normalize(doc) {
    if (doc.name != null) doc.name = String(doc.name).trim();
    if (doc.email != null) doc.email = String(doc.email).trim().toLowerCase();
  },
  async preSave(doc) {
    const pwd = doc.password || '';
    const looksHashed = /^\$2[aby]\$/.test(pwd);
    if (!looksHashed) {
      // Hash plaintext passwords only (new users or explicit password changes)
      doc.password = await bcrypt.hash(String(doc.password || ''), 12);
    }
  },
});
