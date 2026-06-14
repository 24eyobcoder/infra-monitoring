// db.js — SQLite persistence for alerts (so they survive restarts and feed reports).
// Uses better-sqlite3 (synchronous, fast). The DB file lives next to the code.
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'alerts.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // better concurrency for our read-heavy dashboard

db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    severity   TEXT NOT NULL,
    host       TEXT,
    title      TEXT,
    problems   TEXT,            -- JSON array of the problem lines
    raw        TEXT,
    summary    TEXT,            -- AI-generated human-readable text
    created_at TEXT NOT NULL,   -- ISO timestamp — the report time axis
    dismissed  INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
  CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
`);

// ---- prepared statements ----
const stmtInsert = db.prepare(`
  INSERT INTO alerts (severity, host, title, problems, raw, summary, created_at)
  VALUES (@severity, @host, @title, @problems, @raw, @summary, @created_at)
`);
const stmtActive  = db.prepare(`SELECT * FROM alerts WHERE dismissed = 0 ORDER BY id DESC LIMIT ?`);
const stmtById    = db.prepare(`SELECT * FROM alerts WHERE id = ?`);
const stmtDismiss = db.prepare(`UPDATE alerts SET dismissed = 1 WHERE id = ?`);
const stmtClear   = db.prepare(`DELETE FROM alerts`);

// Turn a DB row into the shape the dashboard/API expects (problems back to array,
// created_at exposed as `time` for the existing front-end code).
function rowToAlert(row) {
  if (!row) return null;
  let problems = [];
  try { problems = row.problems ? JSON.parse(row.problems) : []; } catch (_) {}
  return {
    id: row.id,
    severity: row.severity,
    host: row.host,
    title: row.title,
    problems,
    raw: row.raw,
    summary: row.summary,
    time: row.created_at,
    dismissed: !!row.dismissed,
  };
}

function insert(alert) {
  const info = stmtInsert.run({
    severity: (alert.severity || 'warning').toLowerCase(),
    host: alert.host || 'unknown',
    title: alert.title || 'Alert',
    problems: JSON.stringify(Array.isArray(alert.problems) ? alert.problems : []),
    raw: alert.raw || '',
    summary: alert.summary || '',
    created_at: alert.time || new Date().toISOString(),
  });
  return rowToAlert(stmtById.get(info.lastInsertRowid));
}

function getActive(limit = 50) {
  return stmtActive.all(limit).map(rowToAlert);
}

function dismiss(id) {
  stmtDismiss.run(id);
}

function clear() {
  stmtClear.run();
}

// ---- reporting ----
// Aggregate stats over an optional [from, to] ISO window (defaults to all time).
function report({ from, to } = {}) {
  const where = [];
  const params = {};
  if (from) { where.push('created_at >= @from'); params.from = from; }
  if (to)   { where.push('created_at <= @to');   params.to = to; }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) n FROM alerts ${clause}`).get(params).n;

  const bySeverity = db.prepare(
    `SELECT severity, COUNT(*) n FROM alerts ${clause} GROUP BY severity ORDER BY n DESC`
  ).all(params);

  const byHost = db.prepare(
    `SELECT host, COUNT(*) n FROM alerts ${clause} GROUP BY host ORDER BY n DESC`
  ).all(params);

  // Per-day counts split by severity — handy for a trend report.
  const byDay = db.prepare(
    `SELECT substr(created_at, 1, 10) day,
            SUM(severity = 'critical') critical,
            SUM(severity = 'warning')  warning,
            COUNT(*) total
     FROM alerts ${clause}
     GROUP BY day ORDER BY day DESC`
  ).all(params);

  const range = db.prepare(
    `SELECT MIN(created_at) first, MAX(created_at) last FROM alerts ${clause}`
  ).get(params);

  return { total, range, bySeverity, byHost, byDay, from: from || null, to: to || null };
}

module.exports = { insert, getActive, dismiss, clear, report, rowToAlert, db };
