What is in this folder, and where each file comes from.

  logo-mark.svg   The full moon (Nov 2026), the one colour mark: one disc with
                  its seas and four craters cut by even odd fill. Every surface
                  header shows it through an <img>, which is why it carries
                  color="#F5F5F7" on its root (an SVG in an img is its own
                  document, and currentColor would be black there). Every file
                  of the logo is written by scripts/generate-icon.js from one
                  source, scripts/moon/, the design's own drawings.
  mark-bar.svg    The top bar's mark: the moon in colour, its own 24 unit
                  drawing, at 22px.
  icon.png        512x512, the drawn moon on indigo black glass, a squircle.
  icon.ico        The tile at 16 20 24 32 40 48 64 96 128 256: the installer,
                  the taskbar and Explorer (package.json "icon"). Each size
                  from the moon's own drawing: the drawn moon with its grain at
                  256 and 128, without it from 96 to 40, the 32 grid drawing at
                  32 and 24, the 16 px drawing at 20 and 16. Rendered in a
                  hidden Electron window (the moon is SVG filters), recorded in
                  scripts/moon/rendered.json.
  splash/moon.svg The splash's moon: the clean colour drawing with its lit
                  edge and soft indigo glow, shown as a picture, so the splash
                  draws no gradient of its own.
  tray-dark.ico   The moon in #F5F5F7 on the 16 grid, three cuts (the western
                  ocean, the eastern sea, Tycho), for a dark taskbar, at
                  16 20 24 32 40 48 (100 to 300% scaling). src/main/tray.js
                  picks it or tray-light.ico by the taskbar's theme.
  tray-light.ico  The same moon in #0A0B0E, for a light taskbar.
  tray-rec-dark.ico, tray-rec-light.ico
                  While a match is recorded: the record ring of Start's glyph
                  with the moon as its dot, in the ink and in the ground.
  fonts/          Onest (onest-var.woff2, one variable file from 100 to 900,
                  under the SIL Open Font License 1.1), the face everything
                  read is set in since Orbit (Nov 2026); Geist Mono 400 and
                  500 for eyebrows and columns of digits; Geist 400 to 800,
                  kept for Wrapped, whose own look names it. Bundled so the
                  app renders offline (theme.css loads them).
  agents-full/    Each Valorant agent's full portrait, cut to the figure and
                  720 pixels tall, WebP with its transparency, written by npm
                  run sync:agentportraits from valorant-api.com (about 1.6 MB
                  for all of them). Home's hero and the review's show the
                  player's agent in front of the moon (shared/agent-portraits.js);
                  the head icon in valorant/agents is the fallback. Never used
                  by the Trainer, which ships nothing of Riot's.
  games/          Valorant's and League's own logos, the source of the game
                  picker's (shared/game-logos.js inlines their paths).
  lol/champions/  League's champion icons, written by npm run sync:lol.
  valorant/       Valorant's agent icons (agents/, npm run sync:agenticons),
                  the guns' kill feed icons (weapons/) and the agents' four
                  ability icons (abilities/<Agent>-<Slot>.png), both by npm run
                  sync:kiticons, which also writes their index,
                  src/shared/valorant-kit-icons.generated.json. Drawn by the
                  review's killer card, the Moments page's deaths and the
                  Profile's most used weapon (shared/kit-icons.js).

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
