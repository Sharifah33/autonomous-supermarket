// Thin synchronous SQLite wrapper over sql.js (SQLite compiled to WebAssembly).
// sql.js needs no native compilation, so `npm install` works on any Windows/macOS/Linux machine.
// The database is an ordinary SQLite file on disk: it is loaded into memory at start-up and
// written back atomically after every committed write. The API mirrors the small subset of
// better-sqlite3 this project uses: prepare().run/get/all, exec, pragma, transaction.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) });

// better-sqlite3 style params ({ r: 'RUN-0001' } for @r, or positional values) -> sql.js params
function toParams(args) {
  if (args.length === 0) return undefined;
  const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const out = {};
    for (const [k, v] of Object.entries(args[0])) out[`@${k}`] = clean(v);
    return out;
  }
  return args.map(clean);
}

class Statement {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
    this.gen = -1;
    this.stmt = null;
  }
  _stmt() {
    if (this.gen !== this.owner.gen) {
      this.stmt = this.owner.db.prepare(this.sql);
      this.gen = this.owner.gen;
    }
    return this.stmt;
  }
  all(...args) {
    const s = this._stmt();
    try {
      const p = toParams(args);
      if (p) s.bind(p);
      const rows = [];
      while (s.step()) rows.push(s.getAsObject());
      return rows;
    } finally {
      s.reset();
    }
  }
  get(...args) {
    const s = this._stmt();
    try {
      const p = toParams(args);
      if (p) s.bind(p);
      return s.step() ? s.getAsObject() : undefined;
    } finally {
      s.reset();
    }
  }
  run(...args) {
    const s = this._stmt();
    try {
      const p = toParams(args);
      if (p) s.bind(p);
      s.step();
    } finally {
      s.reset();
    }
    const changes = this.owner.db.getRowsModified();
    if (this.owner.depth === 0 && changes > 0) this.owner.save();
    return { changes };
  }
}

export default class Database {
  constructor(file) {
    this.file = file;
    this.db = new SQL.Database(fs.existsSync(file) ? fs.readFileSync(file) : undefined);
    this.gen = 0; // bumped whenever sql.js invalidates prepared statements (on export)
    this.depth = 0;
    this.pragmas = [];
  }
  pragma(p) {
    this.pragmas.push(p);
    this.db.exec(`PRAGMA ${p}`);
  }
  // DDL only (schema set-up); call save() explicitly if the file needs creating.
  exec(sql) {
    this.db.exec(sql);
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  transaction(fn) {
    return (...args) => {
      this.db.exec('BEGIN');
      this.depth++;
      try {
        const out = fn(...args);
        this.depth--;
        this.db.exec('COMMIT');
        this.save();
        return out;
      } catch (e) {
        this.depth--;
        try {
          this.db.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        throw e;
      }
    };
  }
  // Write the whole database file atomically (temp file + rename).
  save() {
    const data = this.db.export(); // note: sql.js closes/reopens internally, freeing statements
    this.gen++;
    for (const p of this.pragmas) this.db.exec(`PRAGMA ${p}`);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, this.file);
  }
}
