// server.js — Express app: serves the dashboard, the device status API,
// and the Munin alert webhook (which runs each alert through the AI layer).
require('dotenv').config();
const path = require('path');
const express = require('express');
const monitor = require('./monitor');
const alerts = require('./alerts');
const { summarizeAlert } = require('./ai');
const telegram = require('./telegram');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());                       // parse JSON bodies
app.use(express.static(path.join(__dirname, 'public')));  // serves index.html at /

// Latest snapshot of every monitored device.
app.get('/api/status', (req, res) => {
  res.json(monitor.getLatest());
});

// Recent critical/warning alerts (with AI summaries) for the dashboard.
app.get('/api/alerts', (req, res) => {
  res.json(alerts.getAll());
});

// Dismiss a single alert from the dashboard (kept in the DB for reporting).
app.delete('/api/alerts/:id', (req, res) => {
  alerts.remove(Number(req.params.id));
  res.json({ ok: true });
});

// Aggregated alert report. Optional ?from=ISO&to=ISO to bound the time window.
app.get('/api/report', (req, res) => {
  res.json(alerts.report({ from: req.query.from, to: req.query.to }));
});

// The standalone report page.
app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

// Munin webhook — receives a critical/warning alert, asks the AI layer to make it
// human-readable, stores it so it shows on the dashboard, and returns the summary.
app.post('/api/munin-alert', async (req, res) => {
  const alert = req.body || {};
  console.log('Munin alert:', alert.severity, '|', alert.host, '|', alert.title);

  const summary = await summarizeAlert(alert);
  const entry = alerts.add({ ...alert, summary });
  console.log('  → summary:', summary);

  // Push to Telegram (fire-and-forget — never blocks/blows up the webhook response).
  telegram.sendAlert(entry).then(ok => {
    if (ok) console.log('  → telegram sent');
  });

  res.json({ ok: true, summary, id: entry.id });
});

// Start the monitor loop AND the web server together.
monitor.start(30000); // check devices every 30 seconds
app.listen(PORT, () => {
  console.log(`InfraWatch running at http://localhost:${PORT}`);
});
