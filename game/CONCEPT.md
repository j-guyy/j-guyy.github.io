# Game Concept: Pokémon-style Clone ("[working title]")

Status: **scoping only — nothing built yet**. This doc is the handoff brief for whichever
model implements Phase 1.

## Goal

A playable, top-down, tile-based creature-collecting RPG in the spirit of the original
Pokémon games, using entirely original creatures/lore. Lives on its own unlinked page of
this site to start; not referenced from `<nav-bar>` or any other page until it's ready to
be public.

## Art direction

Old-school 16-bit/32-bit era look (SNES/GBA-generation sprites), for both the overworld
tileset and the creatures — not the flat-color-block placeholder look. This is a
deliberate scope decision, not just aesthetic preference: pixel-art sprites at a fixed
small resolution are far easier to source/generate/hand-draw consistently than
higher-fidelity art, and the low-res grid maps directly onto the tile-based engine and
collision system described below. Aim for a single consistent pixel-art style across
tileset, creature sprites, and UI chrome (menus/battle screen) rather than mixing styles.

Sprite dimensions — **updated after Phase 1** (see "Phase 1.5" below for why): scaled
3x from the original Gen III (GBA) baseline for a noticeably higher-fidelity pixel-art
look, while keeping the same 16-bit aesthetic (flat, limited-palette, hard pixel edges,
nearest-neighbor scaling — not smoothed/hi-res art).

| Element | Original (Phase 1) | Current (Phase 1.5+) |
|---|---|---|
| Creature sprites (battle/Pokédex/party UI) | 64x64px | **192x192px** |
| Overworld tileset/movement grid | 16x16px | **48x48px** |
| Overworld player/NPC sprites | 16x32px | **48x96px** |
| Canvas logical resolution | 240x160px | **~720x480px** |

**Phase 1 art plan: placeholder first.** Build the engine/renderer against placeholder
sprites — flat-color silhouettes/simple shapes at the exact target pixel dimensions —
so the full gameplay loop is playable now without blocking on real art. Real 16-bit
pixel art gets sourced and dropped in as a later pass; as long as the sprite-sheet
format/dimensions are respected, no engine code should need to change when that happens.
This plan is unaffected by the Phase 1.5 resolution bump — placeholders just get drawn
bigger.

## Where it lives

- Page: `/game/index.html` (new top-level directory, mirrors how `/app/` is its own
  self-contained shell)
- Assets: `/game/js/*.js`, `/game/css/game.css`, `/game/data/*.json`
- Fully decoupled from the rest of the site — doesn't touch `strava.js`, `worker.js`, or
  existing CSS. Only shared dependency, if any, would be `js/navbar-component.js`, and
  even that's optional for a hidden page.
- No routing/build step needed (site has none) — one HTML file + Canvas + JS modules,
  same static-site pattern as everything else here.

## Architecture (data-driven, like the rest of the site)

- **Rendering**: HTML5 Canvas, 2D top-down, grid/tile-based movement (classic GB-style:
  discrete tile steps, not free-form pixel movement). Simplest to implement, easiest to
  reason about for collision and encounters.
- **Game loop**: `requestAnimationFrame`, simple state machine for top-level mode
  (`OVERWORLD`, `BATTLE`, `MENU`, `DIALOGUE`).
- **Input**: keyboard only (arrow keys/WASD) for Phase 1. Touch/tap-to-move controls are
  deliberately deferred (see below) to keep Phase 1 surface area small, even though the
  site does ship a Capacitor phone shell elsewhere.
- **Data files** (mirrors `/data/*.json` pattern already used site-wide):
  - `game/data/creatures.json` — the Pokédex
  - `game/data/moves.json` — move definitions
  - `game/data/types.json` — type effectiveness chart
  - `game/data/maps/*.json` — tilemap layout + collision + encounter tables + NPCs per map
