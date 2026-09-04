import crypto from 'crypto';
import { getDb } from './database.js';

const registry = {}; // model name -> model

const nowISO = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// value helpers
// ---------------------------------------------------------------------------
const parseDate = (v) => (v == null || v === '' ? null : new Date(v).getTime());

const TYPES = {
  text: { parse: (v) => (v == null ? null : String(v)), encode: (v) => (v == null ? null : String(v)) },
  int: { parse: (v) => (v == null ? null : Number(v)), encode: (v) => (v == null ? null : Number(v)) },
  bool: { parse: (v) => !!v, encode: (v) => (v ? 1 : 0) },
  json: {
    parse: (v) => (v == null || v === '' ? null : JSON.parse(v)),
    encode: (v) => (v == null ? null : JSON.stringify(v)),
  },
};

function parseSelect(sel) {
  const out = { fields: null, allowPassword: false };
  if (!sel) return out;
  const parts = String(sel).split(/\s+/).filter(Boolean);
  const fields = [];
  parts.forEach((p) => { if (p === '+password') out.allowPassword = true; else fields.push(p); });
  if (fields.length) out.fields = fields;
  return out;
}

function eqValue(raw, want) {
  if (want instanceof Date) {
    return raw != null && parseDate(raw) === want.getTime();
  }
  if (want instanceof RegExp) {
    return typeof raw === 'string' && want.test(raw);
  }
  if (typeof want === 'boolean') return !!raw === want;
  if (typeof want === 'number') return Number(raw) === want;
  if (raw == null) return want == null || want === '';
  const isEmail = typeof want === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(want);
  if (isEmail) return String(raw).toLowerCase() === want.toLowerCase();
  return String(raw) === String(want);
}

