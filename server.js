// server.js
const http = require('http');       // built into Node — no install
const fs = require('fs');           // built in — reads files from disk
const path = require('path');       // built in — handles file paths safely
const monitor = require('./monitor');

const PORT = 3000;

const server = http.createServer((req, res) => {

  // ROUTE 1: the status API — returns the latest snapshot as JSON
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(monitor.getLatest()));
    return;
  }

  // ROUTE 2: the dashboard page — serves the HTML file
  if (req.url === '/' || req.url === '/index.html') {
    const file = path.join(__dirname, 'public', 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Could not load dashboard');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // Anything else: not found
  res.writeHead(404);
  res.end('Not found');
});

// Start the monitor loop AND the web server together.
monitor.start(30000); // check devices every 30 seconds
server.listen(PORT, () => {
  console.log(`InfraWatch running at http://localhost:${PORT}`);
});