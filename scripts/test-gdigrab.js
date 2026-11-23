'use strict';

/**
 * THE GDI FRAME BY FFMPEG (8.16.1, src/main/services/gdi-grab.js).
 *
 * The frame the read falls back to was taken by OcclaraCapture.exe, a helper
 * of our own that Bitdefender quarantined as a trojan. It is now taken by the
 * ffmpeg that ships anyway, and the helper is out of the installer. This holds
 * the arguments, the display geometry, the order of the fallbacks and the
 * installer's file list. It never captures the screen.
 *
 * Run: npm run test:gdigrab
 */

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { qscale, ffmpegArgs, isJpeg, geometry } = require('../src/main/services/gdi-grab');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n      ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const ROOT = path.join(__dirname, '..');
const STD = { targetW: 1280, targetH: 720, jpegQuality: 70 };
const PERF = { targetW: 854, targetH: 480, jpegQuality: 50 };

(async () => {
  // ── the arguments ───────────────────────────────────────────────────────────
  const one = ffmpegArgs(STD, { multi: false, w: 1920, h: 1080, x: 0, y: 0 }, 'area');
  const s = one.join(' ');
  ok(/-f gdigrab/.test(s) && /-i desktop/.test(s) && /-frames:v 1/.test(s) && one[one.length - 1] === '-',
    'one frame of the desktop by gdigrab, to stdout', s);
  ok(/-draw_mouse 0/.test(s), 'no mouse pointer in the frame, as the helper took it');
  ok(/-nostdin/.test(s) && /-loglevel error/.test(s), 'ffmpeg neither reads the keyboard nor talks');
  ok(!/-video_size|-offset_x|crop=/.test(s), 'one display: the desktop is the primary, no rectangle asked', s);
  ok(/-vf scale=1280:720:flags=bilinear/.test(s), 'stretched to the profile whatever the display shape', s);
  ok(one.indexOf('-f') < one.indexOf('-i') && one.indexOf('-draw_mouse') < one.indexOf('-i'),
    'the grabber options come before the input they belong to');
  ok(ffmpegArgs(STD, null, 'area').join(' ') === s, 'no geometry is the whole desktop too');

  const area = ffmpegArgs(STD, { multi: true, w: 2560, h: 1440, x: 1920, y: 0 }, 'area').join(' ');
  ok(/-offset_x 0 -offset_y 0 -video_size 2560x1440 -i desktop/.test(area) && !/crop=/.test(area),
    'two displays: the primary is asked for by its rectangle, whose origin is 0,0', area);
  const crop = ffmpegArgs(PERF, { multi: true, w: 2560, h: 1440, x: 1920, y: 120 }, 'crop').join(' ');
  ok(/-vf crop=2560:1440:1920:120,scale=854:480:flags=bilinear/.test(crop) && !/-video_size/.test(crop),
    'the other way: the whole desktop cut down to the primary, then scaled', crop);
  ok(/crop=1920:1080:0:0/.test(ffmpegArgs(STD, { multi: true, w: 1920, h: 1080, x: -5, y: NaN }, 'crop').join(' ')),
    'a crop never starts off the picture');
  ok(!/crop=|-video_size/.test(ffmpegArgs(STD, { multi: true, w: 0, h: 1080 }, 'area').join(' ')),
    'a geometry without a size is treated as none');

  ok(qscale(70) === 2 && qscale(50) === 3 && qscale(30) === 5 && qscale(undefined) === 2 && qscale(100) === 2,
    'the helper\'s 70 and 50 as ffmpeg\'s 2 and 3, never softer than it was');
  ok(/-q:v 2 /.test(s) && /-q:v 3 /.test(crop), 'each profile carries its quality');

  ok(isJpeg(Buffer.from([0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9])) && !isJpeg(Buffer.from('ERR: no')) && !isJpeg(Buffer.alloc(0)) && !isJpeg(null)
    && !isJpeg(Buffer.from([0xFF, 0xD8, 1, 2, 3])), 'only a whole JPEG is a frame');

  // ── the geometry, from Electron's screen ────────────────────────────────────
  const scr = (displays, prim) => ({
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[prim],
    dipToScreenRect: (_w, r) => {
      const d = displays.find((x) => x.bounds === r);
      return { x: d.phys[0], y: d.phys[1], width: d.phys[2], height: d.phys[3] };
    },
  });
  const g1 = geometry(scr([{ bounds: { x: 0, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25, phys: [0, 0, 1920, 1080] }], 0));
  ok(g1 && !g1.multi && g1.w === 1920 && g1.h === 1080 && g1.x === 0 && g1.y === 0,
    'one display at 125%: physical pixels, 1920x1080, not the scaled 1536x864', JSON.stringify(g1));
  const g2 = geometry(scr([
    { bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, phys: [-1920, -200, 1920, 1080] },
    { bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1, phys: [0, 0, 2560, 1440] },
  ], 1));
  ok(g2 && g2.multi && g2.w === 2560 && g2.h === 1440 && g2.x === 1920 && g2.y === 200,
    'a second display to the left and higher: the primary sits 1920 in and 200 down in the whole desktop', JSON.stringify(g2));
  const g3 = geometry({ getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1280, height: 720 }, scaleFactor: 1.5 }], getPrimaryDisplay() { return this.getAllDisplays()[0]; } });
  ok(g3 && g3.w === 1920 && g3.h === 1080, 'without dipToScreenRect the scale factor does it', JSON.stringify(g3));
  ok(geometry(null) === null && geometry({}) === null, 'a screen that cannot be asked gives none, and the whole desktop is taken');

  // ── the order of the fallbacks, on the real worker ──────────────────────────
  // node.exe stands in for an ffmpeg that fails: it refuses the arguments.
  const ask = (workerData) => new Promise((resolve) => {
    const w = new Worker(path.join(ROOT, 'src', 'main', 'services', 'capture-worker.js'), { workerData });
    w.on('message', (m) => { w.terminate(); resolve(m); });
    w.on('error', (e) => resolve({ success: false, error: `worker: ${e.message}` }));
    w.postMessage({ id: 7, quality: 'standard', geom: null });
  });
  const failed = await ask({ helperExe: null, ffmpegExe: process.execPath });
  ok(failed.id === 7 && failed.success === false && !failed.data,
    'ffmpeg there but failing, no helper: the frame fails, and the PowerShell script is NOT run', JSON.stringify(failed).slice(0, 200));

  const capture0 = () => fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', 'capture.js'), 'utf8');
  const worker = fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', 'capture-worker.js'), 'utf8');
  const cap = worker.slice(worker.indexOf('async function capture('));
  const body = cap.slice(0, cap.indexOf('\n}') + 2);
  ok(/if \(FFMPEG_EXE\) \{\s*try \{ return \{ data: await captureViaFfmpeg\(prof, geom\), via: 'ffmpeg' \}; \}\s*catch \(e\) \{ if \(!HELPER_EXE\) throw e; why = e\.message; \}/.test(body)
    && /return HELPER_EXE\s*\? \{ data: await captureViaHelper\(prof\), via: 'helper', why \}\s*: \{ data: await captureViaPowershell\(prof\), via: 'powershell', why \};/.test(body),
  'ffmpeg first, the old helper where it exists, PowerShell only when neither file is there', body);
  ok(/postMessage\(\{ id, success: true, data: r\.data, via: r\.via, why: r\.why \}\)/.test(worker)
    && /msg\.via !== lastVia/.test(capture0()) && /the GDI frame is taken by/.test(capture0()),
  'who took the frame reaches the debug log, with what ffmpeg said when it was not ffmpeg');

  const capture = fs.readFileSync(path.join(ROOT, 'src', 'main', 'services', 'capture.js'), 'utf8');
  ok(/ffmpegExe: resolveFfmpegExe\(\)/.test(capture) && /geom: primaryGeometry\(\)/.test(capture),
    'capture.js hands the worker the shipped ffmpeg, and the primary display with every frame');

  // ── the installer ───────────────────────────────────────────────────────────
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const extra = (pkg.build && pkg.build.extraResources) || [];
  const names = extra.map((e) => String(e.to || e.from || e));
  ok(!names.some((n) => /capture\.exe$/i.test(n)) && !JSON.stringify(pkg.build.files || []).includes('native/'),
    'the installer carries no capture helper of our own', names.join(', '));
  ok(names.includes('ffmpeg.exe'), 'and it carries ffmpeg, which takes the frame', names.join(', '));

  console.log(`\n${checks - fails}/${checks} gdigrab checks passed`);
  process.exit(fails ? 1 : 0);
})();
