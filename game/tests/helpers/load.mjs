// load.mjs — builds the real Dex and TypeChart straight from the repo's JSON.
//
// Deliberately constructs `new Dex(...)` rather than calling loadDex(), so tests
// read the committed files and never the localStorage override that the
// Creature Editor writes.

import './dom-stub.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TypeChart } from '../../js/battle/typechart.js';
import { Dex } from '../../js/data/dex.js';

export const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(GAME_DIR, relPath), 'utf8'));
}

export function listMapIds() {
  return fs
    .readdirSync(path.join(GAME_DIR, 'data/maps'))
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export function readMap(id) {
  return readJson(`data/maps/${id}.json`);
}

export function readAllMaps() {
  return Object.fromEntries(listMapIds().map((id) => [id, readMap(id)]));
}

// The same five files the game loads at boot, wired into a live Dex. Throws
// exactly where the game would if the data is broken — Dex's constructor runs
// its own validator.
export function loadGameData() {
  const typeChart = new TypeChart(readJson('data/types.json'));
  const dex = new Dex(
    readJson('data/creatures.json'),
    readJson('data/moves.json'),
    readJson('data/items.json'),
    readJson('data/machines.json'),
    readJson('data/abilities.json'),
    typeChart,
  );
  return { dex, typeChart };
}
