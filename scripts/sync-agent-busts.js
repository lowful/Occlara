'use strict';

/**
 * The square agent busts, downscaled to something an overlay can afford.
 *
 * TWO SETS OF AGENT ART, and the reason is that Riot ships two crops and they
 * are good at different sizes:
 *
 *   assets/agents/<Name>.png        killfeedPortrait, 128x64, about 10KB.
 *                                   A WIDE face crop, 2:1. This is the art the
 *                                   game itself puts next to a name in the kill
 *                                   feed, and it is legible small because that
 *                                   is what it was cut for.
 *
 *   assets/agents/bust/<Name>.png   displayIcon, downscaled from 1024x1024.
 *                                   The whole character, square.
 *
 * THE ORIGINAL IS 410KB AND 1024 SQUARE. Twenty nine of those is twelve
 * megabytes in the installer to draw a mark twenty pixels wide, and the runtime
 * cost of decoding a 1024px image for every tip card is worse than the disk.
 * So they are resampled once, here, at sync time.
 *
 * WHY THIS RUNS UNDER ELECTRON. Node has no image decoder, and the alternative
 * was a hand written PNG decoder plus resampler in this repo. Electron ships
 * one in nativeImage, this project already spawns Electron from scripts (see
 * check-learn-role.js and check-splash-timing.js), and a build tool depending on
 * a dependency the app already has is cheaper than three hundred lines of
 * bit twiddling that nothing else would ever use.
 *
 *   npm run sync:busts
 */

const path = require('path');
const fs = require('fs');

const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'assets', 'agents', 'bust');
const AGENTS_URL = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';

/** Rendered at about 20px inline, so 64 covers two times device pixel ratio. */
const SIZE = 64;

/** An agent name as a filename. Must match agentSlug() in tip-visuals.js. */
function agentSlug(name) {
  return String(name || '').replace(/[^A-Za-z0-9]/g, '');
}

// Parent: spawn ourselves under Electron, which is the only part that needs it.
if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  const env = Object.assign({}, process.env);
  // This shell exports ELECTRON_RUN_AS_NODE=1, which makes the Electron binary
  // behave as plain node, and then nativeImage is not there at all.
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, stdio: 'inherit', timeout: 300000 });
  process.exit(r.status === 0 ? 0 : 1);
}

const { app, nativeImage } = require('electron');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let rows;
  try {
    const res = await fetch(AGENTS_URL);
    rows = (await res.json()).data;
  } catch (e) {
    console.error('[busts] could not reach valorant-api.com: ' + e.message);
    return app.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const list = rows.filter((a) => a.displayName && a.displayIcon);
  let wrote = 0, same = 0, failed = 0;

  // Four at a time. This is someone else's CDN and each file is 410KB.
  const BATCH = 4;
  for (let i = 0; i < list.length; i += BATCH) {
    await Promise.all(list.slice(i, i + BATCH).map(async (a) => {
      const dest = path.join(OUT, `${agentSlug(a.displayName)}.png`);
      try {
        const res = await fetch(a.displayIcon);
        if (!res.ok) { failed += 1; return; }
        const src = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
        if (src.isEmpty()) { failed += 1; return; }
        const out = src.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG();
        // Only write when the bytes differ, so a re-sync does not add 29
        // identical blobs to git history.
        if (fs.existsSync(dest) && fs.readFileSync(dest).equals(out)) { same += 1; return; }
        fs.writeFileSync(dest, out);
        wrote += 1;
      } catch { failed += 1; }
    }));
    process.stdout.write(`\r[busts] ${Math.min(i + BATCH, list.length)}/${list.length}`);
  }
  process.stdout.write('\n');

  const bytes = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`[busts] ${wrote} written, ${same} unchanged, ${failed} failed`);
  console.log(`[busts] ${fs.readdirSync(OUT).length} files, ${Math.round(bytes / 1024)}KB total at ${SIZE}px`);
  if (failed) console.log('[busts] a failed icon is not fatal: the tip falls back to the agent name.');
  app.exit(failed && !wrote ? 1 : 0);
});
