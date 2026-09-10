import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HiOutlinePlus,
  HiOutlinePencil,
  HiOutlineTrash,
  HiOutlineSearch,
  HiOutlineX,
  HiOutlineUpload,
  HiOutlineCog,
  HiOutlineTag,
  HiOutlineDocumentDownload,
  HiOutlineCheckCircle,
  HiOutlineExclamationCircle,
} from 'react-icons/hi';
import toast from 'react-hot-toast';
import api from '../api';

const emptyForm = { title: '', author: '', isbn: '', category: '', copies: 1, publisher: '', year: '' };

export default function Books() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [totalBooks, setTotalBooks] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  // Bulk import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState(1); // 1=Upload, 2=Preview, 3=Confirm
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [importingBulk, setImportingBulk] = useState(false);
  const dropRef = useRef(null);

  // Barcode viewer state
  const [barcodeBook, setBarcodeBook] = useState(null);
  const [barcodeImage, setBarcodeImage] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteModal, setDeleteModal] = useState(null);
  const itemsPerPage = 10;

  const load = () => {
    setLoading(true);
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    api.get(`/books${params}`)
      .then((r) => {
        setBooks(r.data.books || r.data);
        setTotalBooks(r.data.total || (r.data.books || r.data).length);
      })
      .catch(() => toast.error('Failed to load books'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [search]);
  useEffect(() => { setCurrentPage(1); setSelectedIds(new Set()); }, [search]);

  useEffect(() => {
    api.get('/books/categories').then(r => setCategories(r.data)).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editing) {
        await api.put(`/books/${editing}`, form);
        toast.success('Book updated successfully');
      } else {
        await api.post('/books', form);
        toast.success('Book added successfully');
      }
      setForm(emptyForm);
      setEditing(null);
      setShowForm(false);
      load();
    } catch {
      toast.error('Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (b) => {
    setForm({
      title: b.title, author: b.author, isbn: b.isbn || '',
      category: b.category || '', copies: b.copies,
      publisher: b.publisher || '', year: b.year || '',
    });
    setEditing(b._id || b.id);
    setShowForm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal) return;
    try {
      await api.delete(`/books/${deleteModal._id || deleteModal.id}`);
      toast.success('Book deleted');
      setDeleteModal(null);
      load();
    } catch {
      toast.error('Failed to delete book');
    }
  };

  // View barcode (Rule 2.1)
  const handleViewBarcode = async (book) => {
    setBarcodeBook(book);
    setBarcodeImage('');
    setBarcodeLoading(true);
    try {
      const { data } = await api.get(`/books/${book._id || book.id}/barcode`);
      setBarcodeImage(data.barcode);
    } catch {
      toast.error('Failed to load barcode');
    } finally {
      setBarcodeLoading(false);
    }
  };

  // Handle file drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleDragOver = (e) => { e.preventDefault(); setDragActive(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDragActive(false); };

  const handleFileSelect = (file) => {
    const validTypes = ['.csv', '.xlsx', '.xls'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!validTypes.includes(ext)) {
      toast.error('Unsupported file format. Use CSV or Excel.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 10MB.');
      return;
    }
    setImportFile(file);
    parseFilePreview(file);
    // Auto-advance to step 2 (Preview) after file is selected
    setImportStep(2);
  };

  const parseFilePreview = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (file.name.endsWith('.csv')) {
        const lines = text.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const rows = lines.slice(1).map(line => {
          const values = line.split(',');
          const row = {};
          headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
          return row;
        });
        setImportPreview({ headers: lines[0].split(',').map(h => h.trim()), rows, totalRows: rows.length });
      } else {
        // Excel — just show file info
        setImportPreview({ headers: ['Title', 'Author', 'Category', 'Copies'], rows: [], totalRows: 0, isExcel: true });
      }
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = async () => {
    if (!importFile) return;
    setImportingBulk(true);
    const formData = new FormData();
    formData.append('file', importFile);

    try {
      const { data } = await api.post('/books/import/csv', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(data);
      setImportStep(3);
      toast.success(`Imported ${data.imported} books`);
      // Reload books after short delay to ensure backend has finished
      setTimeout(() => load(), 500);
    } catch (err) {
      console.error('Import error:', err);
      const msg = err.response?.data?.error || err.message || 'Import failed';
      toast.error(msg);
      // Go back to step 2 on error so user can retry
      setImportStep(2);
    } finally {
      setImportingBulk(false);
    }
  };

  const resetImport = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportStep(1);
    setShowImportModal(false);
    setDragActive(false);
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    handleFileSelect(file);
    // Reset file input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadSampleTemplate = () => {
    const csv = 'Title,Author,ISBN,Category,Copies\nExample Book Title,Author Name,978-1234567890,Fiction,3\nAnother Book,Another Author,978-0987654321,Science,1';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'book-import-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast.success('Sample template downloaded!');
  };

  const filtered = books;
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paged = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const startIdx = (currentPage - 1) * itemsPerPage + 1;
  const endIdx = Math.min(currentPage * itemsPerPage, filtered.length);

  // Select all logic
  const pagedIds = paged.map(b => b._id || b.id);
  const allSelected = pagedIds.length > 0 && pagedIds.every(id => selectedIds.has(id));
  const someSelected = pagedIds.some(id => selectedIds.has(id));
  const toggleSelectAll = () => { allSelected ? setSelectedIds(new Set()) : setSelectedIds(new Set(pagedIds)); };
  const toggleSelect = (id) => { setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };

  const closeModal = () => {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h2 className="page-title">Books</h2>
          <p className="page-subtitle">Manage your library's book collection — barcodes auto-generated as LIB-YYYY-XXXXXX</p>
        </div>
        <div className="page-actions">
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} />
          <button className="btn btn-secondary" onClick={() => { resetImport(); setShowImportModal(true); }}>
            <HiOutlineUpload /> Import Books
          </button>
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm); setEditing(null); setShowForm(true); }}>
            <HiOutlinePlus /> Add Book
          </button>
        </div>
      </div>

      <div className="search-wrapper">
        <HiOutlineSearch className="search-icon" />
        <input className="search-input" placeholder="Search by title, author, ISBN, or barcode..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="table-wrapper">
        <div className="table-toolbar">
          <span className="table-count">
            Showing <strong>{startIdx}</strong> to <strong>{endIdx}</strong> of <strong>{filtered.length}</strong> books
          </span>
        </div>
        {loading ? (
          <div className="loading">
            <div className="loading-spinner" />
            <span className="loading-text">Loading books...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📚</div>
            <h3 className="empty-state-title">{search ? 'No books found' : 'No books yet'}</h3>
            <p className="empty-state-text">{search ? 'Try adjusting your search terms' : 'Add your first book or import from CSV'}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}><input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} /></th>
                <th>Book Details</th>
                <th>Barcode</th>
                <th>ISBN</th>
                <th>Category</th>
                <th>Copies</th>
                <th>Available</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((b) => (
                <tr key={b._id || b.id} style={{ cursor: 'pointer', background: selectedIds.has(b._id || b.id) ? '#f0f7ff' : undefined }} onClick={() => navigate(`/books/${b._id || b.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(b._id || b.id)} onChange={() => toggleSelect(b._id || b.id)} style={{ cursor: 'pointer' }} /></td>
                  <td>
                    <div className="table-cell-title" style={{ color: '#0f172a' }}>{b.title}</div>
                    <div className="table-cell-sub">by {b.author}</div>
                  </td>
                  <td>
                    <span
                      style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#475569', cursor: 'pointer' }}
                      onClick={() => handleViewBarcode(b)}
                    >
                      {b.barcode || '—'}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{b.isbn || '—'}</td>
                  <td>{b.category ? <span className="badge badge-gray">{b.category}</span> : <span style={{ color: 'var(--gray-400)' }}>—</span>}</td>
                  <td>{b.copies}</td>
                  <td>
                    <span className={`badge ${b.available > 0 ? 'badge-green' : b.status === 'Lost' ? 'badge-red' : 'badge-red'}`}>
                      <span className="badge-dot" />
                      {b.status === 'Lost' ? 'Lost' : b.available}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.15rem', alignItems: 'center' }}>
                      <button className="btn btn-ghost btn-sm" title="View Barcode" onClick={() => handleViewBarcode(b)} style={{ color: '#64748b', padding: '0.3rem' }}>
                        <HiOutlineTag />
                      </button>
                      <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => handleEdit(b)} style={{ color: '#64748b', padding: '0.3rem' }}>
                        <HiOutlinePencil />
                      </button>
                      <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => setDeleteModal(b)} style={{ color: '#dc2626', padding: '0.3rem' }}>
                        <HiOutlineTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {!loading && filtered.length > itemsPerPage && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1.5rem', borderTop: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>Showing <strong>{startIdx}</strong> to <strong>{endIdx}</strong> of <strong>{filtered.length}</strong> results</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', color: currentPage === 1 ? '#cbd5e1' : '#475569', fontSize: '0.82rem', fontWeight: 500, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>Previous</button>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ padding: '0.4rem 1rem', borderRadius: '8px', border: '1px solid #3b82f6', background: currentPage === totalPages ? '#f1f5f9' : '#3b82f6', color: currentPage === totalPages ? '#94a3b8' : '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setDeleteModal(null)}>
          <div style={{ background: '#fff', borderRadius: '16px', width: '420px', maxWidth: '90vw', boxShadow: '0 25px 60px rgba(0,0,0,0.25)', textAlign: 'center', padding: '2rem 2rem 1.5rem' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <HiOutlineExclamationCircle style={{ fontSize: '2rem', color: '#dc2626' }} />
            </div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>Delete Book</h3>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.88rem', color: '#64748b', lineHeight: 1.5 }}>Are you sure you want to delete <strong style={{ color: '#0f172a' }}>{deleteModal.title}</strong>? This action cannot be undone.</p>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1.25rem', textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#0f172a' }}>{deleteModal.title}</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>by {deleteModal.author} • {deleteModal.barcode || '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button onClick={() => setDeleteModal(null)} style={{ padding: '0.6rem 1.5rem', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '0.88rem', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleDeleteConfirm} style={{ padding: '0.6rem 1.5rem', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#fff', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 8px rgba(220,38,38,0.3)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <HiOutlineTrash style={{ fontSize: '0.95rem' }} /> Delete Book
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Book - Full Page View */}
      {showForm && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: '#f8fafc', zIndex: 1000,
          overflowY: 'auto',
        }}>
          {/* Top bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.875rem 1.5rem', background: '#fff',
            borderBottom: '1px solid #e2e8f0',
            position: 'sticky', top: 0, zIndex: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={closeModal}
                style={{
                  background: '#f1f5f9', border: 'none', borderRadius: '8px',
                  width: '36px', height: '36px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#475569', fontSize: '1.1rem',
                }}
              >
                <HiOutlineX />
              </button>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                  {editing ? 'Edit Book Details' : 'Book Details'}
                </h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                  Enter the official bibliographic information for the {editing ? 'existing' : 'new physical'} volume.
                </p>
              </div>
            </div>
          </div>

          {/* Main content */}
          <div style={{ padding: '1.5rem', maxWidth: '960px', margin: '0 auto' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 280px', gap: '1.5rem',
              alignItems: 'start',
            }}>
              {/* Left: Form */}
              <form onSubmit={handleSubmit} style={{
                background: '#fff', borderRadius: '12px',
                border: '1px solid #e2e8f0', padding: '1.5rem',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Title */}
                  <div>
                    <label style={{
                      display: 'block', fontSize: '0.8rem', fontWeight: 600,
                      color: '#475569', marginBottom: '0.375rem',
                    }}>
                      Title
                    </label>
                    <input
                      required
                      placeholder="e.g. Peacekeeping Operations Manual"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                      style={{
                        width: '100%', padding: '0.625rem 0.875rem',
                        borderRadius: '8px', border: '1.5px solid #e2e8f0',
                        fontSize: '0.9rem', color: '#0f172a',
                        outline: 'none', transition: 'border-color 0.15s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={(e) => e.target.style.borderColor = '#0f172a'}
                      onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                    />
                  </div>

                  {/* Author */}
                  <div>
                    <label style={{
                      display: 'block', fontSize: '0.8rem', fontWeight: 600,
                      color: '#475569', marginBottom: '0.375rem',
                    }}>
                      Author(s)
                    </label>
                    <input
                      required
                      placeholder="e.g. United Nations Dept. of Peace Operations"
                      value={form.author}
                      onChange={(e) => setForm({ ...form, author: e.target.value })}
                      style={{
                        width: '100%', padding: '0.625rem 0.875rem',
                        borderRadius: '8px', border: '1.5px solid #e2e8f0',
                        fontSize: '0.9rem', color: '#0f172a',
                        outline: 'none', transition: 'border-color 0.15s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={(e) => e.target.style.borderColor = '#0f172a'}
                      onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                    />
                  </div>

                  {/* Category + Copies row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    {/* Category */}
                    <div>
                      <label style={{
                        display: 'block', fontSize: '0.8rem', fontWeight: 600,
                        color: '#475569', marginBottom: '0.375rem',
                      }}>
                        Category
                      </label>
                      <div style={{ display: 'flex', gap: '0.375rem' }}>
                        <select
                          value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}
                          style={{
                            flex: 1, padding: '0.625rem 0.875rem',
                            borderRadius: '8px', border: '1.5px solid #e2e8f0',
                            fontSize: '0.9rem', color: form.category ? '#0f172a' : '#94a3b8',
                            background: '#fff', outline: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="">Select Classification</option>
                          {categories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                          {!categories.includes(form.category) && form.category && (
                            <option value={form.category}>{form.category}</option>
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const newCat = prompt('Enter new category name:');
                            if (newCat && newCat.trim()) {
                              setCategories([...categories, newCat.trim()]);
                              setForm({ ...form, category: newCat.trim() });
                            }
                          }}
                          style={{
                            width: '38px', height: '38px', borderRadius: '8px',
                            border: '1.5px solid #e2e8f0', background: '#fff',
                            color: '#475569', fontSize: '1.1rem',
                            cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0f172a'; e.currentTarget.style.color = '#0f172a'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569'; }}
                          title="Add new category"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Number of Copies */}
                    <div>
                      <label style={{
                        display: 'block', fontSize: '0.8rem', fontWeight: 600,
                        color: '#475569', marginBottom: '0.375rem',
                      }}>
                        Number of Copies
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, copies: Math.max(1, form.copies - 1) })}
                          style={{
                            width: '40px', height: '40px', borderRadius: '8px 0 0 8px',
                            border: '1.5px solid #e2e8f0', borderRight: 'none',
                            background: '#f8fafc', color: '#475569',
                            fontSize: '1.1rem', fontWeight: 500,
                            cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="1"
                          value={form.copies}
                          onChange={(e) => setForm({ ...form, copies: Math.max(1, parseInt(e.target.value) || 1) })}
                          style={{
                            width: '60px', height: '40px', textAlign: 'center',
                            border: '1.5px solid #e2e8f0', borderTop: '1.5px solid #e2e8f0',
                            borderBottom: '1.5px solid #e2e8f0',
                            fontSize: '0.95rem', fontWeight: 600,
                            color: '#0f172a', outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, copies: form.copies + 1 })}
                          style={{
                            width: '40px', height: '40px', borderRadius: '0 8px 8px 0',
                            border: '1.5px solid #e2e8f0', borderLeft: 'none',
                            background: '#f8fafc', color: '#475569',
                            fontSize: '1.1rem', fontWeight: 500,
                            cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ISBN */}
                  <div>
                    <label style={{
                      display: 'block', fontSize: '0.8rem', fontWeight: 600,
                      color: '#475569', marginBottom: '0.375rem',
                    }}>
                      ISBN
                    </label>
                    <input
                      placeholder="Enter ISBN number"
                      value={form.isbn}
                      onChange={(e) => setForm({ ...form, isbn: e.target.value })}
                      style={{
                        width: '100%', padding: '0.625rem 0.875rem',
                        borderRadius: '8px', border: '1.5px solid #e2e8f0',
                        fontSize: '0.9rem', color: '#0f172a',
                        outline: 'none', transition: 'border-color 0.15s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={(e) => e.target.style.borderColor = '#0f172a'}
                      onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                    />
                  </div>
                </div>

                {/* Footer buttons */}
                <div style={{
                  display: 'flex', justifyContent: 'flex-end', gap: '0.5rem',
                  marginTop: '1.5rem', paddingTop: '1.25rem',
                  borderTop: '1px solid #f1f5f9',
                }}>
                  <button
                    type="button"
                    onClick={closeModal}
                    style={{
                      padding: '0.6rem 1.25rem', borderRadius: '8px',
                      border: '1.5px solid #e2e8f0', background: '#fff',
                      color: '#475569', fontSize: '0.85rem', fontWeight: 500,
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      padding: '0.6rem 1.5rem', borderRadius: '8px',
                      border: 'none', background: '#0f172a',
                      color: '#fff', fontSize: '0.85rem', fontWeight: 600,
                      cursor: submitting ? 'not-allowed' : 'pointer', transition: 'all 0.15s ease',
                      boxShadow: '0 2px 6px rgba(15,23,42,0.2)',
                      display: 'flex', alignItems: 'center', gap: '0.375rem',
                      opacity: submitting ? 0.7 : 1,
                    }}
                  >
                    {submitting ? (
                      <><svg width="16" height="16" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}><circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" fill="none" strokeDasharray="32" strokeLinecap="round" /></svg> {editing ? 'Saving...' : 'Saving...'}</>
                    ) : (
                      <><HiOutlineTag style={{ fontSize: '0.9rem' }} /> {editing ? 'Save Changes' : 'Save Book'}</>
                    )}
                  </button>
                </div>
              </form>

              {/* Right: Barcode Preview */}
              <div style={{
                background: '#fff', borderRadius: '12px',
                border: '1px solid #e2e8f0', padding: '1.25rem',
                position: 'sticky', top: '80px',
              }}>
                <h4 style={{
                  margin: '0 0 1rem', fontSize: '0.8rem', fontWeight: 700,
                  color: '#0f172a', letterSpacing: '0.03em',
                }}>
                  System Barcode Preview
                </h4>

                <div style={{
                  background: '#f8fafc', borderRadius: '10px',
                  border: '1px solid #e2e8f0', padding: '1.25rem',
                  textAlign: 'center',
                }}>
                  {/* Barcode icon */}
                  <div style={{ marginBottom: '0.75rem' }}>
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto' }}>
                      <rect x="4" y="4" width="32" height="32" rx="6" fill="#e2e8f0" />
                      <rect x="8" y="12" width="2" height="16" fill="#475569" />
                      <rect x="12" y="8" width="2" height="24" fill="#475569" />
                      <rect x="16" y="12" width="3" height="16" fill="#475569" />
                      <rect x="21" y="8" width="2" height="24" fill="#475569" />
                      <rect x="25" y="12" width="2" height="16" fill="#475569" />
                      <rect x="29" y="8" width="2" height="24" fill="#475569" />
                    </svg>
                  </div>

                  {/* Barcode lines visual */}
                  <div style={{
                    display: 'flex', justifyContent: 'center', gap: '1px',
                    marginBottom: '0.75rem', padding: '0 1rem',
                  }}>
                    {Array.from({ length: 40 }, (_, i) => (
                      <div
                        key={i}
                        style={{
                          width: Math.random() > 0.5 ? '2px' : '1px',
                          height: '40px',
                          background: '#0f172a',
                          opacity: 0.8,
                        }}
                      />
                    ))}
                  </div>

                  {/* Barcode value */}
                  <div style={{
                    background: '#fff', borderRadius: '6px',
                    border: '1px solid #e2e8f0', padding: '0.5rem 0.75rem',
                    display: 'inline-block',
                  }}>
                    <span style={{
                      fontFamily: 'monospace', fontSize: '1rem',
                      fontWeight: 700, color: '#0f172a',
                      letterSpacing: '1.5px',
                    }}>
                      {editing ? (books.find(b => b._id === editing)?.barcode || 'LIB-2026-000000') : `LIB-${new Date().getFullYear()}-000000`}
                    </span>
                  </div>
                </div>

                <p style={{
                  margin: '0.75rem 0 0', fontSize: '0.72rem',
                  color: '#94a3b8', textAlign: 'center', lineHeight: 1.4,
                }}>
                  Auto-generated upon save. Affix to interior cover.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={resetImport}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Bulk Import Books</h3>
              <button className="modal-close" onClick={resetImport}><HiOutlineX /></button>
            </div>

            <div className="modal-body" style={{ padding: '1.5rem' }}>
              <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
                Upload your inventory data in a standardized format.
              </p>

              {/* Stepper */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0', marginBottom: '1.75rem' }}>
                {[1, 2, 3].map((step) => (
                  <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{
                        width: '28px', height: '28px', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.8rem', fontWeight: 700,
                        background: importStep >= step ? '#0f172a' : '#e2e8f0',
                        color: importStep >= step ? '#fff' : '#94a3b8',
                        transition: 'all 0.2s ease',
                      }}>
                        {importStep > step ? '✓' : step}
                      </div>
                      <span style={{
                        fontSize: '0.8rem', fontWeight: importStep === step ? 700 : 500,
                        color: importStep >= step ? '#0f172a' : '#94a3b8',
                      }}>
                        {step === 1 ? 'Upload' : step === 2 ? 'Preview' : 'Confirm'}
                      </span>
                    </div>
                    {step < 3 && (
                      <div style={{
                        width: '60px', height: '2px', margin: '0 0.75rem',
                        background: importStep > step ? '#0f172a' : '#e2e8f0',
                        transition: 'background 0.2s ease',
                      }} />
                    )}
                  </div>
                ))}
              </div>

              {/* Step 1: Upload */}
              {importStep === 1 && (
                <div>
                  <div
                    ref={dropRef}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    style={{
                      border: `2px dashed ${dragActive ? '#0f172a' : importFile ? '#15803d' : '#e2e8f0'}`,
                      borderRadius: '12px',
                      padding: '2.5rem 2rem',
                      textAlign: 'center',
                      background: dragActive ? '#f8fafc' : importFile ? '#f0fdf4' : '#fff',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer',
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {importFile ? (
                      <>
                        <div style={{
                          width: '48px', height: '48px', borderRadius: '12px',
                          background: '#dcfce7', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          margin: '0 auto 1rem',
                        }}>
                          <HiOutlineCheckCircle style={{ fontSize: '1.5rem', color: '#15803d' }} />
                        </div>
                        <h4 style={{ margin: '0 0 0.25rem', color: '#0f172a', fontSize: '1rem' }}>
                          {importFile.name}
                        </h4>
                        <p style={{ margin: '0 0 1rem', color: '#15803d', fontSize: '0.82rem', fontWeight: 500 }}>
                          File selected — {(importFile.size / 1024).toFixed(1)} KB
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setImportFile(null); setImportPreview(null); }}
                          style={{
                            padding: '0.5rem 1rem', borderRadius: '8px',
                            border: '1px solid #e2e8f0', background: '#fff',
                            color: '#475569', fontSize: '0.82rem', fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Choose Different File
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{
                          width: '48px', height: '48px', borderRadius: '12px',
                          background: '#f1f5f9', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          margin: '0 auto 1rem',
                        }}>
                          <HiOutlineUpload style={{ fontSize: '1.5rem', color: '#64748b' }} />
                        </div>
                        <h4 style={{ margin: '0 0 0.5rem', color: '#0f172a', fontSize: '1rem' }}>
                          Drag and drop your file here
                        </h4>
                        <p style={{ margin: '0 0 1.25rem', color: '#94a3b8', fontSize: '0.82rem' }}>
                          Supported formats: CSV, XLSX. Maximum file size: 10MB.
                        </p>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                          style={{
                            padding: '0.6rem 1.5rem', borderRadius: '8px',
                            border: 'none', background: '#0f172a', color: '#fff',
                            fontSize: '0.85rem', fontWeight: 600,
                            cursor: 'pointer', transition: 'all 0.15s ease',
                          }}
                        >
                          Browse Files
                        </button>
                      </>
                    )}
                  </div>

                  <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); downloadSampleTemplate(); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                        background: 'none', border: 'none',
                        color: '#0f172a', fontSize: '0.82rem', fontWeight: 600,
                        cursor: 'pointer', padding: '0.25rem',
                      }}
                    >
                      <HiOutlineDocumentDownload style={{ fontSize: '1rem' }} />
                      Download Sample Template
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Preview */}
              {importStep === 2 && importPreview && (
                <div>
                  <div style={{
                    background: '#f8fafc', borderRadius: '8px',
                    padding: '1rem', marginBottom: '1rem',
                    border: '1px solid #e2e8f0',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '0.9rem' }}>
                          📄 {importFile?.name}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                          {importPreview.totalRows} rows detected • {importPreview.headers?.length || 0} columns
                        </div>
                      </div>
                      <button
                        onClick={() => { setImportFile(null); setImportPreview(null); setImportStep(1); }}
                        style={{
                          padding: '0.375rem 0.75rem', borderRadius: '6px',
                          border: '1px solid #e2e8f0', background: '#fff',
                          color: '#475569', fontSize: '0.8rem', fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Change File
                      </button>
                    </div>
                  </div>

                  {importPreview.rows.length > 0 ? (
                    <div style={{ overflowX: 'auto', maxHeight: '240px', overflowY: 'auto', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc' }}>
                            {importPreview.headers.map((h, i) => (
                              <th key={i} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.rows.slice(0, 10).map((row, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                              {importPreview.headers.map((h, j) => (
                                <td key={j} style={{ padding: '0.5rem 0.75rem', color: '#334155', borderBottom: '1px solid #f1f5f9' }}>
                                  {row[h.toLowerCase()] || '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                      <p>Excel file detected. {importPreview.totalRows > 0 ? `${importPreview.totalRows} rows will be imported.` : 'Rows will be parsed on upload.'}</p>
                    </div>
                  )}

                  {importPreview.totalRows > 10 && (
                    <p style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.5rem', textAlign: 'center' }}>
                      Showing first 10 of {importPreview.totalRows} rows
                    </p>
                  )}
                </div>
              )}

              {/* Step 3: Confirm */}
              {importStep === 3 && importResult && (
                <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: '#dcfce7', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 1rem',
                  }}>
                    <HiOutlineCheckCircle style={{ fontSize: '2rem', color: '#15803d' }} />
                  </div>
                  <h4 style={{ margin: '0 0 0.5rem', color: '#0f172a' }}>Import Complete!</h4>

                  <div style={{
                    display: 'flex', justifyContent: 'center', gap: '1.5rem',
                    marginTop: '1.25rem', flexWrap: 'wrap',
                  }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#15803d' }}>{importResult.imported || 0}</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Books Added</div>
                    </div>
                    <div style={{ width: '1px', background: '#e2e8f0' }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#2563eb' }}>{importResult.copiesCreated || 0}</div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Copies Created</div>
                    </div>
                    {importResult.warnings?.length > 0 && (
                      <>
                        <div style={{ width: '1px', background: '#e2e8f0' }} />
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#d97706' }}>{importResult.warnings.length}</div>
                          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Warnings</div>
                        </div>
                      </>
                    )}
                  </div>

                  {importResult.warnings?.length > 0 && (
                    <div style={{
                      marginTop: '1rem', textAlign: 'left',
                      background: '#fffbeb', borderRadius: '8px',
                      padding: '0.75rem 1rem', border: '1px solid #fef3c7',
                      maxHeight: '120px', overflowY: 'auto',
                    }}>
                      {importResult.warnings.map((w, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.375rem', fontSize: '0.8rem', color: '#92400e', marginBottom: '0.25rem' }}>
                          <HiOutlineExclamationCircle style={{ fontSize: '0.9rem', marginTop: '2px', flexShrink: 0 }} />
                          <span>{typeof w === 'string' ? w : `${w?.row ? `Row ${w.row}: ` : ''}${w?.warning || w?.message || 'Warning'}${w?.title ? ` ("${w.title}")` : ''}`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '1rem 1.5rem', borderTop: '1px solid #f1f5f9',
            }}>
              <button
                onClick={resetImport}
                style={{
                  padding: '0.5rem 1rem', borderRadius: '8px',
                  border: '1.5px solid #e2e8f0', background: '#fff',
                  color: '#475569', fontSize: '0.82rem', fontWeight: 500,
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                Cancel
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {importStep === 2 && (
                  <button
                    onClick={() => setImportStep(1)}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: '8px',
                      border: '1.5px solid #e2e8f0', background: '#fff',
                      color: '#475569', fontSize: '0.82rem', fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    Back
                  </button>
                )}
                {importStep === 1 && importFile && (
                  <button
                    onClick={() => setImportStep(2)}
                    style={{
                      padding: '0.5rem 1.25rem', borderRadius: '8px',
                      border: '1.5px solid #e2e8f0', background: '#fff',
                      color: '#475569', fontSize: '0.82rem', fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Next Step
                  </button>
                )}
                {importStep === 2 && (
                  <button
                    onClick={handleImportSubmit}
                    disabled={importingBulk}
                    style={{
                      padding: '0.5rem 1.25rem', borderRadius: '8px',
                      border: '1.5px solid #0f172a', background: '#0f172a',
                      color: '#fff', fontSize: '0.82rem', fontWeight: 600,
                      cursor: importingBulk ? 'not-allowed' : 'pointer',
                      opacity: importingBulk ? 0.7 : 1,
                      boxShadow: '0 2px 6px rgba(15,23,42,0.2)',
                    }}
                  >
                    {importingBulk ? 'Importing...' : 'Import Now'}
                  </button>
                )}
                {importStep === 3 && (
                  <button
                    onClick={resetImport}
                    style={{
                      padding: '0.5rem 1.25rem', borderRadius: '8px',
                      border: '1.5px solid #0f172a', background: '#0f172a',
                      color: '#fff', fontSize: '0.82rem', fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(15,23,42,0.2)',
                    }}
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Viewer Modal */}
      {barcodeBook && (
        <div className="modal-overlay" onClick={() => { setBarcodeBook(null); setBarcodeImage(''); }}>
          <div className="modal" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">📖 Book Barcode</h3>
              <button className="modal-close" onClick={() => { setBarcodeBook(null); setBarcodeImage(''); }}><HiOutlineX /></button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--gray-900)' }}>{barcodeBook.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)' }}>by {barcodeBook.author}</div>
              </div>

              {barcodeLoading ? (
                <div className="loading" style={{ padding: '2rem' }}>
                  <div className="loading-spinner" />
                  <span className="loading-text">Generating barcode...</span>
                </div>
              ) : barcodeImage ? (
                <div style={{
                  background: 'white', border: '2px solid var(--gray-200)', borderRadius: 'var(--radius-lg)',
                  padding: '0.75rem', display: 'inline-block',
                }}>
                  <img src={barcodeImage} alt="Book Barcode" style={{ maxWidth: '200px', height: 'auto' }} />
                </div>
              ) : null}

              <div style={{
                marginTop: '1rem', background: 'var(--gray-50)', borderRadius: 'var(--radius-md)',
                padding: '0.75rem', border: '1px solid var(--gray-200)',
              }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>Barcode Value</div>
                <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700, color: 'var(--gray-900)', letterSpacing: '1px' }}>
                  {barcodeBook.barcode || 'N/A'}
                </div>
              </div>

              {barcodeBook.isbn && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: 'var(--gray-500)' }}>
                  ISBN: {barcodeBook.isbn}
                </div>
              )}
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => { setBarcodeBook(null); setBarcodeImage(''); }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
