// trainers.js — preset NPC opponents for the simulator.
//
// A preset names its species and difficulty; the sets themselves are generated
// at battle time by randomSet(), scaled to whatever level the challenge is run
// at. That keeps presets to one line each and means they stay legal
// automatically as creatures.json changes.

import { randomSet, randomTeam, makeSet, TEAM_SIZE, clamp } from './sets.js';

export const PRESET_TRAINERS = [
  {
    id: 'random',
    name: 'Random Challenger',
    blurb: 'A scratch team drawn from the whole dex.',
    species: null, // rolled fresh each battle
    difficulty: 'trainer',
    size: 6,
  },
  {
    id: 'ren',
    name: 'Rookie Ren',
    blurb: 'Three unevolved creatures and no plan. A warm-up.',
    species: ['emberling', 'dripling', 'sproutle'],
    difficulty: 'rookie',
    size: 3,
    levelOffset: -5,
  },
  {
    id: 'sela',
    name: 'Surfer Sela',
    blurb: 'Rain-slick Water specialists that grind you down.',
    species: ['torrentail', 'tidewhirl', 'mudpad', 'gyreshell'],
    difficulty: 'trainer',
    size: 4,
  },
  {
    id: 'kade',
    name: 'Sparks Kade',
    blurb: 'Fast Electric offence. Bring something grounded.',
    species: ['voltpup', 'volthound', 'zaptooth'],
    difficulty: 'trainer',
    size: 3,
  },
  {
    id: 'bramble',
    name: 'Gym Leader Bramble',
    blurb: 'A full six, played properly. The real test.',
    species: ['verdantitan', 'bramblore', 'thornback', 'infernyx', 'maelstrode', 'zaptooth'],
    difficulty: 'ace',
    size: 6,
  },
];

export function getPreset(id) {
  return PRESET_TRAINERS.find((t) => t.id === id) || PRESET_TRAINERS[0];
}

// Build the preset's team at `level`. `mirror` presets aren't handled here —
// the battle screen copies the player's own sets for that.
export function buildTrainerTeam(dex, preset, level, format) {
  const lvl = clamp(level + (preset.levelOffset || 0), 1, 100);
  if (!preset.species) return randomTeam(dex, preset.size || TEAM_SIZE, lvl, format);
  return preset.species
    .filter((id) => dex.creatures[id])
    .slice(0, preset.size || TEAM_SIZE)
    .map((id) => randomSet(dex, id, lvl, format) || makeSet(dex, id, format, lvl));
}
