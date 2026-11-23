'use strict';

/**
 * Screen capture, runs entirely inside a Worker Thread so the main process (and
 * therefore the game) never stalls on the capture spawn or the JPEG encode.
 *
 * Primary path (8.16.1): the ffmpeg that ships with the app, grabbing one GDI
 * frame (gdi-grab.js says why and builds the arguments). No file of ours
 * copies the screen: OcclaraCapture.exe, the tiny helper that did, was
 * quarantined by Bitdefender as Trojan.GenericKD on players' machines, and is
 * no longer in the installer.
 *
 * Second: OcclaraCapture.exe where it still exists (the repo, an install an
 * update left it in), the same GDI copy, for a frame ffmpeg could not give.
 *
 * Last: the PowerShell script, only when neither file is there (a broken
 * package). It is structurally PowerShell Empire's Get-Screenshot and trips
 * Windows Defender's HackTool signature, which is why it is never run while
 * ffmpeg is there, even when ffmpeg fails.
 */
const { parentPort, workerData } = require('worker_threads');
const { execFile }   = require('child_process');
const path = require('path');
const os   = require('os');
const fs   = require('fs');
const { CAPTURE } = require('../../shared/config');

const { ffmpegArgs, isJpeg } = require('./gdi-grab');

const HELPER_EXE = (workerData && workerData.helperExe) || null;
const FFMPEG_EXE = (workerData && workerData.ffmpegExe) || null;

function profileFor(quality) {
  return (CAPTURE.profiles && CAPTURE.profiles[quality]) || CAPTURE.profiles.standard;
}

// Primary: ffmpeg's gdigrab. The JPEG straight off stdout, no disk I/O.
function runFfmpeg(prof, geom, mode) {
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG_EXE,
      ffmpegArgs(prof, geom, mode),
      { timeout: CAPTURE.timeoutMs - 1000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (err) { reject(new Error((stderr && String(stderr).trim().slice(0, 300)) || err.message)); return; }
        if (!isJpeg(stdout)) { reject(new Error('ffmpeg returned no frame')); return; }
        resolve(stdout.toString('base64'));
      }
    );
  });
}

// With more than one display the primary is asked for by its rectangle; a
// desktop gdigrab refuses that of gets the whole desktop cut down instead,
// and stays on it, so a refusal is not paid for on every frame.
let multiMode = 'area';
async function captureViaFfmpeg(prof, geom) {
  if (!geom || !geom.multi) return runFfmpeg(prof, null, 'area');
  try { return await runFfmpeg(prof, geom, multiMode); }
  catch (e) {
    if (multiMode !== 'area') throw e;
    const shot = await runFfmpeg(prof, geom, 'crop');
    multiMode = 'crop';
    return shot;
  }
}

// Second: the compiled helper. base64 JPEG straight off stdout, no disk I/O.
function captureViaHelper(prof) {
  return new Promise((resolve, reject) => {
    execFile(
      HELPER_EXE,
      [String(prof.targetW), String(prof.targetH), String(prof.jpegQuality)],
      { timeout: CAPTURE.timeoutMs - 1000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) { reject(new Error((stderr && String(stderr).trim()) || err.message)); return; }
        const b64 = String(stdout).trim();
        if (!b64) { reject(new Error('capture helper returned no data')); return; }
        resolve(b64);
      }
    );
  });
}

// Fallback: the legacy PowerShell script (only when the exe is absent).
function captureViaPowershell(prof) {
  const stamp   = `${process.pid}_${Date.now()}`;
  const outPath = path.join(os.tmpdir(), `occlara_${stamp}.jpg`);
  const psPath  = path.join(os.tmpdir(), `occlara_${stamp}.ps1`);
  const ps =
    'Add-Type -AssemblyName System.Windows.Forms\n' +
    'Add-Type -AssemblyName System.Drawing\n' +
    '$s = [System.Windows.Forms.Screen]::PrimaryScreen\n' +
    '$bmp = New-Object System.Drawing.Bitmap($s.Bounds.Width, $s.Bounds.Height)\n' +
    '$g = [System.Drawing.Graphics]::FromImage($bmp)\n' +
    '$g.CopyFromScreen($s.Bounds.Location, [System.Drawing.Point]::Empty, $s.Bounds.Size)\n' +
    `$r = New-Object System.Drawing.Bitmap($bmp, ${prof.targetW}, ${prof.targetH})\n` +
    "$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }\n" +
    '$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)\n' +
    `$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, ${prof.jpegQuality})\n` +
    `$r.Save('${outPath.replace(/\\/g, '\\\\')}', $enc, $ep)\n` +
    '$g.Dispose(); $bmp.Dispose(); $r.Dispose()\n';

  return new Promise((resolve, reject) => {
    fs.writeFile(psPath, ps, (writeErr) => {
      if (writeErr) { reject(writeErr); return; }
      execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', psPath],
        { timeout: CAPTURE.timeoutMs - 1000, windowsHide: true },
        (err) => {
          fs.unlink(psPath, () => {});
          if (err) { reject(err); return; }
          try {
            const buf = fs.readFileSync(outPath);
            fs.unlink(outPath, () => {});
            resolve(buf.toString('base64'));
          } catch (e) { reject(e); }
        }
      );
    });
  });
}

async function capture(quality, geom) {
  const prof = profileFor(quality);
  // `via` names who took the frame, and `why` what ffmpeg said when it was
  // not ffmpeg: capture.js writes both to the debug log, since the fall to
  // the old helper is otherwise silent wherever that file still exists.
  let why = null;
  if (FFMPEG_EXE) {
    try { return { data: await captureViaFfmpeg(prof, geom), via: 'ffmpeg' }; }
    catch (e) { if (!HELPER_EXE) throw e; why = e.message; }
  }
  return HELPER_EXE
    ? { data: await captureViaHelper(prof), via: 'helper', why }
    : { data: await captureViaPowershell(prof), via: 'powershell', why };
}

// Each answer carries the id it was asked with: the read and the recorder's
// once a minute comparison can both be out, and each must get its own frame.
parentPort.on('message', async (msg) => {
  const id = msg && msg.id;
  try {
    const r = await capture(msg && msg.quality, msg && msg.geom);
    parentPort.postMessage({ id, success: true, data: r.data, via: r.via, why: r.why });
  } catch (e) {
    parentPort.postMessage({ id, success: false, error: e.message });
  }
});
