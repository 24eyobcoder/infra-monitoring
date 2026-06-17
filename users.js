// users.js — multi-user accounts backed by the shared SQLite database (db.js).
// Passwords are stored salted + hashed with scrypt (Node's built-in crypto — no deps).
// The env-based "admin" in auth.js stays as a bootstrap account; these are the rest.
const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,           -- "saltHex:hashHex"
    role          TEXT NOT NULL DEFAULT 'member',
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );
`);

const stmtByName = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
const stmtInsert = db.prepare(`INSERT INTO users (username, password_hash, role, created_at)
                               VALUES (@username, @password_hash, @role, @created_at)`);
const stmtAll    = db.prepare('SELECT id, username, role, disabled, created_at FROM users ORDER BY id');

// ---- password hashing (scrypt) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  let actual;
  try { actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length); }
  catch { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// ---- queries ----
function findByUsername(username) {
  return stmtByName.get(String(username || '').trim());
}

function createUser({ username, password, role = 'member' }) {
  const u = String(username || '').trim();
  const info = stmtInsert.run({
    username: u,
    password_hash: hashPassword(password),
    role,
    created_at: new Date().toISOString(),
  });
  return { id: info.lastInsertRowid, username: u, role };
}

function list() { return stmtAll.all(); }

module.exports = { hashPassword, verifyPassword, findByUsername, createUser, list };
