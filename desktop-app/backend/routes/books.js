import express from 'express';
import multer from 'multer';
import csvParser from 'csv-parser';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import Book from '../models/Book.js';
import { generateBarcodeDataURL } from '../utils/barcode.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();
// Uploaded files (bulk import) live in the app's writable data folder, never in the install dir
const upload = multer({
  dest: (req, file, cb) => {
    const dir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    cb(null, dir);
  },
});

// GET /api/books - Get all books with search & filter
router.get('/', async (req, res) => {
  try {
    const { search, category, status, page = 1, limit = 50 } = req.query;
    const query = { isActive: true };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } },
        { isbn: { $regex: search, $options: 'i' } },
        { barcode: { $regex: search, $options: 'i' } },
      ];
    }
    if (category) query.category = category;
    if (status === 'available') query.available = { $gt: 0 };
    if (status === 'unavailable') query.available = 0;
    if (status === 'lost') query.status = 'Lost';

    const total = await Book.countDocuments(query);
    const books = await Book.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({ books, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/books/categories - Get all categories
router.get('/categories', async (req, res) => {
  try {
    const categories = await Book.distinct('category', { isActive: true, category: { $ne: '' } });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/books/:id - Get single book
router.get('/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/books/:id/barcode - Get book barcode as image
router.get('/:id/barcode', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });

    const barcodeData = book.barcode || book.isbn || book._id.toString();
    const barcodeBuffer = await generateBarcodeDataURL(barcodeData, { includetext: false });
    res.json({ barcode: barcodeBuffer, data: barcodeData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/books - Create book (Rule 2.1)
router.post('/', protect, async (req, res) => {
  try {
    const book = await Book.create(req.body);
    res.status(201).json(book);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/books/:id - Update book
router.put('/:id', protect, async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/books/:id/mark-lost - Mark book as Lost (Rule 2.3 & 8)
router.put('/:id/mark-lost', protect, async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(
      req.params.id,
      { status: 'Lost', available: 0 },
      { new: true }
    );
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json(book);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/books/:id - Soft delete book
router.delete('/:id', protect, async (req, res) => {
  try {
    const book = await Book.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json({ message: 'Book removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/books/import/csv - Bulk import with validation (Rule 2.2)
router.post('/import/csv', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const results = [];
    const warnings = [];
    const errors = [];
    let imported = 0;
    let copiesCreated = 0;
    let skipped = 0;

    // Parse file
    if (req.file.originalname.endsWith('.csv')) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csvParser())
          .on('data', (row) => results.push(row))
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (req.file.originalname.match(/\.(xlsx|xls)$/)) {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      results.push(...XLSX.utils.sheet_to_json(sheet));
    }

    // Rule 2.2: Validate and import each row
    for (let i = 0; i < results.length; i++) {
      const row = results[i];
      const title = row.title || row.Title || '';
      const author = row.author || row.Author || row['Author(s)'] || row['author(s)'] || '';
      const category = row.category || row.Category || '';
      const copies = parseInt(row.copies || row.Copies || row['Number of Copies'] || row['number of copies']) || 1;

      // Rule 2.2: Validate required fields
      if (!title.trim()) {
        errors.push({ row: i + 1, title: 'N/A', error: 'Missing title' });
        skipped++;
        continue;
      }
      if (!author.trim()) {
        errors.push({ row: i + 1, title, error: 'Missing author' });
        skipped++;
        continue;
      }

      // Rule 2.2: Check duplicate title+author (warning, not blocked)
      const existingBook = await Book.findOne({
        title: { $regex: new RegExp(`^${title.trim()}$`, 'i') },
        author: { $regex: new RegExp(`^${author.trim()}$`, 'i') },
        isActive: true,
      });
      if (existingBook) {
        warnings.push({ row: i + 1, title, author, warning: 'Duplicate title+author exists (adding as new entry)' });
      }

      try {
        const book = await Book.create({
          title: title.trim(),
          author: author.trim(),
          isbn: (row.isbn || row.ISBN || '').trim(),
          category: category.trim(),
          copies,
          publisher: (row.publisher || row.Publisher || '').trim(),
          year: row.year || row.Year || null,
        });

        // Rule 2.1: Auto-generate barcodes are created by the model pre-save hook
        imported++;
        copiesCreated += copies;
      } catch (err) {
        errors.push({ row: i + 1, title, error: err.message });
        skipped++;
      }
    }

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch {}

    // Rule 2.2: Import summary
    res.json({
      message: `Import complete: ${imported} books added, ${copiesCreated} copies created, ${skipped} rows skipped, ${warnings.length} warnings`,
      imported,
      copiesCreated,
      skipped,
      warnings,
      errors,
      total: results.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
