// telegram.js — pushes each alert (AI summary or fallback) to a Telegram channel
// via the Bot API. No-ops gracefully if not configured. Never throws.
//
// Setup:
//   1. Create a bot with @BotFather -> get the token.
//   2. Add the bot to your channel as an ADMIN (so it can post).
//   3. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.
//      - Public channel:  TELEGRAM_CHAT_ID=@yourchannelname
//      - Private channel: numeric id like -1001234567890 (see README note below).

const https = require('https');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}/sendMessage` : null;

const enabled = !!(TOKEN && CHAT_ID);
if (!enabled) {
  console.warn('Telegram disabled: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to enable.');
}

const EMOJI = { critical: '🔴', warning: '🟡', unknown: '⚪', info: '🔵' };

// Telegram HTML parse_mode only needs these three escaped.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function buildMessage(alert) {
  const sev = (alert.severity || 'alert').toLowerCase();
  const icon = EMOJI[sev] || '⚠️';
  const when = alert.time ? new Date(alert.time).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '';
  return [
    `${icon} <b>${esc(sev.toUpperCase())}</b> — <code>${esc(alert.host || 'unknown')}</code>`,
    `<b>${esc(alert.title || 'Alert')}</b>`,
    '',
    esc(alert.summary || ''),
    when ? `\n🕐 ${esc(when)}` : '',
  ].join('\n');
}

// POST JSON to the Telegram API over IPv4. We force `family: 4` because Telegram
// publishes an AAAA record and Node will otherwise try the (often unrouteable)
// IPv6 address and hang until timeout — curl falls back to IPv4, Node's fetch does
// not reliably. Resolves to the parsed response, rejects on network/timeout.
function postJson(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(API, {
      method: 'POST',
      family: 4, // IPv4 only — avoids the dead IPv6 path
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('request timed out')); });
    req.end(body);
  });
}

// Send an alert to the channel. Fire-and-forget friendly: resolves to true/false,
// logs its own errors, and never rejects.
async function sendAlert(alert) {
  if (!enabled) return false;
  try {
    const { status, json, raw } = await postJson({
      chat_id: CHAT_ID,
      text: buildMessage(alert),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    if (!json.ok) {
      console.error(`Telegram send failed: HTTP ${status} ${raw}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Telegram send failed:', err.message);
    return false;
  }
}

module.exports = { sendAlert, enabled };