- **Save/load**: `localStorage` for MVP (player position, party, inventory, flags). No
  backend required. A Cloudflare KV-backed save (mirroring the `worker.js` pattern used
  for Strava/travel data) is a natural Phase 2+ option if cross-device saves matter later.

## MVP scope (Phase 1 — "prove the loop is fun")

Deliberately small. The goal is one complete, playable gameplay loop, not breadth.

1. **Engine**
   - One tilemap, camera follows player, tile-based collision (walls/water impassable)
   - Grass tiles trigger random wild encounters on step
   - Basic menu (party, save, quit-to-menu)
2. **Pokédex** — ~8–10 original creatures, 3–4 types, no evolutions yet
   - Stats: HP, Attack, Defense, Speed
   - 2–4 moves each, drawn from a shared move pool of ~15–20 moves
   - Names/types/flavor for Phase 1 are build-agent-invented placeholders (per data
     file, easy to swap later) — not hand-designed by Justin. Same goes for the
     working title and any world/region naming: functional placeholders now, real
     creative pass later, whenever wanted.
3. **Type chart** — small and symmetric: 4–6 types (e.g. Ember/Aqua/Verdant/Volt),
   simple 2x/1x/0.5x effectiveness grid instead of the full 18-type web
4. **Battle system**
   - Turn-based, 1v1, player vs. wild creature only (no trainer battles yet)
   - Move selection → speed-ordered turn resolution → damage formula → HP bars
   - Win (wild creature faints) / catch (simple capture-chance formula) / flee
   - No status effects, items, or abilities yet — pure damage + type multiplier
5. **World**
   - One starting map (e.g. a small village + one route with grass)
   - One NPC for flavor/tutorial text (dialogue box, no branching logic needed)
6. **Save/load**
   - `localStorage`: player position, starter chosen, party, flags (has it saved before)
   - "New Game" vs "Continue" on load

## Phase 1.5 — resolution upgrade

Phase 1 shipped and plays end-to-end (see Status below), but at the original GBA-scale
resolution the placeholder art reads as too small/blocky. This phase is a **visual-only
rework**, not new gameplay: same engine, same battle/save/world logic, same Phase 1
scope — just rendered bigger and crisper.

Scope:
- Bump canvas logical resolution, tile size, and creature/actor sprite sizes to the
  "Current (Phase 1.5+)" column in the table above (3x the Phase 1 numbers).
- Re-tune camera/viewport math for the new canvas size (how many tiles fit on screen
  will shrink at a fixed window size, since tiles are 3x bigger — decide whether to
  grow the canvas element, or show fewer tiles at once, and pick whichever reads best).
- Re-tune all UI chrome for the new resolution: dialogue box, party menu, battle HUD
  (HP bars, move list), title/starter-select screens — these were laid out against the
  240x160 canvas and will look wrong (too small, misplaced, or clipped) if just
  stretched rather than actually re-laid-out at the new size.
- Placeholder sprite generation (the flat-shape asset factories) needs to redraw at the
  new pixel dimensions — same visual language (silhouette + border + maybe a
  letter/emoji), just bigger, so detail-per-sprite feels a little more filled-in rather
  than a scaled-up blur.
- No new content, no new mechanics. Don't touch battle logic, data files, save format,
  or map layout beyond what's needed to render at the new scale (e.g. `data/maps/*.json`
  tile coordinates are still logical grid indices — a 48x48 tile is still "1 tile," so
  map JSON itself likely doesn't need to change, only how big each tile is drawn).

## Phase 2 — creature-RPG core systems

Turns the prototype loop into a real creature-collecting RPG. All mechanics follow
classic Gen III conventions unless noted. Scope:

1. **Experience & leveling** — cubic XP curve (`total XP for level L = L³`,
   "medium-fast"). XP is awarded to the active creature when an enemy faints
   (`baseExp × enemyLevel / 7`, ×1.5 in trainer battles; none for catching/fleeing —
   classic rules). Level-ups happen mid-battle: stats recalc, max-HP gains heal by the
   delta, and the battle log announces each level. Player HP box gets an XP bar.
