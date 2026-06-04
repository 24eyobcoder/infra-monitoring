// targets.js
module.exports = [
  // HTTP check: is a website responding healthily?
  { name: 'Etech Website', group: 'Servers', check: 'http', url: 'https://etechsc.com/' },

  // PORT check: is a specific service port open?
  //{ name: 'GitHub HTTPS', group: 'Servers', check: 'port', host: 'github.com', port: 443 },

  // PING check: is a device reachable? (best for switches / APs / UPS)
  //{ name: 'Cloudflare DNS', group: 'Other', check: 'ping', host: '1.1.1.1' },

  // ===== Replace with YOUR real devices, e.g.: =====
  // { name: 'Web App Server',  group: 'Servers',       check: 'http', url: 'http://10.0.1.10' },
  // { name: 'Database Server', group: 'Servers',       check: 'port', host: '10.0.1.11', port: 3306 },
   { name: 'Core Switch',     group: 'Switches',      check: 'ping', host: '10.10.10.2' },
   { name: 'AP etechsc',    group: 'Access Points', check: 'ping', host: '10.10.4.1' },
   { name: 'prod-server',    group: 'Access Points', check: 'ping', host: '10.10.30.4'},
   { name: 'fortiget-fw',    group: 'Access Points', check: 'ping', host: '10.10.10.1'},
  // { name: 'UPS Server Room', group: 'UPS',           check: 'ping', host: '10.0.3.31' },
];