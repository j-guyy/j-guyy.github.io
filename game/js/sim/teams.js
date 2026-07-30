// teams.js — saved teams (localStorage) and the Showdown-style text format for
// importing/exporting them.
//
// The text format is deliberately close to Pokemon Showdown's so it reads
// naturally to anyone who has used that site:
//
//   Sparky (Volthound)
//   Level: 50
//   Ability: Static
//   Nature: Jolly
//   EVs: 252 Atk / 4 HP / 252 Spe
//   IVs: 0 SpA
//   - Volt Arc
//   - Quick Jab
//
// Only the species line is required; everything else falls back to the same
// defaults makeSet() uses. Blank lines separate creatures.

import { NATURES, STAT_KEYS, STAT_LABEL, normalizeSet, makeSet, clamp } from './sets.js';

export const TEAMS_KEY = 'jg_creature_sim_teams';

// ---- Storage ---------------------------------------------------------------

export function loadTeams() {
  try {
    const raw = localStorage.getItem(TEAMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // corrupt entry — start clean rather than breaking the page
  }
}

export function saveTeams(teams) {
  try {
    localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
    return true;
  } catch {
    return false; // private browsing / quota — the builder still works in memory
  }
}

export function upsertTeam(name, format, team) {
  const teams = loadTeams();
  const record = { name, format, team, savedAt: Date.now() };
  const at = teams.findIndex((t) => t.name === name);
  if (at >= 0) teams[at] = record;
  else teams.push(record);
  saveTeams(teams);
  return teams;
}

export function deleteTeam(name) {
  const teams = loadTeams().filter((t) => t.name !== name);
  saveTeams(teams);
  return teams;
}

// ---- Export ----------------------------------------------------------------

function statList(values, skipValue) {
  return STAT_KEYS
    .filter((key) => values[key] !== skipValue)
    .map((key) => `${values[key]} ${STAT_LABEL[key]}`)
    .join(' / ');
}

export function exportSet(dex, set) {
  const species = dex.species(set.species);
  const lines = [];
  lines.push(set.nickname ? `${set.nickname} (${species.name})` : species.name);
  lines.push(`Level: ${set.level}`);
  if (set.ability) lines.push(`Ability: ${dex.ability(set.ability).name}`);
  lines.push(`Nature: ${NATURES[set.nature].name}`);
  const evs = statList(set.evs, 0);
  if (evs) lines.push(`EVs: ${evs}`);
  const ivs = statList(set.ivs, 31);
  if (ivs) lines.push(`IVs: ${ivs}`);
  for (const id of set.moves) lines.push(`- ${dex.moves[id].name}`);
  return lines.join('\n');
}

export function exportTeam(dex, team) {
  return team.map((set) => exportSet(dex, set)).join('\n\n');
}

// ---- Import ----------------------------------------------------------------

function byName(map, nameFn) {
  const index = {};
  for (const [id, value] of Object.entries(map)) {
    index[normalizeName(nameFn(value, id))] = id;
  }
  return index;
}

function normalizeName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseStatLine(text, max) {
  const out = {};
  for (const chunk of text.split('/')) {
    const m = chunk.trim().match(/^(\d+)\s+([A-Za-z.]+)$/);
    if (!m) continue;
    const value = clamp(parseInt(m[1], 10), 0, max);
    const key = STAT_KEYS.find((k) => normalizeName(STAT_LABEL[k]) === normalizeName(m[2]));
    if (key) out[key] = value;
  }
  return out;
}

// Parses the text format back into sets. Returns { team, errors } — unparseable
// blocks are reported rather than silently dropped, so a typo'd species name
// doesn't just vanish from the imported team.
export function importTeam(dex, text, format) {
  const speciesIndex = byName(dex.creatures, (c) => c.name);
  const moveIndex = byName(dex.moves, (m) => m.name);
  const abilityIndex = byName(dex.abilities, (a) => a.name);
  const natureIndex = byName(NATURES, (n) => n.name);

  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const team = [];
  const errors = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // "Nickname (Species)" or just "Species"; trailing " @ Item" is tolerated
    // and ignored (the engine has no held items).
    const head = lines[0].split('@')[0].trim();
    const paren = head.match(/^(.*)\(([^)]+)\)\s*$/);
    const nickname = paren ? paren[1].trim() : '';
    const speciesName = paren ? paren[2].trim() : head;
    const speciesId = speciesIndex[normalizeName(speciesName)];
    if (!speciesId) {
      errors.push(`Unknown creature "${speciesName}".`);
      continue;
    }

    const raw = { species: speciesId, nickname, moves: [] };
    for (const line of lines.slice(1)) {
      const move = line.match(/^-\s*(.+)$/);
      if (move) {
        const moveId = moveIndex[normalizeName(move[1])];
        if (moveId) raw.moves.push(moveId);
        else errors.push(`${speciesName}: unknown move "${move[1].trim()}".`);
        continue;
      }
      const [labelPart, ...rest] = line.split(':');
      if (!rest.length) continue;
      const label = normalizeName(labelPart);
      const value = rest.join(':').trim();
      if (label === 'level') raw.level = parseInt(value, 10);
      else if (label === 'ability') raw.ability = abilityIndex[normalizeName(value)];
      else if (label === 'nature') raw.nature = natureIndex[normalizeName(value)];
      else if (label === 'evs') raw.evs = parseStatLine(value, 252);
      else if (label === 'ivs') raw.ivs = parseStatLine(value, 31);
    }

    const set = normalizeSet(dex, raw, format) || makeSet(dex, speciesId, format);
    team.push(set);
  }

  if (!team.length && !errors.length) errors.push('Nothing to import.');
  return { team: team.slice(0, 6), errors };
}
