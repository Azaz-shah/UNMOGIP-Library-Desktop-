import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDatabase, getDataDir } from './db/database.js';
import authRoutes from './routes/auth.js';
import bookRoutes from './routes/books.js';
import employeeRoutes from './routes/employees.js';
import borrowingRoutes from './routes/borrowings.js';
import reportRoutes from './routes/reports.js';
import notificationRoutes from './routes/notifications.js';
import scheduleDueDateChecks from './utils/scheduler.js';

// Load environment variables (optional — app has offline defaults)
dotenv.config();

export function createApp({ frontendDist = null } = {}) {
  const app = express();

  // Middleware
  app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5174'],
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/books', bookRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/members', employeeRoutes); // Alias for backward compatibility
  app.use('/api/borrowings', borrowingRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/notifications', notificationRoutes);

  // GET /api/stats - Legacy stats endpoint (maps to reports/stats)
  app.get('/api/stats', async (req, res) => {
    try {
      const { default: Book } = await import('./models/Book.js');
      const { default: Employee } = await import('./models/Employee.js');
      const { default: Borrowing } = await import('./models/Borrowing.js');

      const [totalBooks, totalMembers, activeBorrowings, overdueBooks] = await Promise.all([
        Book.countDocuments({ isActive: true }),
        Employee.countDocuments({ isActive: true }),
        Borrowing.countDocuments({ status: { $in: ['borrowed', 'overdue'] } }),
        Borrowing.countDocuments({
          status: { $in: ['borrowed', 'overdue'] },
          dueDate: { $lt: new Date() },
        }),
      ]);

      res.json({ totalBooks, totalMembers, totalEmployees: totalMembers, activeBorrowings, overdueBooks });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/settings - Get system settings (Rule 3.3)
  app.get('/api/settings', (req, res) => {
    res.json({
      borrowDurationDays: parseInt(process.env.BORROW_DURATION_DAYS || '30', 10),
      hrEmail: process.env.HR_EMAIL || '',
    });
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve the React production build (desktop app) with SPA fallback
  if (frontendDist) {
    const dist = path.resolve(frontendDist);
    if (fs.existsSync(dist)) {
      app.use(express.static(dist));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(dist, 'index.html'));
      });
    }
  }

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export async function startServer({ port = 5000, dbPath = null, frontendDist = null, quiet = false } = {}) {
  // Initialise the local SQLite database before any model is touched
  initDatabase(dbPath);

  // Writable uploads folder next to the DB file
  if (!process.env.UPLOADS_DIR) {
    const dir = path.join(getDataDir(), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    process.env.UPLOADS_DIR = dir;
  }

  const app = createApp({ frontendDist });

  // Start scheduled jobs (due-date checks)
  scheduleDueDateChecks();

  const server = await new Promise((resolve, reject) => {
    const srv = app.listen(port, () => resolve(srv));
    srv.on('error', reject);
  });

  if (!quiet) {
    console.log(`🚀 Server running on http://localhost:${port}`);
    console.log('📚 UNMOGIP Library Management API ready');
    console.log(`📋 Borrow duration: ${process.env.BORROW_DURATION_DAYS || 30} days`);
  }

  return { app, server, port, dbPath: getDataDir() };
}

// Allow `node server.js` to keep working as a standalone dev server
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const port = parseInt(process.env.PORT || '5000', 10);
  startServer({
    port,
    frontendDist: process.env.FRONTEND_DIST || null,
  }).catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}
