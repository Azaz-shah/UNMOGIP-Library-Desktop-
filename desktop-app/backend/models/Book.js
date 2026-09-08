import { createModel } from '../db/model.js';

export default createModel({
  name: 'Book',
  table: 'books',
  columns: [
    { name: '_id', db: 'id', type: 'text' },
    { name: 'title', db: 'title', type: 'text' },
    { name: 'author', db: 'author', type: 'text' },
    { name: 'isbn', db: 'isbn', type: 'text' },
    { name: 'barcode', db: 'barcode', type: 'text' },
    { name: 'barcodeSequence', db: 'barcode_sequence', type: 'int' },
    { name: 'category', db: 'category', type: 'text' },
    { name: 'publisher', db: 'publisher', type: 'text' },
    { name: 'year', db: 'year', type: 'int' },
    { name: 'copies', db: 'copies', type: 'int' },
    { name: 'available', db: 'available', type: 'int' },
    { name: 'status', db: 'status', type: 'text' },
    { name: 'description', db: 'description', type: 'text' },
    { name: 'location', db: 'location', type: 'text' },
    { name: 'coverImage', db: 'cover_image', type: 'text' },
    { name: 'isActive', db: 'is_active', type: 'bool' },
    { name: 'createdAt', db: 'created_at', type: 'text' },
    { name: 'updatedAt', db: 'updated_at', type: 'text' },
  ],
  requireds: [
    { field: 'title', message: 'Title is required' },
    { field: 'author', message: 'Author is required' },
  ],
  uniques: [
    { field: 'isbn', label: 'ISBN' },
    { field: 'barcode', label: 'Barcode' },
  ],
  defaults: {
    isActive: true,
    category: '',
    publisher: '',
    description: '',
    location: '',
    coverImage: '',
    barcodeSequence: 0,
    copies: 1,
    status: 'Available',
  },
  normalize(doc) {
    ['title', 'author', 'isbn', 'category', 'publisher', 'description', 'location'].forEach((f) => {
      if (doc[f] != null) doc[f] = String(doc[f]).trim();
    });
    ['year', 'copies', 'available', 'barcodeSequence'].forEach((f) => {
      if (doc[f] != null) doc[f] = Number(doc[f]) || 0;
    });
  },
  async preSave(doc, { isNew }) {
    const self = this;
    // Generate barcode: LIB-{YEAR}-{random 6-digit}
    if (!doc.barcode) {
      const year = new Date().getFullYear();
      const existing = new Set(self._allDocs().map((b) => b.barcode));
      let barcode;
      do {
        const rand = String(Math.floor(100000 + Math.random() * 900000));
        barcode = `LIB-${year}-${rand}`;
      } while (existing.has(barcode));
      doc.barcode = barcode;
    }
    // On new book creation, set available = copies (Rule 2.1)
    if (isNew) {
      doc.available = doc.copies != null ? doc.copies : 1;
    }
    // Ensure available doesn't exceed copies
    if (doc.available != null && doc.copies != null && doc.available > doc.copies) {
      doc.available = doc.copies;
    }
    // Auto-update status based on availability (Rule 2.3)
    if (doc.status !== 'Lost') {
      doc.status = doc.available === 0 ? 'Issued' : 'Available';
    }
  },
  virtuals: {
    stockStatus(doc) {
      if (doc.status === 'Lost') return 'lost';
      if (doc.available === 0) return 'out_of_stock';
      if (doc.available < doc.copies) return 'low_stock';
      return 'in_stock';
    },
  },
});
