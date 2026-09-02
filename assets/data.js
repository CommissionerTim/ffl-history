// data.js — fetches each year-tab's published CSV straight from the live
// Google Sheet at page load time, and parses it into normalized rows using
// calc.js. This is the only network-facing module; calc.js stays pure.

import { normalizeYearRows } from './calc.js';

function csvUrlForYear(sheetId, year) {
  // The gviz/tq endpoint accepts a sheet NAME (not gid), works cross-origin
  // for a publicly-viewable sheet, and always reflects the sheet's current
  // contents (no separate "publish to web" step required).
  const params = new URLSearchParams({ tqx: 'out:csv', sheet: String(year) });
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${params.toString()}`;
}

async function fetchYearCsv(sheetId, year) {
  const url = csvUrlForYear(sheetId, year);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${year} tab`);
  }
  return res.text();
}

/**
 * Fetch + parse every year in `years`. Returns { seasons, errors } —
 * errors is never silently swallowed, so a bad/renamed tab surfaces as a
 * visible warning on the page instead of quietly dropping a season's data.
 */
export async function loadAllSeasons(sheetId, years) {
  const results = await Promise.allSettled(
    years.map(async (year) => {
      const csvText = await fetchYearCsv(sheetId, year);
      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      if (parsed.errors && parsed.errors.length) {
        throw new Error(`CSV parse error in ${year} tab: ${parsed.errors[0].message}`);
      }
      const rows = normalizeYearRows(parsed.data, year);
      return { year, rows };
    })
  );

  const seasons = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      seasons.push(r.value);
    } else {
      errors.push({ year: years[i], message: r.reason?.message ?? String(r.reason) });
    }
  });
  seasons.sort((a, b) => a.year - b.year);
  return { seasons, errors };
}
