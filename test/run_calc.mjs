// Node verification harness: parses the real fixture CSVs (pulled straight
// from the actual Google Sheet) with the same CSV library the browser uses
// (PapaParse), runs them through the exact same calc.js the site uses, and
// prints the full computed leaderboard as JSON for inspection / diffing
// against an independent cross-check.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { normalizeYearRows, buildLeaderboard } from '../assets/calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

const years = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.csv'))
  .map((f) => path.basename(f, '.csv'))
  .sort();

const seasons = years.map((year) => {
  const csvText = fs.readFileSync(path.join(fixturesDir, `${year}.csv`), 'utf8');
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const rows = normalizeYearRows(parsed.data, Number(year));
  return { year: Number(year), rows };
});

const { careers, recordBook } = buildLeaderboard(seasons);

const out = { seasonsLoaded: years, careers, recordBook };
fs.writeFileSync(path.join(__dirname, 'calc_output.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
