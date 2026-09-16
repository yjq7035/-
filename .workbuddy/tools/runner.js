'use strict';
const fs = require('fs');
const path = require('path');
const target = process.argv[2];
const errOut = process.argv[3] || path.join(__dirname, '_error.txt');
const logs = [];
const origLog = console.log, origErr = console.error;
console.log = (...a) => { logs.push(a.map(String).join(' ')); origLog(...a); };
console.error = (...a) => { logs.push('[err] ' + a.map(String).join(' ')); origErr(...a); };
try {
  require(path.resolve(target));
  fs.writeFileSync(errOut.replace(/_error\.txt$/, '_run.txt'), 'OK\n' + logs.join('\n'), 'utf8');
} catch (e) {
  fs.writeFileSync(errOut, (e && e.stack) || String(e), 'utf8');
  fs.writeFileSync(errOut.replace(/_error\.txt$/, '_run.txt'), 'THREW\n' + logs.join('\n'), 'utf8');
}
