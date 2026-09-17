const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '_writetest.txt');
fs.writeFileSync(p, 'hello ' + Date.now(), 'utf8');
process.stdout.write('wrote ' + p + ' exists=' + fs.existsSync(p) + '\n');
