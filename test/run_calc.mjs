// Node verification harness: parses the real fixture CSVs (pulled straight
// from the actual Google Sheet) with the same CSV library the browser uses
// (PapaParse), runs them through the exact same calc.js the site uses, and
// prints the full computed leaderboard as JSON for inspection / diffing
// against an independent cross-check.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import {
  normalizeYearRows,
  normalizeOtherRecordsRows,
  buildLeaderboard,
  pythagoreanWinPct,
  pointsScoredZScoresForYear,
  pointsScoredRanksForYear,
  luckIndexForYear,
} from '../assets/calc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

// Only year-tab fixtures (numeric filenames) go into season aggregation;
// "Other Records.csv" is the freeform tab, parsed separately below.
const years = fs
  .readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.csv'))
  .map((f) => path.basename(f, '.csv'))
  .filter((stem) => /^\d+$/.test(stem))
  .sort();

const seasons = years.map((year) => {
  const csvText = fs.readFileSync(path.join(fixturesDir, `${year}.csv`), 'utf8');
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const rows = normalizeYearRows(parsed.data, Number(year));
  return { year: Number(year), rows };
});

const { careers, recordBook } = buildLeaderboard(seasons);

// Flat per-season, per-manager row stats (Season Stats page columns), for
// an independent pandas cross-check at the row level -- not just the
// derived career-table bests/worsts above.
const seasonStats = [];
for (const { year, rows } of seasons) {
  const zScores = pointsScoredZScoresForYear(rows);
  const ranks = pointsScoredRanksForYear(rows);
  const luck = luckIndexForYear(rows);
  for (const r of rows) {
    seasonStats.push({
      year,
      manager: r.manager,
      managerKey: r.managerKey,
      pythagWinPct: pythagoreanWinPct(r),
      zScore: zScores.get(r.managerKey) ?? null,
      pointsScoredRank: ranks.get(r.managerKey) ?? null,
      luckIndex: luck.get(r.managerKey) ?? null,
    });
  }
}

// "Other Records" tab (freeform, hand-entered) — parsed independently of
// the season data above, for its own cross-check. Parsed headerless (not
// `header: true`) and mapped manually here, matching the real fix in
// site/assets/data.js: the real sheet's CSV export pads every row with
// many trailing blank quoted columns, a shape PapaParse's header mode
// mishandles (spurious errors, and even silently dropped rows).
function rowsFromRawCsv(rawRows) {
  if (rawRows.length === 0) return [];
  const headers = rawRows[0];
  return rawRows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => {
      const key = (h ?? '').toString().trim();
      if (!key) return;
      obj[key] = cells[i] ?? '';
    });
    return obj;
  });
}
const otherRecordsFixture = path.join(fixturesDir, 'Other Records.csv');
const otherRecords = fs.existsSync(otherRecordsFixture)
  ? normalizeOtherRecordsRows(
      rowsFromRawCsv(Papa.parse(fs.readFileSync(otherRecordsFixture, 'utf8'), { header: false, skipEmptyLines: true }).data)
    )
  : [];

const out = { seasonsLoaded: years, careers, recordBook, seasonStats, otherRecords };
fs.writeFileSync(path.join(__dirname, 'calc_output.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
