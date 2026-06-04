// test.js
const { checkPing, checkHttp, checkPort } = require('./checks');

(async () => {
  console.log('HTTP  ->', await checkHttp('https://github.com'));
  console.log('PORT  ->', await checkPort('github.com', 443));
  console.log('PING  ->', await checkPing('8.8.8.8'));
})();