function relValue(raw, arg) {
  const looksLikeDate = (v) => v != null && v !== '' && !Number.isNaN(parseDate(v)) && !/^\d+$/.test(String(v));
  if (looksLikeDate(raw) || arg instanceof Date || (typeof arg === 'string' && looksLikeDate(arg))) {
    const ra = raw == null ? null : parseDate(raw);
    const wa = arg == null ? null : parseDate(arg);
    if (ra == null && wa == null) return 0;
    if (ra == null) return -1;
    if (wa == null) return 1;
    return ra - wa;
  }
  if (typeof raw === 'number' || typeof arg === 'number') {
    return (Number(raw) || 0) - (Number(arg) || 0);
  }
  const a = String(raw ?? '');
  const b = String(arg ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function fieldMatches(doc, field, cond) {
  const raw = doc[field];
  if (cond == null || cond instanceof RegExp || cond instanceof Date) return eqValue(raw, cond);
  if (Array.isArray(cond)) return eqValue(raw, cond);
  if (typeof cond === 'object') {
    const ops = Object.keys(cond);
    for (const op of ops) {
      if (op === '$options') continue; // modifier for $regex, not an operator
      const arg = cond[op];
      let ok;
      switch (op) {
        case '$in': ok = (arg || []).some((v) => eqValue(raw, v)); break;
        case '$nin': ok = !(arg || []).some((v) => eqValue(raw, v)); break;
        case '$ne': ok = !eqValue(raw, arg); break;
        case '$exists': ok = arg ? raw != null : raw == null; break;
        case '$eq': ok = eqValue(raw, arg); break;
        case '$gt': ok = relValue(raw, arg) > 0; break;
        case '$gte': ok = relValue(raw, arg) >= 0; break;
        case '$lt': ok = relValue(raw, arg) < 0; break;
        case '$lte': ok = relValue(raw, arg) <= 0; break;
        case '$regex': {
          const re = arg instanceof RegExp ? arg : new RegExp(String(arg), cond.$options || '');
          ok = typeof raw === 'string' && re.test(raw);
          break;
        }
        default: ok = eqValue(raw, cond);
      }
      if (!ok) return false;
    }
    return true;
  }
  return eqValue(raw, cond);
}

function matchesFilter(doc, filter) {
  if (!filter) return true;
  for (const key of Object.keys(filter)) {
    if (key === '$or') {
      if (!(filter.$or || []).some((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    if (key === '$and') {
      if (!(filter.$and || []).every((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    if (key === '$nor') {
      if ((filter.$nor || []).some((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    const field = key === 'id' ? '_id' : key;
    if (!fieldMatches(doc, field, filter[key])) return false;
  }
  return true;
}

function sortDocs(docs, sortSpec) {
  if (!sortSpec) return docs;
  const entries = Object.entries(sortSpec);
  return docs.slice().sort((a, b) => {
    for (const [fieldName, dirRaw] of entries) {
      const field = fieldName === 'id' ? '_id' : fieldName;
      let d = cmpKey(a[field], b[field]);
      if (dirRaw < 0) d = -d;
      if (d !== 0) return d;
    }
    return 0;
  });
}

function cmpKey(a, b) {
  return relValue(a ?? null, b ?? null) === 0 ? 0 : relValue(a ?? null, b ?? null) < 0 ? -1 : 1;
}

function keyValue(row, ref) {
  if (ref == null) return null;
  const s = String(ref);
  if (s.startsWith('$')) {
    let cur = row;
    for (const part of s.slice(1).split('.')) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  }
  return ref;
}

// ---------------------------------------------------------------------------
export function createModel(cfg) {
  const getSelf = () => registry[cfg.name];
  const cols = cfg.columns;
  const colByCamel = new Map(cols.map((c) => [c.name, c]));
  const colByDb = new Map(cols.map((c) => [c.db, c]));
  const colType = (c) => TYPES[c.type || 'text'];

  function rowToDoc(row) {
    if (!row) return null;
    const doc = {};
    for (const c of cols) doc[c.name] = colType(c).parse(row[c.db]);
    attachHelpers(doc, {});
    return doc;
  }

  function docToRow(doc) {
    const row = {};
    for (const c of cols) row[c.db] = colType(c).encode(doc[c.name]);
    return row;
  }

  function attachHelpers(doc, { isNew = false } = {}) {
    Object.defineProperties(doc, {
      _isNew: { value: isNew, enumerable: false, configurable: true, writable: true },
      save: { value: () => getSelf()._saveDoc(doc), enumerable: false, writable: true },
      populate: { value: (spec) => getSelf()._populateDoc(doc, spec), enumerable: false, writable: true },
      toJSON: { value: () => getSelf().docToJSON(doc), enumerable: false, writable: true },
      comparePassword: {
        value: async (candidate) => {
          const bcrypt = (await import('bcryptjs')).default;
          return bcrypt.compare(String(candidate || ''), String(doc.password || ''));
        },
        enumerable: false, writable: true,
      },
    });
    return doc;
  }

  function buildDoc(partial = {}) {
    const doc = {};
    for (const key of Object.keys(partial || {})) {
      const c = colByCamel.get(key);
      if (c) doc[key] = partial[key];
    }
    return doc;
  }

  function toJSON(doc, opts = {}) {
    const out = {};
    for (const c of cols) {
      if (c.name === 'password' && !opts.allowPassword) continue;
      out[c.name] = doc[c.name];
    }
    // Preserve populated replacement objects (not original columns)
    for (const key of Object.keys(doc)) {
      if (key === '_model') continue;
      if (!colByCamel.has(key) && typeof doc[key] !== 'function' && !key.startsWith('_')) {
        out[key] = doc[key];
      }
    }
    if (cfg.virtuals) {
      for (const [name, fn] of Object.entries(cfg.virtuals)) {
        try { out[name] = fn(doc); } catch { /* ignore */ }
      }
    }
    return out;
  }

  async function applyDefaults(doc, { isNew }) {
    if (!cfg.defaults) return;
    for (const [field, val] of Object.entries(cfg.defaults)) {
      if (doc[field] == null || doc[field] === '') {
        doc[field] = typeof val === 'function' ? val(doc) : val;
      }
    }
  }

  async function preSaveDoc(doc, { isNew }) {
    if (cfg.preSave) await cfg.preSave.call(getSelf(), doc, { isNew });
  }

  function assertUnique(doc, excludeId) {
    for (const uniq of cfg.uniques || []) {
      const val = doc[uniq.field];
      if (val == null || val === '') continue;
      const dbCol = colByCamel.get(uniq.field).db;
      const row = getDb().prepare(`SELECT id FROM ${cfg.table} WHERE ${dbCol} = ? AND id != ?`)
        .get(String(val), String(excludeId || ''));
      if (row) {
        const err = new Error(`${uniq.label || uniq.field} already exists`);
        err.code = 11000;
        throw err;
      }
    }
  }

  function assertRequired(doc) {
    for (const req of cfg.requireds || []) {
      const val = doc[req.field];
      const empty = val == null || (typeof val === 'string' && val.trim() === '');
      if (empty) {
        throw new Error(`${cfg.name} validation failed: ${req.field}: ${req.message || `${req.field} is required`}`);
      }
    }
  }

  function normalize(doc) {
    if (cfg.normalize) cfg.normalize(doc);
  }

  async function persist(doc, { isNew }) {
    normalize(doc);
    await applyDefaults(doc, { isNew });
    if (isNew) {
      if (!doc._id) doc._id = uuid();
      doc.createdAt = doc.createdAt || nowISO();
    }
    doc.updatedAt = nowISO();
    await preSaveDoc(doc, { isNew });
    assertRequired(doc);
    assertUnique(doc, isNew ? '' : doc._id);
    const row = docToRow(doc);
    if (isNew) {
      getDb().prepare(`INSERT INTO ${cfg.table} (${cols.map((c) => c.db).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map((c) => row[c.db]));
      Object.defineProperty(doc, '_isNew', { value: false, enumerable: false, configurable: true, writable: true });
    } else {
      const setCols = cols.filter((c) => c.db !== 'id').map((c) => `${c.db} = ?`);
      getDb().prepare(`UPDATE ${cfg.table} SET ${setCols.join(', ')} WHERE id = ?`)
        .run(...cols.filter((c) => c.db !== 'id').map((c) => row[c.db]), row.id);
    }
    return doc;
  }

  async function fetchDocs(filter) {
    const rows = getDb().prepare(`SELECT * FROM ${cfg.table}`).all();
    const docs = rows.map(rowToDoc);
    return docs.filter((d) => matchesFilter(d, filter || {}));
  }

  // query builder (thenable + chainable)
  class Query {
    constructor({ single = false } = {}) {
      this.filter = null;
      this.sortSpec = null;
      this.skipN = null;
      this.limitN = null;
      this.selectMode = null;
      this.populateSpecs = [];
      this.single = single;
    }
    where(f) { this.filter = f || {}; return this; }
    sort(s) { this.sortSpec = s || {}; return this; }
    skip(n) { this.skipN = n; return this; }
    limit(n) { this.limitN = n; return this; }
    select(s) { this.selectMode = parseSelect(s); return this; }
    populate(path, sel) {
      this.populateSpecs.push({ path, sel: parseSelect(sel) });
      return this;
    }
    then(resolve, reject) { return this.exec().then(resolve, reject); }
    catch(reject) { return this.exec().catch(reject); }
    finally(fn) { return this.exec().finally(fn); }
    async exec() {
      let out = await fetchDocs(this.filter);
      if (this.sortSpec) out = sortDocs(out, this.sortSpec);
      if (this.skipN || this.limitN != null) {
        const start = this.skipN || 0;
        const end = this.limitN != null ? start + this.limitN : undefined;
        out = out.slice(start, end);
      }
      for (const spec of this.populateSpecs) {
        out = await Promise.all(out.map((d) => getSelf()._populateOne(d, spec.path, spec.sel)));
      }
      // Note: document serialization (toJSON) hides the password; '+password' selects are
      // only used internally (e.g. login) where the doc is kept in memory for bcrypt compare.
      return this.single ? (out[0] ?? null) : out;
    }
  }

  async function aggregateDocs(pipeline) {
    let rows = getSelf()._allDocs();
    for (const stage of pipeline) {
      const [op, spec] = Object.entries(stage)[0];
      if (op === '$match') rows = rows.filter((d) => matchesFilter(d, spec));
      else if (op === '$lookup') {
        const target = registry[spec.from];
        const byId = new Map();
        if (target) target._allDocs().forEach((t) => byId.set(String(t._id), t));
        rows = rows.map((row) => {
          const ids = row[spec.localField] == null ? [] : [String(row[spec.localField])];
          row[spec.as] = ids.map((v) => byId.get(v)).filter(Boolean).map((t) => target.docToJSON(t));
          return row;
        });
      } else if (op === '$unwind') {
        const p = spec.startsWith('$') ? spec.slice(1) : spec;
        rows = rows.flatMap((row) => {
          const arr = row[p];
          if (!Array.isArray(arr) || arr.length === 0) return [];
          return arr.map((item) => ({ ...row, [p]: item }));
        });
      } else if (op === '$group') {
        const groups = new Map();
        for (const row of rows) {
          const key = keyValue(row, spec._id);
          const k = JSON.stringify(key);
          let g = groups.get(k);
          if (!g) { g = { _id: key }; groups.set(k, g); }
          for (const [alias, accSpec] of Object.entries(spec)) {
            if (alias === '_id') continue;
            const [accOp, accField] = Object.entries(accSpec)[0] || [];
            if (accOp === '$sum') {
              const add = accField === 1 ? 1 : Number(row[accField]) || 0;
              g[alias] = (g[alias] || 0) + add;
            }
          }
        }
        rows = Array.from(groups.values());
      } else if (op === '$sort') {
        rows = sortDocs(rows, spec);
      } else if (op === '$limit') {
        rows = rows.slice(0, Number(spec));
      } else if (op === '$project') {
        rows = rows.map((row) => {
          const out = {};
          for (const [alias, val] of Object.entries(spec)) {
            if (val === 0) continue;
            if (val === 1) { out[alias] = alias in row ? row[alias] : row._id; continue; }
            out[alias] = keyValue(row, val);
          }
          return out;
        });
      }
    }
    return rows.map((r) => toJSON(r, {}));
  }

  const model = {
    name: cfg.name,
    table: cfg.table,
    find: (filter) => new Query().where(filter),
    findOne: (filter) => new Query({ single: true }).where(filter),
    findById: (id) => new Query({ single: true }).where({ _id: id }),
    findByIdSync: (id) => {
      const row = getDb().prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(String(id));
      return row ? rowToDoc(row) : null;
    },
    countDocuments: async (filter) => (await fetchDocs(filter || {})).length,
    distinct: async (field, filter) => {
      const docs = await fetchDocs(filter || {});
      const seen = new Set();
      docs.forEach((d) => { const v = d[field]; if (v != null && v !== '') seen.add(v); });
      return Array.from(seen).sort();
    },
    create: async (data) => {
      const doc = buildDoc(data);
      attachHelpers(doc, { isNew: true });
      await persist(doc, { isNew: true });
      return doc;
    },
    findByIdAndUpdate: async (id, update, opts = {}) => {
      const existing = getSelf().findByIdSync(id);
      if (!existing) return null;
      const clean = buildDoc(update);
      Object.assign(existing, clean);
      await persist(existing, { isNew: false });
      return existing;
    },
    aggregate: async (pipeline) => aggregateDocs(pipeline),
    _allDocs: () => getDb().prepare(`SELECT * FROM ${cfg.table}`).all().map(rowToDoc),
    _saveDoc: async (doc) => persist(doc, { isNew: !!doc._isNew }),
    _populateDoc: async (doc, spec) => getSelf()._populateOne(doc, spec?.path ?? spec, spec?.sel),
    _populateOne: async (doc, path, sel) => {
      if (!doc) return doc;
      if (cfg.nestedPopulates && cfg.nestedPopulates[path]) {
        const [root, ...rest] = path.split('.');
        const sub = rest.join('.');
        const target = registry[cfg.nestedPopulates[path]];
        const arr = doc[root];
        if (!target || !Array.isArray(arr)) return doc;
        for (const entry of arr) {
          const idVal = entry && entry[sub];
          if (idVal == null) continue;
          const found = target.findByIdSync(idVal);
          entry[sub] = found ? target.docToJSON(found) : null;
        }
        return doc;
      }
      const targetName = (cfg.relations || {})[path];
      const target = targetName && registry[targetName];
      if (!target) return doc;
      const idVal = doc[path];
      if (idVal == null) { doc[path] = null; return doc; }
      const found = target.findByIdSync(idVal);
      doc[path] = found ? target.docToJSON(found) : null;
      return doc;
    },
    docToJSON: (doc, sel) => toJSON(doc, { allowPassword: sel && sel.allowPassword }),
    _buildDoc: buildDoc,
  };

  registry[cfg.name] = model; // by model name (populate)
  registry[cfg.table] = model; // by table/collection name ($lookup)
  return model;
}

export const getModel = (name) => registry[name];
