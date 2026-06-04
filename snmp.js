// snmp.js
const snmp = require('net-snmp');

// Well-known OIDs that EVERY SNMP device exposes (the SNMP standard).
const OID = {
  uptime: '1.3.6.1.2.1.1.3.0',   // how long the device has been running
  descr:  '1.3.6.1.2.1.1.1.0',   // a text description of the device
};

// Standard UPS OIDs (RFC 1628 — the UPS standard most units follow).
const UPS_OID = {
  charge:  '1.3.6.1.2.1.33.1.2.4.0', // battery charge remaining, %
  runtime: '1.3.6.1.2.1.33.1.2.3.0', // estimated minutes of runtime left
  source:  '1.3.6.1.2.1.33.1.4.1.0', // power source: 3 = mains, 5 = on battery
};

// CORE HELPER: ask a device for a list of OIDs, get back their values.
function getOids(host, community, oids, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const session = snmp.createSession(host, community, { timeout: timeoutMs, retries: 1 });

    session.get(oids, (error, varbinds) => {
      if (error) {                                 // device didn't answer
        session.close();
        resolve({ ok: false, values: {} });
        return;
      }
      const values = {};
      for (const vb of varbinds) {
        // a string comes back as a Buffer, so convert it to text
        values[vb.oid] = Buffer.isBuffer(vb.value) ? vb.value.toString() : vb.value;
      }
      session.close();
      resolve({ ok: true, values });
    });
  });
}

// GENERIC SNMP CHECK — for switches, APs, anything: is it responding, + uptime.
async function checkSnmp(host, community = 'public') {
  const start = Date.now();
  const res = await getOids(host, community, [OID.uptime, OID.descr]);
  if (!res.ok) return { up: false, ms: null, metrics: {} };
  return {
    up: true,
    ms: Date.now() - start,
    metrics: { descr: res.values[OID.descr] },
  };
}

// UPS CHECK — battery %, runtime, and the all-important "on battery?" flag.
async function checkUps(host, community = 'public') {
  const start = Date.now();
  const res = await getOids(host, community,
    [UPS_OID.charge, UPS_OID.runtime, UPS_OID.source]);
  if (!res.ok) return { up: false, ms: null, metrics: {} };
  return {
    up: true,
    ms: Date.now() - start,
    metrics: {
      battery: res.values[UPS_OID.charge],        // e.g. 100 (%)
      runtimeMin: res.values[UPS_OID.runtime],    // e.g. 45 (minutes)
      onBattery: res.values[UPS_OID.source] === 5, // true = mains power LOST
    },
  };
}

module.exports = { checkSnmp, checkUps };