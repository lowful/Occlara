// Downloads the models the Trainer is built from (sources.json) into a
// folder, one folder per model, as build.js expects them:
//
//   node scripts/trainer-models/fetch.js <raw dir>
//
// The downloads are never committed: only what build.js makes of them ships
// (src/renderer/trainer/models/). A file whose size is not the one read on
// 19 Nov 2026 is still kept, and said, so a changed source is noticed.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const { sources } = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/trainer-models/fetch.js <raw dir>'); process.exit(1); }

const get = (url) => new Promise((resolve, reject) => {
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
    if (res.statusCode !== 200) { res.resume(); reject(new Error(`${url}: ${res.statusCode}`)); return; }
    const parts = [];
    res.on('data', (d) => parts.push(d));
    res.on('end', () => resolve(Buffer.concat(parts)));
  }).on('error', reject);
});

(async () => {
  for (const s of sources) {
    const to = path.join(dir, s.name, `${s.name}.glb`);
    if (fs.existsSync(to)) { console.log('have', s.name); continue; }
    const body = await get(s.file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, body);
    console.log('got ', s.name, body.length, 'bytes', body.length === s.bytes ? '' : `(was ${s.bytes} when it was read: look at ${s.page} again)`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
