What is in this folder, and where each file comes from.

  logo-mark.svg   The crescent, the source of the mark. Every surface header
                  shows it through an <img>, which is why it carries
                  color="#F5F5F7" on its root (an SVG in an img is its own
                  document, and currentColor would be black there).
  icon.png        512x512, the crescent on its rounded #0A0B0E tile.
  icon.ico        The same tile at 16 20 24 32 40 48 64 96 128 256: the
                  installer, the taskbar and Explorer (package.json "icon").
  tray-dark.ico   The crescent alone in #F5F5F7, for a dark taskbar, at
                  16 20 24 32 40 48 (100 to 300% scaling). src/main/tray.js
                  picks it or tray-light.ico by the taskbar's theme.
  tray-light.ico  The crescent alone in #0A0B0E, for a light taskbar, the same
                  sizes.
  fonts/          Geist 400 to 800 and Geist Mono 400 and 500, bundled so the
                  app renders offline (theme.css loads them).
  games/          Valorant's and League's own logos, the source of the game
                  picker's (shared/game-logos.js inlines their paths).
  lol/champions/  League's champion icons, written by npm run sync:lol.

The four icons are DRAWN, not converted: run

  node scripts/generate-icon.js

and it writes icon.png, icon.ico, tray-dark.ico and tray-light.ico here from
the same two circles as logo-mark.svg. No online converter and no other tool:
a changed mark is a changed number in that script and one run, and
npm run test:mark fails until the files here are what it draws.
node scripts/generate-icon.js --site <dir> writes the website's icons
(favicon.ico, favicon.svg, apple-touch-icon.png, icon-512.png) and the
1024px avatar into <dir> instead, and touches nothing here.

There is no icon.icns: releases are built for Windows alone (npm run
release), and the mac section of package.json that names one is not used.
