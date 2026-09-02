// calc.js — pure, deterministic stat calculations for the FFL history site.
//
// No DOM access, no network calls. Everything here is a plain function of
// its inputs so it can be unit-tested the same way in Node (see /test) and
// in the browser. This is the ONLY place cross-year math happens — nothing
// here is eyeballed or estimated.
//
// Runs as a native ES module in both the browser (<script type="module">)
// and Node (import ... from './calc.js').

const EPS = 1e-9;

// Tiebreak chain for "best regular-season record" within a single season
// (this only matters for the "#1 regular-season finish" record —
// Championships / last-place / appearances all come straight from the
// sheet's Final Standing column, which is never tied). Per league rule:
// regular-season win% first, then whoever scored more points that year,
// then (in the practically-impossible event both are still tied)
// alphabetically, so this always resolves to exactly one manager.

// ---------------------------------------------------------------------
// Parsing: raw CSV rows (as arrays, e.g. from PapaParse with header:true)
// -> normalized season-row objects.
// ---------------------------------------------------------------------

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const cleaned = s.replace(/[%,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize one parsed CSV row (object keyed by the sheet's header names)
 * into a season-row. Returns null for rows that aren't real data rows
 * (blank rows, the "HOW TO USE THIS TAB" instructional rows, etc.) —
 * those are recognized by not having a parseable Manager + Reg Season W.
 */
export function normalizeRow(raw, year) {
  const manager = (raw['Manager'] ?? '').toString().trim();
  const regW = toNumber(raw['Reg Season W']);
  const regL = toNumber(raw['Reg Season L']);
  if (!manager || regW === null || regL === null) return null;

  const regT = toNumber(raw['Reg Season T']) ?? 0;
  const playoffW = toNumber(raw['Playoff W']) ?? 0;
  const playoffL = toNumber(raw['Playoff L']) ?? 0;
  const finalStanding = toNumber(raw['Final Standing']);
  const pointsScored = toNumber(raw['Points Scored']);
  const pointsAgainst = toNumber(raw['Points Against']);
  const highestWeek = toNumber(raw['Highest Single Week Score']); // null = no data, never 0
  const moves = toNumber(raw['Moves']);

  if (finalStanding === null || pointsScored === null) return null;

  return {
    year,
    manager,
    managerKey: manager.toLowerCase(),
    regW, regL, regT,
    playoffW, playoffL,
    finalStanding,
    pointsScored,
    pointsAgainst,
    highestWeek,
    moves: moves ?? 0,
  };
}

/** Parse an already-split CSV (array of objects keyed by header) for one year. */
export function normalizeYearRows(parsedRows, year) {
  return parsedRows
    .map((r) => normalizeRow(r, year))
    .filter((r) => r !== null);
}

// ---------------------------------------------------------------------
// Per-row / per-season derived values
// ---------------------------------------------------------------------

export function regSeasonWinPct(row) {
  const denom = row.regW + row.regL + row.regT;
  if (denom <= 0) return null;
  return (row.regW + 0.5 * row.regT) / denom;
}

export function playoffWinPct(row) {
  const denom = row.playoffW + row.playoffL;
  if (denom <= 0) return null;
  return row.playoffW / denom;
}

export function pointsPerGame(row) {
  const denom = row.regW + row.regL + row.regT;
  if (denom <= 0) return null;
  return row.pointsScored / denom;
}

/** The Final Standing value that represents "last place" for a given year's rows. */
export function lastPlaceStandingForYear(yearRows) {
  return Math.max(...yearRows.map((r) => r.finalStanding));
}

/**
 * The single manager credited with the #1 regular-season finish for one
 * year's rows: best regular-season win%, ties broken by points scored that
 * year, then (still tied) alphabetically. Returns null if the year has no
 * rows.
 */
export function regSeasonLeaderForYear(yearRows) {
  let leader = null;
  let leaderPct = -Infinity;
  for (const r of yearRows) {
    const pct = regSeasonWinPct(r);
    if (pct === null) continue;
    if (leader === null) {
      leader = r;
      leaderPct = pct;
      continue;
    }
    if (pct > leaderPct + EPS) {
      leader = r; leaderPct = pct;
    } else if (Math.abs(pct - leaderPct) < EPS) {
      if (r.pointsScored > leader.pointsScored) {
        leader = r; leaderPct = pct;
      } else if (r.pointsScored === leader.pointsScored && r.manager.localeCompare(leader.manager) < 0) {
        leader = r; leaderPct = pct;
      }
    }
  }
  return leader;
}

// ---------------------------------------------------------------------
// Career aggregation
// ---------------------------------------------------------------------

/**
 * @param {Array<{year:number, rows:Array}>} seasons - one entry per year tab,
 *   each with that year's normalized rows.
 * @returns {Array} one career-totals object per manager, sorted alphabetically.
 */
export function aggregateCareers(seasons) {
  // Precompute per-year last place + the reg-season leader's key once.
  const lastPlaceByYear = new Map();
  const regLeaderKeyByYear = new Map();
  for (const { year, rows } of seasons) {
    lastPlaceByYear.set(year, rows.length ? lastPlaceStandingForYear(rows) : null);
    const leader = regSeasonLeaderForYear(rows);
    regLeaderKeyByYear.set(year, leader ? leader.managerKey : null);
  }

  const byKey = new Map(); // managerKey -> { nameCounts: Map, rows: [] }
  for (const { rows } of seasons) {
    for (const r of rows) {
      if (!byKey.has(r.managerKey)) byKey.set(r.managerKey, { nameCounts: new Map(), rows: [] });
      const entry = byKey.get(r.managerKey);
      entry.nameCounts.set(r.manager, (entry.nameCounts.get(r.manager) ?? 0) + 1);
      entry.rows.push(r);
    }
  }

  const careers = [];
  for (const [managerKey, { nameCounts, rows }] of byKey) {
    // Canonical display spelling = most frequently used exact casing;
    // alphabetical among ties for determinism.
    let displayName = '';
    let bestCount = -1;
    for (const [name, count] of [...nameCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (count > bestCount) {
        bestCount = count;
        displayName = name;
      }
    }

    let regW = 0, regL = 0, regT = 0, playoffW = 0, playoffL = 0;
    let careerPointsScored = 0, championships = 0, championshipAppearances = 0;
    let lastPlaceFinishes = 0, regSeasonFirsts = 0;
    let standingSum = 0, movesSum = 0;

    for (const r of rows) {
      regW += r.regW; regL += r.regL; regT += r.regT;
      playoffW += r.playoffW; playoffL += r.playoffL;
      careerPointsScored += r.pointsScored;
      if (r.finalStanding === 1) championships += 1;
      if (r.finalStanding === 1 || r.finalStanding === 2) championshipAppearances += 1;
      if (lastPlaceByYear.get(r.year) !== null && r.finalStanding === lastPlaceByYear.get(r.year)) {
        lastPlaceFinishes += 1;
      }
      if (regLeaderKeyByYear.get(r.year) === managerKey) regSeasonFirsts += 1;
      standingSum += r.finalStanding;
      movesSum += r.moves;
    }

    const regDenom = regW + regL + regT;
    const playoffDenom = playoffW + playoffL;

    careers.push({
      managerKey,
      manager: displayName,
      seasonsPlayed: rows.length,
      regW, regL, regT,
      regWinPct: regDenom > 0 ? (regW + 0.5 * regT) / regDenom : null,
      playoffW, playoffL,
      playoffWinPct: playoffDenom > 0 ? playoffW / playoffDenom : null,
      careerPointsScored,
      championships,
      championshipAppearances,
      lastPlaceFinishes,
      regSeasonFirsts,
      avgFinalStanding: standingSum / rows.length,
      avgMoves: movesSum / rows.length,
    });
  }

  careers.sort((a, b) => a.manager.localeCompare(b.manager));
  return careers;
}

// ---------------------------------------------------------------------
// Record book: single-event stats, each with year + manager attached.
// A tie is reported as multiple holders (sorted alphabetically) rather
// than arbitrarily picking one — nothing here invents a winner.
// ---------------------------------------------------------------------

function tiedHolders(entries, valueFn) {
  let best = -Infinity;
  for (const e of entries) {
    const v = valueFn(e);
    if (v !== null && v > best) best = v;
  }
  if (best === -Infinity) return { value: null, holders: [] };
  const holders = entries
    .filter((e) => {
      const v = valueFn(e);
      return v !== null && Math.abs(v - best) < EPS;
    })
    .sort((a, b) => a.manager.localeCompare(b.manager));
  return { value: best, holders };
}

export function computeRecordBook(seasons, careers) {
  const allRows = seasons.flatMap((s) => s.rows);

  const highestSingleWeek = tiedHolders(
    allRows.filter((r) => r.highestWeek !== null),
    (r) => r.highestWeek
  );

  const mostChampionships = tiedHolders(careers, (c) => c.championships);
  const mostRegSeasonFirsts = tiedHolders(careers, (c) => c.regSeasonFirsts);
  const mostLastPlace = tiedHolders(careers, (c) => c.lastPlaceFinishes);

  const ppgRows = allRows
    .map((r) => ({ ...r, ppg: pointsPerGame(r) }))
    .filter((r) => r.ppg !== null);
  const bestSeasonPPG = tiedHolders(ppgRows, (r) => r.ppg);

  return {
    highestSingleWeek: {
      value: highestSingleWeek.value,
      holders: highestSingleWeek.holders.map((r) => ({ manager: r.manager, year: r.year })),
    },
    mostChampionships: {
      value: mostChampionships.value,
      holders: mostChampionships.holders.map((c) => ({ manager: c.manager })),
    },
    mostRegSeasonFirsts: {
      value: mostRegSeasonFirsts.value,
      holders: mostRegSeasonFirsts.holders.map((c) => ({ manager: c.manager })),
    },
    mostLastPlace: {
      value: mostLastPlace.value,
      holders: mostLastPlace.holders.map((c) => ({ manager: c.manager })),
    },
    bestSeasonPPG: {
      value: bestSeasonPPG.value,
      holders: bestSeasonPPG.holders.map((r) => ({ manager: r.manager, year: r.year })),
    },
  };
}

export function buildLeaderboard(seasons) {
  const careers = aggregateCareers(seasons);
  const recordBook = computeRecordBook(seasons, careers);
  return { careers, recordBook };
}
