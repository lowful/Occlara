'use strict';

/**
 * Two hardenings of the main process (src/main/windows/web-guard.js, src/main/index.js):
 *
 *   - C5: no window ever leaves our own files. A link or a form in text a page
 *     paints from the server or the model would have navigated the window to
 *     a remote page with its preload, sandbox off, still attached. Every
 *     webContents is held to src/renderer, and no page opens a window.
 *   - C6: OCCLARA_DEV_USERDATA, a dev switch, is honoured only by a build
 *     run from the repo: an installed build pointed at another profile looks
 *     to a player like a wiped licence and library.
 *
 * Run: npm run test:webguard
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { pathToFileURL } = require('url');
const { guard, isOwnPage, RENDERER_ROOT } = require('../src/main/windows/web-guard');

let passed = 0;
let failed = 0;
function ok(cond, what, detail) {
  if (cond) { passed++; console.log(`ok    ${what}`); } else { failed++; console.log(`FAIL  ${what}${detail ? ` (${detail})` : ''}`); }
}

const own = pathToFileURL(path.join(RENDERER_ROOT, 'shell', 'index.html')).href;
const ownQuery = `${pathToFileURL(path.join(RENDERER_ROOT, 'activation', 'index.html')).href}?notice=expired#top`;
const outside = pathToFileURL(path.join(RENDERER_ROOT, '..', 'main', 'index.js')).href;
const climbing = `${pathToFileURL(RENDERER_ROOT).href}/../main/index.js`;

ok(isOwnPage(own) && isOwnPage(ownQuery), 'our own pages are ours, with a query and a hash');
ok(!isOwnPage('https://evil.example/') && !isOwnPage('http://127.0.0.1:5173/') && !isOwnPage('javascript:alert(1)')
  && !isOwnPage('data:text/html,hi') && !isOwnPage('about:blank') && !isOwnPage('') && !isOwnPage(null),
'a remote page, a local server, a script, a data page and nothing are not');
ok(!isOwnPage(outside) && !isOwnPage(climbing) && !isOwnPage(pathToFileURL(RENDERER_ROOT).href)
  && !isOwnPage('file:///C:/Windows/System32/drivers/etc/hosts'),
'and neither is a file outside src/renderer, by its path or by climbing out of it');

// A webContents stand in.
const contents = new EventEmitter();
let openHandler = null;
contents.setWindowOpenHandler = (fn) => { openHandler = fn; };
const said = [];
guard(contents, { log: (m) => said.push(m) });
const navigate = (ev, url) => {
  let stopped = false;
  contents.emit(ev, { preventDefault: () => { stopped = true; } }, url);
  return stopped;
};
ok(navigate('will-navigate', 'https://evil.example/steal?key=GC-1') && navigate('will-redirect', 'https://evil.example/'),
  'a navigation or a redirect to a remote page is refused');
ok(!navigate('will-navigate', own), 'and one to our own page goes ahead');
ok(said.length === 2 && said.every((m) => !/GC-1|steal/.test(m)), 'and what was refused is logged by its origin only', said.join(' | '));
ok(openHandler && openHandler({ url: 'https://occlara.app/' }).action === 'deny' && openHandler({ url: own }).action === 'deny',
  'and no page opens a window, ours or not');
ok(navigate('will-attach-webview', 'https://evil.example/'), 'and no page attaches a webview');

// index.js wires it to every webContents the app makes, and gates the dev profile.
const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
ok(/app\.on\('web-contents-created',\s*\(_e,\s*contents\)\s*=>\s*webGuard\.guard\(contents/.test(idx)
  && /const webGuard\s*=\s*require\('\.\/windows\/web-guard'\)/.test(idx),
'index.js holds every webContents the app makes to our own pages');
const setPath = /app\.setPath\('userData',\s*([^\n]+)\);/.exec(idx);
ok(setPath && /\(!app\.isPackaged && process\.env\.OCCLARA_DEV_USERDATA\)\s*\|\|\s*profileMigration\.migrate\(/.test(setPath[1]),
  'an installed build never takes OCCLARA_DEV_USERDATA', setPath ? setPath[1] : 'no setPath');

// 8.11: every other dev switch is a repo run's alone too. Two of them skip the
// licence (AUTOLAUNCH launches without one, ACTIVATE_KEY drives activation).
for (const name of ['OCCLARA_DEV_AUTOLAUNCH', 'OCCLARA_DEV_ACTIVATE_KEY', 'OCCLARA_DRILLS']) {
  const uses = idx.split('\n').filter((l) => l.includes(`process.env.${name}`) && /\bif\b|\?|\.\.\./.test(l));
  ok(uses.length > 0 && uses.every((l) => l.includes('!app.isPackaged')), `an installed build never takes ${name}`, uses.join(' | '));
}
ok(/app\.isPackaged \? 1 : Number\(process\.env\.OCCLARA_DEV_LINK_SCALE\)/.test(idx), 'an installed build never takes OCCLARA_DEV_LINK_SCALE');
ok(/\(!app\.isPackaged && Number\(process\.env\.OCCLARA_DEV_LATE_LINK_MS\)\)/.test(idx), 'an installed build never takes OCCLARA_DEV_LATE_LINK_MS');

// 8.11: an invoke from a frame that is not one of our pages is refused before its handler runs.
{
  const ipcSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc', 'register-ipc.js'), 'utf8');
  ok(/if \(!fromOwnPage\(event\)\)/.test(ipcSrc) && /isOwnPage\(url\)/.test(ipcSrc), 'every invoke handler first checks the caller is one of our pages');
  const home = isOwnPage(pathToFileURL(path.join(RENDERER_ROOT, 'home', 'index.html')).href);
  ok(home && !isOwnPage('https://example.com/') && !isOwnPage('file:///C:/Windows/evil.html'), 'our page passes, a web page and a file elsewhere do not');
}

// 8.11: the installed exe will not run as Node, take inspector flags or NODE_OPTIONS, and loads only its own checked archive.
{
  const fuses = (require('../package.json').build || {}).electronFuses || {};
  ok(fuses.runAsNode === false && fuses.enableNodeCliInspectArguments === false && fuses.enableNodeOptionsEnvironmentVariable === false
    && fuses.enableEmbeddedAsarIntegrityValidation === true && fuses.onlyLoadAppFromAsar === true, 'the Electron fuses are set', JSON.stringify(fuses));
}

console.log(failed ? `FAIL: ${failed} of ${passed + failed} web guard checks failed` : `PASS: all ${passed} web guard checks passed`);
process.exit(failed ? 1 : 0);