2. **Learnsets** — species define `learnset: [{level, move}]` instead of a fixed move
   list. Creatures know the last 4 moves at-or-below their level; on level-up, a new
   move auto-learns if there's a free slot, otherwise the classic "forget a move to
   make room?" prompt (pick one of 4 to forget, or give up).
3. **Evolutions** — species may define `evolvesTo: {species, level}`. Checked after
   battle; a short evolution sequence (message → sprite swap → message) plays per
   evolving party member. Starters get 3-stage lines (Lv 16 / Lv 30); a few wild
   species get single evolutions (Lv 18–20). Roster grows ~10 → ~19; evolved forms
   don't appear in wild encounter tables.
4. **Pokédex** — per-save seen/caught tracking (seen on encounter, caught on
   catch/ownership). New pause-menu view: numbered list of all species ("???" when
   unseen, marker when caught) and a detail page (sprite, type, dex entry text) for
   seen species. Every species gets a dedicated `entry` field (longer dex text,
   distinct from the short `flavor` blurb).
5. **Trainer battle** — one trainer NPC on Route 1. Talking to them plays intro
   dialogue then starts a battle: their party of 2 sent out sequentially, **no fleeing,
   no catching** (blocked with the classic messages), 1.5x XP, item reward + outro
   dialogue on win, one-time (defeat flag persisted; post-defeat they chat instead).
   When the player's active creature faints (any battle) the next healthy party member
   is sent out automatically; loss = whole party fainted.
6. **Items & inventory** — `data/items.json`: Snare Orb / Great Orb (catch, the Great
   Orb with a better rate) and Potion / Super Potion (20/50 HP heal). Inventory is
   `{itemId: qty}` in the save. "Items" pause-menu view (potions target a party member;
   orbs are battle-only). In battle, the old bare "Catch" command becomes "Item":
   throwing an orb consumes it (even on a failed catch), potions consume the turn.
   New Game grants a starting kit (5 Snare Orbs, 3 Potions); the Route 1 trainer
   rewards Great Orbs.
7. **Save v2** — party members persist `xp` + current `moves` (since forgetting is a
   choice); save adds `inventory` and dex seen/caught. v1 saves migrate (XP derived
   from level, moves from learnset, default starting kit) rather than being discarded.

## Phase 2.5 — full type chart, dual types, and the creature editor

1. **Full Pokemon type system** — the placeholder 4-type chart is replaced by the real
   18-type chart (Normal/Fire/Water/Electric/Grass/Ice/Fighting/Poison/Ground/Flying/
   Psychic/Bug/Rock/Ghost/Dragon/Dark/Steel/Fairy), with every
   super-effective / not-very-effective / no-effect cell matching the mainline Gen 6+
   chart exactly. Stored sparse in `data/types.json` (only non-1x cells listed).
2. **Dual types** — creatures now have 1-2 types (`types` array). Defensive
   multipliers multiply across both types (4x, 0.25x, and immunities all emerge
   naturally). Several roster creatures were given a second type (e.g. Cindermoth
   Fire/Bug, Mudpad Water/Ground, Maelstrode Water/Dragon).
3. **STAB** — Same-Type Attack Bonus (1.5x) applies when a move's type matches *any*
   of the attacker's types. (A 1.5x STAB existed since Phase 1; it's now dual-type
   aware and an explicit spec'd mechanic.)
4. **Creature editor** — `/game/editor.html` (+ `js/editor.js`, `css/editor.css`), a
   standalone DOM tool page outside the game itself. Edits every species: name,
   starter flag, types, base stats/EXP, learnset rows, evolution target+level,
   placeholder-sprite parameters (shape/glyph/accent, with live preview), flavor and
   dex entry text; plus new/duplicate/delete. Persistence (static site, no backend):
   - **Save to Browser** — writes the full creatures.json shape to localStorage;
     the game's dex loader prefers this override, so edits are playable immediately.
   - **Download creatures.json** — exports the file to commit into the repo (the
     permanent path).
   - **Reset to Repo File** — discards the override.
   Validation mirrors the game's loader (1-2 types, level-1 move required, evolution
   target must exist, at least one starter) and blocks saving broken data.

