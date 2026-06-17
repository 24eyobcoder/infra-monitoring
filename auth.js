// auth.js — minimal, dependency-free cookie-session auth for the dashboard.
// A login issues a signed (HMAC) token cookie containing the username + an expiry.
// Stateless: nothing to store server-side, and it survives restarts as long as
// SESSION_SECRET is stable. The Munin webhook is intentionally NOT covered by this
// (it's machine-to-machine and should use its own shared secret).
const crypto = require('crypto');
const users = require('./users');

const USER   = process.env.AUTH_USERNAME || 'admin';
const PASS   = process.env.AUTH_PASSWORD || 'admin';
const COOKIE = 'iw_session';
const TTL_MS = Number(process.env.SESSION_TTL_HOURS || 168) * 3600 * 1000; // default 7 days
const SECURE = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] SESSION_SECRET not set — using a random one; logins will NOT survive a restart. Set SESSION_SECRET in .env for production.');
}
if (PASS === 'admin') {
  console.warn('[auth] Using the default password "admin". Set AUTH_PASSWORD in .env.');
}

const b64  = b => Buffer.from(b).toString('base64url');
const sha  = s => crypto.createHash('sha256').update(String(s)).digest();
const sign = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

// Constant-time compare. Hash both sides to a fixed 32 bytes so length never leaks
// and timingSafeEqual never throws on length mismatch.
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha(a), sha(b));
}

// Returns a session object { user, role } on success, or null. Checks the built-in
// env admin first, then falls back to the database users table.
function verifyCredentials(user, pass) {
  const uname = String(user || '').trim();

  // 1) Bootstrap admin from .env (always available, even before any DB user exists).
  if (safeEqual(uname, USER) && safeEqual(pass || '', PASS)) {
    return { user: USER, role: 'admin' };
  }

  // 2) Registered database users.
  const row = users.findByUsername(uname);
  if (row && !row.disabled && users.verifyPassword(pass || '', row.password_hash)) {
    return { user: row.username, role: row.role || 'member' };
  }
  return null;
}

function issueToken(session) {
  const body = b64(JSON.stringify({ u: session.user, r: session.role, exp: Date.now() + TTL_MS }));
  return body + '.' + sign(body);
}

function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expected = sign(body);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!payload || !payload.exp || payload.exp < Date.now()) return null;
  return { user: payload.u, role: payload.r || 'member' };
}

// Parse the Cookie header into an object (avoids pulling in cookie-parser).
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  return verifyToken(parseCookies(req)[COOKIE]);
}

// session is { user, role }.
function setSession(res, session) {
  res.cookie(COOKIE, issueToken(session), {
    httpOnly: true, sameSite: 'lax', secure: SECURE, path: '/', maxAge: TTL_MS,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// Gate middleware: API requests get a 401 JSON, page requests get redirected to /login.
function requireAuth(req, res, next) {
  if (currentUser(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login');
}

module.exports = {
  COOKIE, verifyCredentials, setSession, clearSession, currentUser, requireAuth,
  timingEqual: safeEqual, // constant-time string compare (used for the invite code)
};
