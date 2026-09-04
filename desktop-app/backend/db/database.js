import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db = null;
let dbFile = null;
let dataDir = null;

// Resolve where the SQLite file (and other runtime data like uploads) should live.
// Order: explicit path > DB_PATH env > ./data/library.sqlite next to the backend
export function resolveDataPaths(overridePath) {
  const file = overridePath || process.env.DB_PATH ||
    path.join(__dirname, '..', 'data', 'library.sqlite');
  return { file, dir: path.dirname(file) };
}

export function initDatabase(overridePath) {
  if (db) return db;
  const { file, dir } = resolveDataPaths(overridePath);
  fs.mkdirSync(dir, { recursive: true });
  dbFile = file;
  dataDir = dir;

  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export const getDb = () => db;
export const getDbFile = () => dbFile;
export const getDataDir = () => dataDir;

// ---- Schema (mirrors the old Mongoose models) ----
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT UNIQUE,
  barcode TEXT UNIQUE,
  barcode_sequence INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  year INTEGER,
  copies INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Available',
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  employee_id TEXT UNIQUE,
  barcode TEXT UNIQUE,
  department TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  is_active INTEGER NOT NULL DEFAULT 1,
  borrowing_history TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);

CREATE TABLE IF NOT EXISTS borrowings (
  id TEXT PRIMARY KEY,
  book TEXT NOT NULL,
  employee TEXT NOT NULL,
  borrowed_by TEXT,
  returned_to TEXT,
  borrow_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  return_date TEXT,
  status TEXT NOT NULL DEFAULT 'borrowed',
  is_returned_late INTEGER NOT NULL DEFAULT 0,
  notifications_sent TEXT NOT NULL DEFAULT '{"reminder1Day":false,"reminderDueDate":false,"overdueAlert":false}',
  issued_by_scan INTEGER NOT NULL DEFAULT 0,
  returned_by_scan INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_borrowings_book ON borrowings(book);
CREATE INDEX IF NOT EXISTS idx_borrowings_employee ON borrowings(employee);
CREATE INDEX IF NOT EXISTS idx_borrowings_status ON borrowings(status);
CREATE INDEX IF NOT EXISTS idx_borrowings_created_at ON borrowings(created_at);

CREATE TABLE IF NOT EXISTS notificationlogs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  type TEXT NOT NULL,
  sent_to TEXT NOT NULL DEFAULT '[]',
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'Queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  book_title TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notificationlogs_transaction ON notificationlogs(transaction_id, type);
CREATE INDEX IF NOT EXISTS idx_notificationlogs_status ON notificationlogs(status);
`;
