# Creature Quest tests

Two layers, no dependencies to install. The unit layer imports the game's own
modules under Node and runs in well under a second; the browser layer drives the
real page in Chromium and needs Playwright, skipping itself when it is missing.

```bash
cd game
node --test "tests/*.test.mjs"     # everything (~35s, most of it the browser)
npm run test:unit                  # rules and data only (~1s)
npm run test:browser               # the game in a browser
node --test tests/battle.test.mjs  # one file
node --test --test-name-pattern "Leech Seed" "tests/*.test.mjs"
```

`node --test <directory>` does not work on every Node build — pass the glob (in
quotes, so Node expands it) or a file list, as the npm scripts do.

## What each file is for

| File | Covers |
|---|---|
| `data.test.mjs` | The JSON the game is built from: learnsets, evolutions, machines, shops, trainers, encounter tables, warps, map reachability. Guards against an editor or a hand edit shipping a file that boots into a crash, strands the player, or defines content nothing can reach. |
| `dex.test.mjs` | Progression: stat computation, the XP curve, levelling and move learning, evolution, and the save round-trip. |
| `battle.test.mjs` | The battle engine: type effectiveness, STAB, accuracy, statuses, Leech Seed, hazards, Protect, priority, PP and Struggle, switching, faints, catching, fleeing, weather, drain, recoil, multi-hit and stat stages. |
| `renderer.test.mjs` | The text-fitting primitives every panel draws through — lines stay inside the width they were given, the ellipsis counts toward that width, empty and unbreakable input come back safe. |
| `draw-audit.test.mjs` | The layout auditor's own rules (see below), so the browser suite can be trusted when it says a screen is clean. |
| `game.browser.test.mjs` | The real page: that it boots, that the scenes draw without throwing, and that input lands where it should. |
| `layout.browser.test.mjs` | That no text draws outside its box, on every screen the game can reach. |

## The layout audit

Text running off a panel — or off the canvas — is the one class of bug the
other suites cannot see: the layout is coordinates passed to `Renderer.text()`
from `main.js`, with nothing exported to assert on. So the browser records it
instead.

`helpers/draw-audit.mjs` patches the 2D context before the game boots and logs
every `fillText` and `strokeRect` on the visible canvas. `auditDraws()` — pure,
and unit-tested in `draw-audit.test.mjs` — then applies two rules:

- **canvas** — no text may extend past the edge of the canvas.
- **panel** — text starting inside a panel must finish inside that panel.

Panels are recognised by their draw signature: `Renderer.panel()` is the only
thing that strokes two rectangles inset 4px from one another. Text belongs to
the most recent panel drawn that contains where the text starts, so overlapping
prompts are judged against the prompt rather than the menu behind it.

To cover a new screen, walk to it and call `check()`:

```js
const game = await openGame({ audit: true, save: makeSave() });
await game.press('KeyX');           // navigate to the screen
await check(game, 'pause menu root');   // clears the log, redraws, audits
```

A failure names the offending string and its measured extent, e.g.
`[canvas] "You scurried back to Meadowfen... and dropped 450c." spans x 36..773
on a 720x480 canvas`.

Feed the screens their worst case — a full inventory, a long creature name, a
status badge, a three-creature party — since these bugs only appear once the
content is long enough.

## Writing a test

Load the real data and drive a real battle:

```js
import { loadGameData } from './helpers/load.mjs';
import { startBattle } from './helpers/battle.mjs';
import { withRandom } from './helpers/rng.mjs';

const game = loadGameData();

withRandom(0, () => {                       // every chance fires, everything hits
  const b = startBattle(game,
    [{ species: 'sproutle', level: 30, moves: ['root_snare'] }],
    [{ species: 'mudpad',   level: 30, moves: ['curl_up'] }]);
  b.move('root_snare');
  assert.ok(b.said('was seeded!'), b.dump());
});
```

`startBattle` wraps `battle.js` and turns its beats into something searchable:
`b.said(text)` / `b.everSaid(text)` for messages this turn or all turns,
`b.damageTo('enemy')`, `b.player` / `b.enemy` for the live creatures, and
`b.dump()` for the whole log — pass it as the assertion message and a failure
tells you the story of the battle.

### Randomness

`battle.js` calls the global `Math.random` directly, so the helpers in
`helpers/rng.mjs` swap it and restore it afterwards:

- `withSeed(n, fn)` — reproducible mixed battle. Use for "does this ever throw".
- `withRandom(0, fn)` — every chance fires, every move hits, damage rolls its
  minimum. Use to force a status or a secondary effect.
- `withRandom(0.999, fn)` — nothing extra fires. Use to force a miss.
- `withRolls([...], fn)` — an exact sequence, for short and obvious cases.

Assert on behaviour ("it fainted", "the message appeared", "HP went down"), not
exact damage, so retuning a creature's stats does not break the suite.

Two things to watch, both of which have bitten these tests already: a type may be
immune to what you are testing (Electric creatures cannot be paralysed, Ground
ignores Electric moves), and `withRandom(0)` gives sleep the shortest possible
duration, so the sleeper wakes on its next action.

### Browser tests

`openGame({ save })` serves the repo, opens `/game/`, and can seed a save so a
test starts anywhere in the game without playing up to it:

```js
const game = await openGame({ save: makeSave({ money: 4000 }) });
await game.press('KeyZ');        // menu input: one edge press
await game.walk('ArrowUp', 2);   // movement: reads *held* keys, so hold per tile
assert.deepEqual(game.errors, []);   // console + page errors collected throughout
```

`game.errors` is the assertion that matters most — the game catches almost
nothing internally, so a broken render or a bad data reference surfaces as a
console error rather than a visible failure.

## Why `game/package.json` exists

Purely so Node treats `game/js/**/*.js` as ES modules and the tests can import
them the same way the browser does. There is still no build step, nothing to
install, and nothing about the site changes.
