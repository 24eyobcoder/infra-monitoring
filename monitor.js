// monitor.js
const { checkPing, checkHttp, checkPort } = require('./checks');
const { checkSnmp, checkUps } = require('./snmp');
const targets = require('./targets');

const DEFAULT_SLOW_MS = 800; // slower than this = "slow" (yellow)

let latest = []; // most recent status of every device, in memory

// Turn a raw {up, ms} result into one of three words.
function classify(result, slowMs) {
  if (!result.up) return 'down';
  if (result.ms != null && result.ms > slowMs) return 'slow';
  return 'up';
}

// Run the correct check for ONE device and return a tidy status object.
async function checkOne(target) {
  let result;
  if (target.check === 'http')      result = await checkHttp(target.url);
  else if (target.check === 'port') result = await checkPort(target.host, target.port);
  else if (target.check === 'snmp') result = await checkSnmp(target.host, target.community);
  else if (target.check === 'ups')  result = await checkUps(target.host, target.community);
  else                              result = await checkPing(target.host);

  const slowMs = target.slowMs || DEFAULT_SLOW_MS;
  return {
    name: target.name,
    group: target.group,
    address: target.url || `${target.host}${target.port ? ':' + target.port : ''}`,
    status: classify(result, slowMs),  // 'up' | 'slow' | 'down'
    ms: result.ms,
    metrics: result.metrics || {},     // extra data from SNMP/UPS checks
    lastChecked: new Date().toISOString(),
  };
}

// Check EVERY device, all at the same time.
async function runAllChecks() {
  latest = await Promise.all(targets.map(checkOne));
  const up = latest.filter(d => d.status === 'up').length;
  console.log(`[${new Date().toLocaleTimeString()}] checked ${latest.length} devices — ${up} up`);
}

function getLatest() {
  return latest;
}

// Start monitoring: check now, then every interval.
function start(intervalMs = 30000) {
  runAllChecks();
  setInterval(runAllChecks, intervalMs);
}

module.exports = { start, getLatest, runAllChecks };