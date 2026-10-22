// Renders the small flag images the travel tables show (images/flags/):
// one 42×28 PNG per country in data/countries.json (named by ISO code, from
// data/world-countries.geojson, with the name → code map in
// data/country-flags.json for the World page) and per US state
// (us-<postal code>.png).
// Shown at 21×14, so 2× for sharp screens. Re-run when a country is added.
//
// Sources, unpacked from npm (no install needed, nothing here is executed):
//   flag-icons (MIT)       npm pack flag-icons      → <dir>/package/flags/4x3/*.svg
//   us-state-flags (ISC)   npm pack us-state-flags  → <dir>/package/src/components/flags/Flag??.js
//
// Usage (needs Playwright's Chromium, as the game tests do):
//   node scripts/build-flags.mjs <flag-icons dir> <us-state-flags dir>
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const [flagIconsDir, stateFlagsDir] = process.argv.slice(2);
if (!flagIconsDir || !stateFlagsDir) {
    console.error('usage: node scripts/build-flags.mjs <flag-icons dir> <us-state-flags dir>');
    process.exit(1);
}

// Playwright from a local or the global install.
let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch {
    const globalRoot = execSync('npm root -g').toString().trim();
    ({ chromium } = createRequire(join(globalRoot, 'x.js'))('playwright'));
}

const W = 42, H = 28;
const OUT = 'images/flags';
mkdirSync(OUT, { recursive: true });

// Country name → ISO code, from the map's outlines (their core feature).
const isoByName = {};
for (const f of JSON.parse(readFileSync('data/world-countries.geojson', 'utf8')).features) {
    if (!f.properties.part) isoByName[f.properties.name] = f.properties.iso.toLowerCase();
}
const countries = Object.values(JSON.parse(readFileSync('data/countries.json', 'utf8'))).flat();

const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
    'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
    'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

// us-state-flags wraps each flag's SVG in a React component: pull out the
// viewBox and the inner markup.
function stateSvg(code) {
    const src = readFileSync(join(stateFlagsDir, `package/src/components/flags/Flag${code}.js`), 'utf8');
    const viewBox = src.match(/viewBox:\s*'([^']+)'/)[1];
    const inner = src.match(/__html:\s*`([\s\S]*?)`/)[1];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;
}

const jobs = [];
const codes = {};
for (const c of countries) {
    const iso = isoByName[c.name];
    const file = join(flagIconsDir, `package/flags/4x3/${iso}.svg`);
    if (!iso || !existsSync(file)) throw new Error(`No flag for ${c.name} (${iso})`);
    jobs.push([`${iso}.png`, readFileSync(file, 'utf8')]);
    codes[c.name] = iso;
}
const sorted = Object.fromEntries(Object.entries(codes).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync('data/country-flags.json', JSON.stringify(sorted, null, 1) + '\n');
for (const s of STATES) jobs.push([`us-${s.toLowerCase()}.png`, stateSvg(s)]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
for (const [name, svg] of jobs) {
    // Fill the 3:2 box, cropping a 4:3 flag's top and bottom a little.
    const fitted = svg.replace(/<svg\b/, `<svg width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"`);
    await page.setContent(`<style>html,body{margin:0}svg{display:block}</style>${fitted}`);
    writeFileSync(join(OUT, name), await page.screenshot({ clip: { x: 0, y: 0, width: W, height: H } }));
}
await browser.close();
console.log(`${jobs.length} flags written to ${OUT}/`);
