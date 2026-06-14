// ai.js — turns a raw Munin alert payload into a short, human-readable summary
// using Google's Gemini model. Falls back to a plain message if no API key is set.
const { GoogleGenAI } = require('@google/genai');

const API_KEY = process.env.GOOGLE_API_KEY;
const MODEL = process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash';

// Only create the client if we actually have a key — otherwise we run in fallback mode.
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

const SYSTEM_PROMPT = `You are an operations assistant for a network monitoring tool.
You receive raw Munin alert data (the threshold breach Munin emails to admins).
Rewrite it as a calm, clear, NON-technical-friendly explanation for an on-call engineer.

Rules:
- 2-3 short sentences, plain English. No markdown, no preamble.
- Say WHICH host and WHAT is wrong (e.g. disk almost full, CPU pinned, service down).
- Translate the metric/value into plain terms when you can.
- End with one concrete suggested next step.`;

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
// Prefers the parsed `problems` array; falls back to scraping the raw Munin text.
function detailLines(alert) {
  let lines = Array.isArray(alert.problems) ? alert.problems.slice() : [];
  if (!lines.length && alert.raw) {
    lines = alert.raw.split('\n');
  }
  return lines
    .filter(l => /\b(CRITICAL|WARNING|UNKNOWN)s?\b/i.test(l) && !l.includes('::')) // only real problems
    .filter(l => !/^\s*OKs?:/i.test(l))                                            // never the OK readings
    .map(l => l.replace(/^\s*(CRITICAL|WARNING|UNKNOWN)s?:\s*/i, '').trim())        // drop the label
    .filter(Boolean);
}

// Plain fallback for when the AI is unavailable (no key / network error / timeout).
// Still meaningful: shows the host, the metric, and the actual numbers that tripped.
function fallbackMessage(alert) {
  const sev = (alert.severity || 'alert').toUpperCase();
  const host = alert.host || 'a host';
  const title = alert.title || 'threshold breached';
  const details = detailLines(alert).join('; ');
  const base = `[${sev}] ${host} — ${title}`;
  return details ? `${base}: ${details}` : `${base}.`;
}

// How hard we try the AI before giving up and using the fallback.
const MAX_ATTEMPTS = Number(process.env.AI_MAX_ATTEMPTS || 2); // total tries (1 retry)
const RETRY_DELAY_MS = Number(process.env.AI_RETRY_DELAY_MS || 1500);

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Worth retrying? Network blips / timeouts / 5xx can recover within our short window.
// NOT worth it: permanent client errors (400/401/403/404), and 429 quota/rate-limit
// errors — those come with a multi-second RetryInfo our 1.5s retry can't satisfy, so
// we fail fast to the fallback instead of stalling each alert.
function isRetryable(err) {
  const m = String(err && err.message || '');
  const code = (m.match(/"code"\s*:\s*(\d{3})/) || [])[1];
  if (code) return !['400', '401', '403', '404', '429'].includes(code);
  return true; // no HTTP code (e.g. "fetch failed", timeout) => transient
}

// Returns a human-readable summary string. Never throws — degrades to fallback.
// Retries transient failures (network blips, timeouts) before falling back.
async function summarizeAlert(alert) {
  if (!ai) return fallbackMessage(alert);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(alert),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.3,
          maxOutputTokens: 300,
          // gemini-2.5-* "thinks" by default, which silently eats the output-token
          // budget and leaves the answer truncated. We want the answer, not reasoning.
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const text = (res.text || '').trim();
      if (text) return text;
      // Empty response isn't worth retrying — just fall back.
      console.error('AI returned empty text; using fallback');
      break;
    } catch (err) {
      const retryable = isRetryable(err);
      const last = attempt === MAX_ATTEMPTS || !retryable;
      console.error(`AI summarize attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}` +
        (last ? ' — using fallback' : `; retrying in ${RETRY_DELAY_MS}ms`));
      if (last) break;
      await sleep(RETRY_DELAY_MS);
    }
  }
  return fallbackMessage(alert);
}

module.exports = { summarizeAlert, fallbackMessage };
