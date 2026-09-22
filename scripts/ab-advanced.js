'use strict';

/**
 * Live A/B: the same real frames, advanced tips on and off, side by side.
 *
 * test:advancedtips measures RETRIEVAL, which is the half that can be checked
 * offline: it proves the mix shifts from 34% to 75% advanced notes. It cannot
 * say whether the tip the player actually reads gets better, because that
 * depends on a model reading a screenshot, and no offline check grades whether
 * advice is insightful. review-log.js says as much in as many words.
 *
 * So this sends real logged frames through the live server twice, once with
 * advancedTips true and once false, and prints both tips against each other for
 * a human to read. It is a LOOKING tool, not a passing tool, which is why it is
 * a bench: script rather than a check: or test:, and why run-all.js does not
 * pick it up. It spends real money on the AI provider.
 *
 *   npm run bench:advanced            6 frames from the newest session
 *   npm run bench:advanced -- --frames 12
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const FRAMES = Number(flag('frames', 6));
const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';

const APPDATA = process.env.APPDATA || '';
const cfg = JSON.parse(fs.readFileSync(path.join(APPDATA, 'Occlara', 'occlara-config.json'), 'utf8'));
const root = path.join(APPDATA, 'Occlara', 'ai-log');
const session = fs.readdirSync(root).filter((d) => d.startsWith('session-')).sort().reverse()[0];
const log = JSON.parse(fs.readFileSync(path.join(root, session, 'log.json'), 'utf8'));

/*
 * FRAMES THAT PRODUCED A TIP, spread across the session.
 *
 * Most frames are rejected by the guards and a few are lobby screens. Picking
 * the ones that already produced a shown tip means both arms of the A/B have
 * something to say, so a blank is a real difference rather than a dull frame.
 */
const usable = (log.records || []).filter((r) => r && r.frame && r.state && r.shown && r.shown.text);
const step = Math.max(1, Math.floor(usable.length / FRAMES));
const picked = usable.filter((_, i) => i % step === 0).slice(0, FRAMES);

function ask(image, state, advanced) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      image,
      context: {
        agent: state.agent || null,
        map: state.map || null,
        side: state.side || null,
        phase: state.phase || null,
        roundNumber: state.roundNumber || 0,
        playerWeapon: state.playerWeapon || null,
        playerAlive: state.playerAlive !== false,
        teammatesAlive: state.teammatesAlive,
        enemiesAlive: state.enemiesAlive,
        consecutiveDeaths: state.consecutiveDeaths || 0,
        proPlaybook: 'hybrid',
        advancedTips: advanced,
      },
    });
    const req = https.request(SERVER + '/api/coach/analyze', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-license-key': String(cfg.licenseKey || '').toUpperCase(),
      },
      timeout: 45000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(String(j.tip || '').trim() || '(no tip)');
        } catch { resolve('(unparseable: ' + res.statusCode + ')'); }
      });
    });
    req.on('error', (e) => resolve('(error: ' + e.message + ')'));
    req.on('timeout', () => { req.destroy(); resolve('(timeout)'); });
    req.end(body);
  });
}

const wrap = (s, w, pad) => {
  const words = String(s).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    if ((cur + ' ' + word).trim().length > w) { lines.push(cur.trim()); cur = word; }
    else cur += ' ' + word;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.map((l, i) => (i ? pad : '') + l).join('\n');
};

(async () => {
  console.log(`A/B on ${picked.length} frames from ${session}`);
  console.log(`server: ${SERVER}\n`);
  let differed = 0;

  for (const rec of picked) {
    const img = fs.readFileSync(path.join(root, session, rec.frame)).toString('base64');
    const st = rec.state || {};
    // Sequential, not parallel. Two vision calls at once against the same key
    // is how the rate limiter answers one of them with a 429 and the A/B
    // records a difference that was never about the toggle.
    const off = await ask(img, st, false);
    const on = await ask(img, st, true);
    if (off !== on) differed++;

    console.log(`── ${rec.frame}  ${st.side || '?'} ${st.phase || '?'} `
      + `${st.agent || 'no agent'} ${st.playerWeapon || ''}`.trimEnd());
    console.log('   OFF  ' + wrap(off, 84, '        '));
    console.log('   ON   ' + wrap(on, 84, '        '));
    console.log('');
  }

  console.log(`${differed} of ${picked.length} frames produced a different tip.`);
  console.log('Read them. The retrieval shift is already measured by');
  console.log('npm run test:advancedtips; this is the half only a human can grade.');
})();
