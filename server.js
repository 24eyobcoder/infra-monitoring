// server.js — Express app: serves the dashboard, the device status API,
// and the Munin alert webhook (which runs each alert through the AI layer).
require('dotenv').config();
const path = require('path');
const express = require('express');
const monitor = require('./monitor');
const alerts = require('./alerts');
const { analyzeAlert } = require('./ai');
const telegram = require('./telegram');
const auth = require('./auth');
const users = require('./users');

const PORT = process.env.PORT || 3000;
const SIGNUP_CODE = process.env.SIGNUP_CODE || '';            // empty => signup disabled
const ADMIN_USER  = process.env.AUTH_USERNAME || 'admin';     // reserved username

const app = express();
app.use(express.json());                       // parse JSON bodies

// ============================================================================
//  Public routes — reachable WITHOUT a logged-in session.
// ============================================================================

// Login page. If already logged in, skip straight to the dashboard.
app.get('/login', (req, res) => {
  if (auth.currentUser(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Authenticate and start a session.
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const session = auth.verifyCredentials(username, password);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Invalid username or password' });
  }
  auth.setSession(res, session);
  res.json({ ok: true });
});

// End the session.
app.post('/api/logout', (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

// Signup page (invite-code gated). Skip to the dashboard if already logged in.
app.get('/signup', (req, res) => {
  if (auth.currentUser(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

// Lets the login/signup pages know whether self-registration is turned on.
app.get('/api/signup-status', (req, res) => {
  res.json({ enabled: !!SIGNUP_CODE });
});

// Register a new account with a valid invite code, then log them straight in.
app.post('/api/signup', (req, res) => {
  if (!SIGNUP_CODE) {
    return res.status(403).json({ ok: false, error: 'Signup is disabled on this server.' });
  }
  const { username, password, code } = req.body || {};

  if (!auth.timingEqual(String(code || ''), SIGNUP_CODE)) {
    return res.status(403).json({ ok: false, error: 'Invalid invite code.' });
  }
  const u = String(username || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u)) {
    return res.status(400).json({ ok: false, error: 'Username must be 3–32 characters (letters, numbers, . _ -).' });
  }
  if (u.toLowerCase() === ADMIN_USER.toLowerCase()) {
    return res.status(409).json({ ok: false, error: 'That username is reserved.' });
  }
  if (String(password || '').length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.' });
  }
  if (users.findByUsername(u)) {
    return res.status(409).json({ ok: false, error: 'That username is already taken.' });
  }

  let created;
  try {
    created = users.createUser({ username: u, password, role: 'member' });
  } catch (err) {
    return res.status(409).json({ ok: false, error: 'That username is already taken.' });
  }
  auth.setSession(res, { user: created.username, role: created.role });
  res.json({ ok: true });
});

// Munin webhook — machine-to-machine, so it is NOT behind the dashboard login.
// (Production TODO: require a shared-secret token header here.)
app.post('/api/munin-alert', async (req, res) => {
  const alert = req.body || {};
  console.log('Munin alert:', alert.severity, '|', alert.host, '|', alert.title);

  const { summary, category } = await analyzeAlert(alert);
  const entry = alerts.add({ ...alert, summary, category });
  console.log(`  → [${category}] ${summary}`);

  // Push to Telegram (fire-and-forget — never blocks/blows up the webhook response).
  telegram.sendAlert(entry).then(ok => {
    if (ok) console.log('  → telegram sent');
  });

  res.json({ ok: true, summary, id: entry.id });
});

// ============================================================================
//  Everything below this line requires a valid session.
// ============================================================================
app.use(auth.requireAuth);

app.use(express.static(path.join(__dirname, 'public')));  // serves index.html at /

// Current logged-in user (so the dashboard can show who you are / a logout button).
app.get('/api/me', (req, res) => {
  const s = auth.currentUser(req);
  res.json({ user: s.user, role: s.role });
});

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

// The standalone devices page (full device grid with search/filter).
app.get('/devices', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'devices.html'));
});

// The standalone report page.
app.get('/report', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

// Start the monitor loop AND the web server together.
monitor.start(30000); // check devices every 30 seconds
app.listen(PORT, () => {
  console.log(`InfraWatch running at http://localhost:${PORT}`);
});
