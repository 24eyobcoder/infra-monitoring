// checks.js
const ping = require('ping');   // runs the system "ping" command for us
const net = require('net');     // built into Node — opens raw TCP connections

// 1) PING — "can I reach this host at all?"  Works for ANY device (server, switch, AP, UPS)
async function checkPing(host) {
  try {
    const res = await ping.promise.probe(host, { timeout: 5 });
    return {
      up: res.alive,                                // true if it answered
      ms: res.alive ? Math.round(res.time) : null,  // round-trip time
    };
  } catch (err) {
    return { up: false, ms: null, error: err.message };
  }
}

// 2) HTTP — "is this website responding healthily?"  Deeper than ping.
async function checkHttp(url) {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return {
      up: res.ok,              // true for status codes 200–299
      ms: Date.now() - start,  // how long the response took
      status: res.status,      // the actual code, e.g. 200 or 503
    };
  } catch (err) {
    return { up: false, ms: null, error: err.message };
  }
}

// 3) PORT — "is a specific service port open?"  e.g. 3306 = MySQL alive
function checkPort(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(5000);

    socket.once('connect', () => {                   // port is open
      socket.destroy();
      resolve({ up: true, ms: Date.now() - start });
    });
    socket.once('timeout', () => { socket.destroy(); resolve({ up: false, ms: null }); });
    socket.once('error',   () => { socket.destroy(); resolve({ up: false, ms: null }); });

    socket.connect(port, host);
  });
}

module.exports = { checkPing, checkHttp, checkPort };