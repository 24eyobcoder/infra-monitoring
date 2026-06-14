// alerts.js — alert domain logic, backed by the SQLite store in db.js.
// Persists every alert (with timestamp) so it survives restarts and feeds reports.
// "Dismissing" only hides an alert from the dashboard; the row is kept for the report.
const db = require('./db');

const DASHBOARD_LIMIT = 50; // how many active alerts the dashboard shows

function add(alert) {
  return db.insert(alert);
}

// Active (non-dismissed) alerts, newest first — what the dashboard renders.
function getAll() {
  return db.getActive(DASHBOARD_LIMIT);
}

// Hide from the dashboard but keep the row for reporting.
function remove(id) {
  db.dismiss(id);
}

// Wipe everything (admin/testing only).
function clear() {
  db.clear();
}

// Aggregated report over an optional { from, to } ISO window.
function report(range) {
  return db.report(range);
}

module.exports = { add, getAll, remove, clear, report };
