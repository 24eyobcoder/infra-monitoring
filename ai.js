// ai.js — turns a raw Munin alert payload into a short, human-readable summary
// AND a category, using Google's Gemini model. Falls back to a plain message +
// keyword-based category if no API key is set or the call fails.
const { GoogleGenAI } = require('@google/genai');

const API_KEY = process.env.GOOGLE_API_KEY;
const MODEL = process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash';

// Only create the client if we actually have a key — otherwise we run in fallback mode.
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

// The fixed set of categories we ask the model to choose from (keeps the UI tidy).
const CATEGORIES = ['Disk', 'CPU', 'Memory', 'Network', 'Service', 'Power', 'Security', 'Other'];

const SYSTEM_PROMPT = `You are an operations assistant for a network monitoring tool.
You receive raw Munin alert data (the threshold breach Munin emails to admins).

Respond with a JSON object: {"summary": string, "category": string}.
- "summary": a calm, clear, NON-technical-friendly explanation for an on-call engineer.
    2-3 short sentences, plain English, no markdown. Say WHICH host and WHAT is wrong,
    translate the metric/value into plain terms, and end with one concrete next step.
- "category": EXACTLY one of: ${CATEGORIES.join(', ')}. Pick the best fit for the problem.`;

// Build a tidy prompt out of the alert fields.
function buildPrompt(alert) {
  const problems = Array.isArray(alert.problems) && alert.problems.length
    ? alert.problems.join('\n')
    : '(none parsed)';
  return [
    `Severity: ${alert.severity || 'unknown'}`,
    `Host: ${alert.host || 'unknown'}`,
    `Title: ${alert.title || 'unknown'}`,
    '',
    'Problem lines:',
    problems,
    '',
    'Raw Munin output:',
    alert.raw || '(none)',
  ].join('\n');
}

// Pull the actual problem readings (the lines with the numbers) out of the alert.
function detailLines(alert) {
  let lines = Array.isArray(alert.problems) ? alert.problems.slice() : [];
  if (!lines.length && alert.raw) {
    lines = alert.raw.split('\n');
  }
  return lines
    .filter(l => /\b(CRITICAL|WARNING|UNKNOWN)s?\b/i.test(l) && !l.includes('::'))
    .filter(l => !/^\s*OKs?:/i.test(l))
    .map(l => l.replace(/^\s*(CRITICAL|WARNING|UNKNOWN)s?:\s*/i, '').trim())
    .filter(Boolean);
}

// Plain fallback summary for when the AI is unavailable.
function fallbackMessage(alert) {
  const sev = (alert.severity || 'alert').toUpperCase();
  const host = alert.host || 'a host';
  const title = alert.title || 'threshold breached';
  const details = detailLines(alert).join('; ');
  const base = `[${sev}] ${host} — ${title}`;
  return details ? `${base}: ${details}` : `${base}.`;
}

// Deterministic keyword categorizer — used as a fallback, and to sanity-check the AI.
function categorize(alert) {
  const text = [alert.title, (alert.problems || []).join(' '), alert.raw]
    .filter(Boolean).join(' ').toLowerCase();
  const rules = [
    ['Disk',     /disk|inode|filesystem|\bdf\b|storage|volume|partition/],
    ['Memory',   /memory|\bram\b|swap|oom|out of memory/],
    ['CPU',      /\bcpu\b|load average|\bload\b|processor/],
    ['Power',    /\bups\b|battery|on battery|power|psu|voltage/],
    ['Security', /unauthorized|breach|intrusion|failed login|brute|firewall|denied/],
    ['Network',  /ping|packet|latency|unreachable|interface|link|bandwidth|dns|timeout|down/],
    ['Service',  /service|http|port|process|daemon|nginx|apache|mysql|postgres|api|5\d\d\b/],
  ];
  for (const [cat, re] of rules) if (re.test(text)) return cat;
  return 'Other';
}

// Normalize whatever the model returned into one of our known categories.
function normalizeCategory(value, alert) {
  if (typeof value === 'string') {
    const hit = CATEGORIES.find(c => c.toLowerCase() === value.trim().toLowerCase());
    if (hit) return hit;
  }
  return categorize(alert);
}

// How hard we try the AI before giving up and using the fallback.
const MAX_ATTEMPTS = Number(process.env.AI_MAX_ATTEMPTS || 2);
const RETRY_DELAY_MS = Number(process.env.AI_RETRY_DELAY_MS || 1500);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Worth retrying? Network blips / timeouts / 5xx can recover; permanent client errors
// (400/401/403/404) and 429 rate-limits cannot within our short window.
function isRetryable(err) {
  const m = String(err && err.message || '');
  const code = (m.match(/"code"\s*:\s*(\d{3})/) || [])[1];
  if (code) return !['400', '401', '403', '404', '429'].includes(code);
  return true;
}

// Returns { summary, category }. Never throws — degrades to the fallback.
// Retries transient failures before falling back.
async function analyzeAlert(alert) {
  const fallback = () => ({ summary: fallbackMessage(alert), category: categorize(alert) });
  if (!ai) return fallback();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(alert),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.3,
          maxOutputTokens: 300,
          responseMimeType: 'application/json',
          // gemini-2.5-* "thinks" by default, which silently eats the output-token
          // budget and leaves the answer truncated. We want the answer, not reasoning.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const text = (res.text || '').trim();
      if (!text) { console.error('AI returned empty text; using fallback'); break; }

      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
      const summary = parsed && typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : text;
      return { summary, category: normalizeCategory(parsed && parsed.category, alert) };
    } catch (err) {
      const retryable = isRetryable(err);
      const last = attempt === MAX_ATTEMPTS || !retryable;
      console.error(`AI analyze attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}` +
        (last ? ' — using fallback' : `; retrying in ${RETRY_DELAY_MS}ms`));
      if (last) break;
      await sleep(RETRY_DELAY_MS);
    }
  }
  return fallback();
}

// Back-compat: callers that only want the summary text.
async function summarizeAlert(alert) {
  return (await analyzeAlert(alert)).summary;
}

module.exports = { analyzeAlert, summarizeAlert, fallbackMessage, categorize, CATEGORIES };