## Phase 2.6 — TMs/HMs, battle-input polish, and the route editor

1. **Move-learn prompt** — leveling into a move when all four slots are full always
   asks the player which move to forget (or to skip); nothing is auto-replaced. (Free
   slots still auto-fill, since nothing is being replaced there.)
2. **TMs & HMs** — `data/machines.json` defines teachable-move machines: TMs are
   single-use (consumed on teach), HMs are reusable (teach to any number of creatures).
   Which creatures can learn which machine move is per-species compatibility: an
   explicit `teachable: [moveId,...]` on the species, or a type-matched default (machine
   moves whose type is Normal or one of the creature's types). A "TMs & HMs" pause-menu
   view lists owned machines; teaching picks a compatible party member and, if it
   already knows four moves, reuses the forget-a-move prompt. New Game grants one TM +
   one HM; the Route 1 trainer also rewards a TM. Editable per-creature in the Creature
   Editor ("Teachable Moves" checklist).
3. **Battle input fixes** — the command menu now always defaults to **Fight** (the old
   "starts on Item/Run sometimes" bug was queued key presses from message playback
   leaking into the menu's first frame; input is now flushed on every battle-phase
   change). Selecting Fight defaults the move cursor to the **last move used this
   battle**. Move selection is a proper 2-column grid (left/right move within a row,
   up/down between rows — right-arrow navigation now works). **Run** is only shown in
   wild battles, never against trainers.
4. **Route editor** — `/game/route-editor.html` (+ `js/route-editor.js`,
   `css/route-editor.css`), a second standalone tool. Per map it edits: the tile layout
   (click-to-paint grid with a tile palette), dimensions, player start, the
   wild-encounter table (which creatures appear in tall grass, with level ranges +
   weighted odds shown as %), NPCs and trainers (party, reward item/TM, dialogue), and
   warps. Persistence mirrors the creature editor via `MAPS_OVERRIDE_KEY` (Save to
   Browser / Download this map / Reset), and validation blocks saving maps that would
   crash the game (unknown species, off-map start, etc.). **Encounter model (baseline):**
   every tall-grass tile on a map shares that map's single weighted table — the current
   grass→creature mapping. Per-patch tables (distinct grass patches on one route rolling
   different creatures) are the planned next step.
5. **Save v3** — adds `machines` (owned TMs/HMs). v2 saves migrate (granted the starting
   machines); the v1→v2→v3 chain is preserved.

## Phase 3 — special split, status conditions, and abilities

1. **Special Attack / Special Defense** — base stats gain `spAttack` / `spDefense`
   (all 19 creatures retuned). Moves gain a `category`: **physical** uses Attack vs
   Defense, **special** uses Sp.Atk vs Sp.Def, **status** deals no damage. STAB, dual
   types, and the pinch abilities all key off the correct stat now. (`computeStats`
   falls back to the physical stat if a species predates the split, so old data loads.)
2. **Status conditions** — the six non-volatile statuses
   (**burn / poison / badly-poisoned (toxic) / paralysis / sleep / freeze**), matching
   Bulbapedia's behavior:
   - Burn: 1/16 max HP end-of-turn, halves physical Attack. Poison: 1/8. Toxic:
     1/16, 2/16, 3/16… climbing each turn. Paralysis: ½ Speed, 25% full-stop.
     Sleep: 1–3 turns. Freeze: frozen until a 20%/turn thaw.
   - Applied by moves via `effect: { status, chance }` — damaging moves with a
     secondary chance (Flame Burst burn, Body Slam paralysis, …) and pure **status
     moves** (Static Field, Spore Puff, Singe, Venom Jab, Toxic Spray, Frost Breath,
     added as TM07–TM12). One non-volatile status at a time; type immunities apply
     (Fire can't burn, Electric can't be paralyzed, Poison/Steel can't be poisoned,
     Ice can't freeze). Status persists in and out of battle and in the save; a full
     heal (Elder Fenn) cures it. Shown as a colored badge (BRN/PSN/…) on HP boxes and
     the party list.
3. **Abilities** (framework + roster) — `data/abilities.json` defines passive abilities
   with a machine-readable `kind` the battle engine interprets, so new abilities of a
   known kind are pure data. Implemented kinds: `pinch_boost` (Blaze/Torrent/Overgrow),
   `guts`, `status_immunity` (Limber/Water Veil/Insomnia/Immunity), `contact_status`
   (Static/Flame Body), `type_immunity` (Levitate), `sturdy`. Every creature is assigned
   one; shown on starter-select and the CreatureDex, and **editable** in the Creature
   Editor. New ability *kinds* are added in `battle.js`; new abilities *of an existing
   kind* are just JSON. Saves keep working (status added to members; abilities derive
   from species, so no version bump needed).

Deferred within this area: volatile statuses (confusion, flinch, infatuation), stat
stages / stat-changing moves & abilities (Intimidate etc.), held items, and abilities
needing hooks not yet built.

## Phase 4 — battle completeness

Closes the gap between "most of the rules" and mainline battle behavior:

1. **PP + Struggle** — every move has Power Points (`pp` in moves.json, `curPP` per
   instance, persisted in the save); 0-PP moves are unselectable, and with nothing
   usable the creature Struggles (50-power typeless physical, recoil = ¼ max HP).
   A full heal restores PP.
2. **Critical hits** — 1/16 chance, 1.5x, "A critical hit!".
3. **Stat stages** — ±6 with the real multipliers (regular stats ×(2+n)/2, accuracy/
   evasion the 3-based table), applied to damage, speed order, and accuracy checks.
   Stat-changing moves added (Rattle Cry −Atk, Brace Up +Def, Gale Step +2 Spe) and
   threaded into learnsets; self-targeted stage moves never miss; stages reset on switch.
4. **Volatile statuses** — **confusion** (1–4 confused action-attempts, 50% 40-power
   typeless self-hit; Water Pulse gained a 20% confuse chance) and **flinch**
   (Headbutt 30%; only matters if the target hasn't moved; clears each turn).
5. **Move priority** — `priority` on moves resolves before speed (Quick Jab is +1).
6. **Manual switching** — "Party" battle command; switching consumes the turn and
   resets that side's stages/volatiles. Command grid is now Fight/Party/Item(/Run).
7. **Smarter enemy AI** — prefers highest expected damage (power × type × STAB × acc),
   scores status moves situationally, 15% random for variety, respects its own PP.
8. **New items** — Remedy Leaf (cures any status, usable in battle) and Revive Seed
   (revives at half HP, pause-menu only). Catch odds now get the mainline status bonus
   (×2 sleep/freeze, ×1.5 otherwise).
9. **Save v4** — member moves become `[{id, pp}]`; save gains `money` and `storage`
   (used by Phase 5). v1→v2→v3→v4 migration chain preserved.

## Phase 5 — world, progression & economy

1. **Money** — coins in the save; every trainer pays out on defeat (explicit
   `reward.money` or level-based default); shown in the pause menu.
2. **Shop** — NPCs can carry `shop: [itemIds]`; dialogue flows into a SHOP screen
   (buy with coin check). Merchant Wren runs Meadowfen Goods (village left building);
   all items have `price`.
3. **Creature storage (PC box)** — NPCs can flag `storage: true`; dialogue opens a
   two-pane deposit/withdraw UI (party 1–6 enforced). Catching with a full party now
   sends the catch to storage instead of blocking. Keeper Alder lives in the village
   right building.
4. **World** — the region grows to 7 maps: village + shop/storage interiors, Route 1,
   **Route 2** (2 trainers + rival), **Bramblehollow** (town 2, healer), and the
   **Bramble Gym** (gym hand + **Warden Thorne**, who awards the Bramble Badge, 1500c,
   and TM03). Badges count toward a ★ tally in the pause menu.
5. **Rival** — trainer NPCs can flag `rival: true`: their party is built at battle
   start to counter the player's starter (fire→water→grass→fire) at `rivalLevel`.
   Rival Rex waits on Route 2.
6. **Per-patch encounter zones** — maps may define `zones: [{x,y,w,h,rate,table}]`;
   grass inside a zone rolls that zone's table (Route 2's north and south patches
   differ). Outside any zone, the map default applies.
7. **Route editor upgrades** — **New Map** button (new maps live in the browser
   override; download + index.json listing makes them permanent), encounter-zone
   editor (rects + per-zone tables with % odds), trainer money/badge/rival fields,
   and NPC shop (item checklist) / storage flags.

## Phase 6 — feel & polish

1. **Sound** — `js/engine/audio.js`, an all-synthesized WebAudio chiptune engine
   (square lead + triangle bass sequencer; noise-burst SFX). Looping tracks for
   title/overworld/battle/evolve keyed off the state machine; SFX for hits (normal/
   super/weak), faint, orb throw, catch, level-up, and heal. Starts on the first
   user gesture (autoplay policy); **M** toggles mute (persisted). Zero asset files.
2. **Battle presentation** — attacker lunge on "used X!", defender blink on damage,
   screen shake on super-effective hits, faint slide-down (fainted sprite stays
   hidden until replaced), and a thrown-orb arc animation on catch attempts.
3. **Touch controls** — on-screen D-pad + A/B overlay (auto-shown for coarse
   pointers, forceable with `?touch=1`), wired through the same input layer as keys.

## Explicitly deferred (Phase 7+)

- Held items, breeding, day/night, weather
- Accuracy/evasion *moves* (the stage plumbing exists; no moves use it yet)
- More region content (routes 3+, additional gyms, Elite-Four-style finale, world map)
- Multiplayer/trading
- Cloud save (KV-backed, matching `worker.js` pattern) instead of localStorage only —
  needs a worker deploy, so it stays opt-in/explicit
- Final pixel-art sprite assets (still placeholder shapes at the correct dimensions;
  real 16-bit/32-bit art is a separate later pass)
- Hand-designed creature roster/world names (still build-agent placeholders)

## Suggested file scaffold (for the build agent to start from)

```
/game/
  index.html
  css/
    game.css
  js/
    main.js          — boot, state machine, game loop
    engine/
      renderer.js     — canvas draw calls, camera
      input.js        — keyboard/touch → intent
      tilemap.js       — map loading, collision, encounter trigger
    battle/
      battle.js         — turn resolution, damage calc
      typechart.js
    data/
      creatures.js      — loads/validates creatures.json
      moves.js
    save.js            — localStorage read/write, schema versioning
  data/
    creatures.json
    moves.json
    types.json
    maps/
      village.json
      route1.json
```

## Status: Phases 1 through 6 complete (1, 1.5, 2, 2.5, 2.6, 3, 4, 5, 6)

Phase 1 (engine, placeholder art, wild battles, save/load) and Phase 1.5 (3x resolution
bump) were built and verified end-to-end at `/game/`. Placeholder working title
"Creature Quest," region "Meadowfen" — all naming still swappable later, per the
"build-agent placeholders" decision above.

Phase 2 (this update) adds the creature-RPG core: XP/leveling, learnsets with the
forget-a-move prompt, evolutions (roster expanded to 19), a Pokédex with entries,
a Route 1 trainer battle (no fleeing/catching), an items/inventory system, and the v2
save format with v1 migration. Remaining open questions (real art sourcing, real
creature/world design, touch controls) are Phase 3+ and unaffected.
