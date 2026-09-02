// data.js — fetches each year-tab's published CSV straight from the live
// Google Sheet at page load time, and parses it into normalized rows using
// calc.js. This is the only network-facing module; calc.js stays pure.

import { normalizeYearRows, normalizeOtherRecordsRows } from './calc.js';

function csvUrlForSheetTab(sheetId, tabName) {
  // The gviz/tq endpoint accepts a sheet NAME (not gid), works cross-origin
  // for a publicly-viewable sheet, and always reflects the sheet's current
  // contents (no separate "publish to web" step required).
  const params = new URLSearchParams({ tqx: 'out:csv', sheet: tabName });
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${params.toString()}`;
}

async function fetchSheetTabCsv(sheetId, tabName) {
  const url = csvUrlForSheetTab(sheetId, tabName);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching "${tabName}" tab`);
  }
  return res.text();
}

async function fetchYearCsv(sheetId, year) {
  return fetchSheetTabCsv(sheetId, String(year));
}

/**
 * Convert a headerless Papa.parse result (array of arrays, `header: false`)
 * into header-keyed row objects, using the first row as column names. This
 * exists to sidestep a real PapaParse quirk: Google Sheets' CSV export pads
 * every row out to the tab's full column width with trailing blank quoted
 * cells (e.g. 3 named columns + 23 blank ones), and PapaParse's own
 * `header: true` mode can misparse that shape — emitting spurious
 * InvalidQuotes/TooFewFields errors and, worse, silently dropping data rows
 * from its output. Parsing headerless and mapping manually here is
 * unaffected by that quirk. Columns whose header cell is blank (i.e. the
 * padding columns themselves) are dropped; every other column is kept,
 * including rows with a blank cell value.
 */
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

/**
 * Fetch + parse the freeform "Other Records" tab (see config.js). Unlike
 * `loadAllSeasons`, this tab is optional and hand-maintained — it may not
 * exist yet, or might get renamed by mistake — so a fetch/parse failure is
 * returned as `{ records: [], error }` rather than thrown, letting the
 * caller decide how loudly (or quietly) to surface it instead of breaking
 * the rest of the page over a supplementary, non-computed feature.
 */
export async function loadOtherRecords(sheetId, tabName) {
  try {
    const csvText = await fetchSheetTabCsv(sheetId, tabName);
    // Parsed headerless (see rowsFromRawCsv above) rather than with
    // `header: true` -- this tab's real CSV export is padded with many
    // trailing blank columns, a shape PapaParse's header mode mishandles.
    const parsed = Papa.parse(csvText, { header: false, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length) {
      throw new Error(`CSV parse error in "${tabName}" tab: ${parsed.errors[0].message}`);
    }
    return { records: normalizeOtherRecordsRows(rowsFromRawCsv(parsed.data)), error: null };
  } catch (err) {
    return { records: [], error: err?.message ?? String(err) };
  }
}
