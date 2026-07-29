// typechart.js — type effectiveness lookup.
// The chart is sparse: chart[attacker][defender] holds only non-1x values.
// Defenders may have 1-2 types; multipliers multiply across them (so 4x, 0.25x
// and hard immunities all fall out naturally, like mainline Pokemon).

export class TypeChart {
  constructor(json) {
    this.types = json.types;
    this.colors = json.colors;
    this.chart = json.chart;
  }

  // Multiplier for an attacking move type vs a defender's type or types array.
  multiplier(attackType, defense) {
    const row = this.chart[attackType] || {};
    const defs = Array.isArray(defense) ? defense : [defense];
    let m = 1;
    for (const d of defs) {
      const v = row[d];
      m *= typeof v === 'number' ? v : 1;
    }
    return m;
  }

  color(type) {
    return this.colors[type] || '#888';
  }

  // Human label for an effectiveness value.
  static label(mult) {
    if (mult === 0) return "It had no effect...";
    if (mult >= 2) return "It's super effective!";
    if (mult > 0 && mult < 1) return "It's not very effective...";
    return null;
  }
}

export async function loadTypes() {
  const res = await fetch('data/types.json');
  if (!res.ok) throw new Error('Failed to load types.json');
  return new TypeChart(await res.json());
}
