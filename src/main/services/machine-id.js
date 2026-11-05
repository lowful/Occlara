'use strict';

/**
 * THIS PC, AS WINDOWS NAMES IT (8.8), for "free games are one per player"
 * (server/services/free-allowance.js).
 *
 * The device id the app has always sent (license-service computeDeviceId) is
 * the PC name, the Windows user name and the platform, hashed: a new user name
 * or a renamed PC is a new device. Windows' own MachineGuid
 * (HKLM\SOFTWARE\Microsoft\Cryptography) stays the same through both, so it is
 * sent beside it at sign in, hashed here with a fixed prefix so the raw GUID
 * never leaves the PC, and the server salts it again before keeping it.
 *
 * Sysprep does not change MachineGuid, so PCs cloned from one Windows image
 * (a PC cafe, a school lab, VMs) all send the same value. The server lets
 * each new account on it play one free game, and a second once a Riot
 * account read off its live link tells it apart from the earlier holders,
 * and ignores it once its holders played on 4 different Riot accounts
 * (free-allowance.sql), so such a room is never blocked for everyone after
 * its first player.
 *
 * Read with reg.exe, once per run, only when a sign in asks for it. Nothing
 * here reads a game, its memory or its files. Any failure (not Windows, no
 * value, a timeout) is '': the server then has the other keys.
 */

const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 3000;

// The read in flight or done, shared by every caller of this run. It is a
// promise so reg.exe never blocks the main process: a sync call here froze the
// whole app for up to 3 s at every sign in.
let memo = null;

/**
 * reg.exe by its absolute path in System32, never through PATH: a reg.exe
 * dropped in the app's folder or anywhere earlier on PATH would otherwise run
 * in its place and answer whatever it liked. SystemRoot is set on every
 * Windows, and C:\Windows stands in when it is not.
 */
function regPath(env = process.env) {
  const root = String((env && (env.SystemRoot || env.SYSTEMROOT)) || '').trim() || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'reg.exe');
}

/** reg query's answer, never rejecting: '' on any failure or the timeout. */
function regQuery() {
  return new Promise((resolve) => {
    try {
      execFile(regPath(), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true },
        (err, stdout) => resolve(err ? '' : String(stdout || '')));
    } catch { resolve(''); }
  });
}

/** The MachineGuid out of `reg query` output, or null. */
function guidOf(output) {
  for (const line of String(output || '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 3 && parts[0].toLowerCase() === 'machineguid' && GUID.test(parts[parts.length - 1])) {
      return parts[parts.length - 1].toLowerCase();
    }
  }
  return null;
}

/** sha256 of the GUID with a fixed prefix, hex, or ''. */
function hashOf(guid) {
  return guid ? crypto.createHash('sha256').update(`occlara-machine|${guid}`).digest('hex') : '';
}

async function read(platform, run) {
  if (platform !== 'win32') return '';
  try { return hashOf(guidOf(await run())); } catch { return ''; }
}

/**
 * A promise of the hashed machine id, or '', never rejecting. Read once per
 * run and the promise kept, so a second sign in waits on the same read.
 * `deps` for the tests: { platform, run }, where run returns reg query's
 * answer or a promise of it; a test's read is never kept.
 */
function machineId(deps = {}) {
  if (deps.run || deps.platform) return read(deps.platform || process.platform, deps.run || regQuery);
  if (!memo) memo = read(process.platform, regQuery);
  return memo;
}

module.exports = { machineId, guidOf, hashOf, regPath };
