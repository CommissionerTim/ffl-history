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

/**
 * Parse the freeform "Other Records" tab: hand-entered anecdotal records
 * (e.g. "Most drinks consumed at the draft — 3 — Tim") with columns
 * "Record Name", "Record Value", "Record Holder". Unlike every other stat
 * in this file, these values are NOT computed — they're typed directly
 * into the sheet, verbatim. This only trims whitespace and drops rows
 * missing a name or value (blank rows, stray instructional rows, etc.); it
 * never computes, estimates, or reorders anything. The "Record Holder"
 * column is optional — a row with no holder just renders with a "—" there,
 * same as every other holderless stat on the site.
 * @returns {Array<{label:string, value:string, holders:string}>}
 */
export function normalizeOtherRecordsRows(parsedRows) {
  return parsedRows
    .map((raw) => {
      const label = (raw['Record Name'] ?? '').toString().trim();
      const value = (raw['Record Value'] ?? '').toString().trim();
      const holders = (raw['Record Holder'] ?? '').toString().trim();
      if (!label || !value) return null;
      return { label, value, holders };
    })
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

export function pointsAgainstPerGame(row) {
  const denom = row.regW + row.regL + row.regT;
  if (denom <= 0 || row.pointsAgainst === null) return null;
  return row.pointsAgainst / denom;
}

// Exponent used for Pythagorean win expectation. Fit directly to this
// league's own history (all manager-seasons on record) rather than
// borrowed from the NFL: 6.10 is the value that minimizes squared error
// between the formula's predicted win% and each manager-season's actual
// regular-season win%, found by a golden-section search over
// test/fit_pythagorean_exponent.py. Fantasy scores cluster far more
// tightly around the mean (this league's week-to-week coefficient of
// variation is ~18-19%) than real NFL team scoring does (~45-50%, which is
// what the commonly-cited 2.37 football exponent is tuned for), and a
// tighter score distribution calls for a steeper exponent — 6.10 cuts
// prediction error (mean squared error) roughly in half versus 2.37 on
// this league's actual results. Re-run that script every season or two to
// check whether the fitted value has drifted as more seasons are added.
const PYTHAGOREAN_EXPONENT = 6.1;

/**
 * The win percentage a manager's record "should" be, based purely on points
 * scored vs. points allowed that season — independent of their actual
 * wins/losses. A common measure of how much of a record reflects scoring
 * strength vs. schedule/matchup luck. Null if either total is missing.
 */
export function pythagoreanWinPct(row, exponent = PYTHAGOREAN_EXPONENT) {
  if (row.pointsScored === null || row.pointsAgainst === null) return null;
  if (row.pointsScored < 0 || row.pointsAgainst < 0) return null;
  const pf = Math.pow(row.pointsScored, exponent);
  const pa = Math.pow(row.pointsAgainst, exponent);
  const denom = pf + pa;
  if (denom <= 0) return null;
  return pf / denom;
}

/** The Final Standing value that represents "last place" for a given year's rows. */
export function lastPlaceStandingForYear(yearRows) {
  return Math.max(...yearRows.map((r) => r.finalStanding));
}

/**
 * The two Final Standing values that make up the "Maid Bowl" (the bottom
 * two finishers) for a given year's rows — last place and second-to-last.
 * Works for any number of teams that year, the same way
 * lastPlaceStandingForYear does. If a year somehow has fewer than two
 * distinct standings, returns whatever distinct standings exist.
 * @returns {Set<number>}
 */
export function bottomTwoStandingsForYear(yearRows) {
  const distinct = [...new Set(yearRows.map((r) => r.finalStanding))].sort((a, b) => b - a);
  return new Set(distinct.slice(0, 2));
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

/**
 * Standard-competition ranking (1224) of a year's rows by points scored,
 * highest first: rank 1 = most points scored that year. Equal points share
 * a rank (the next distinct score's rank skips accordingly) — points
 * scored are real-valued totals, so an exact tie is vanishingly unlikely,
 * but this stays fully deterministic if it ever happens (ties broken
 * alphabetically for ordering only, not for the shared rank value itself).
 * Rows with no points-scored figure are left out of the returned map.
 * @returns {Map<string, number>} managerKey -> rank
 */
export function pointsScoredRanksForYear(yearRows) {
  const sorted = [...yearRows]
    .filter((r) => r.pointsScored !== null)
    .sort((a, b) => b.pointsScored - a.pointsScored || a.manager.localeCompare(b.manager));

  const ranks = new Map();
  let rank = 0;
  let seen = 0;
  let prevScore = null;
  for (const r of sorted) {
    seen += 1;
    if (prevScore === null || Math.abs(r.pointsScored - prevScore) > EPS) {
      rank = seen;
      prevScore = r.pointsScored;
    }
    ranks.set(r.managerKey, rank);
  }
  return ranks;
}

/**
 * Z-score of each manager's points scored against that season's own
 * league mean/standard deviation (population std, since a season's rows
 * are the entire league that year, not a sample of it). 0 = exactly
 * average. If every row has the same points scored (std = 0, degenerate),
 * everyone is scored 0 rather than dividing by zero.
 * @returns {Map<string, number>} managerKey -> z-score
 */
export function pointsScoredZScoresForYear(yearRows) {
  const values = yearRows.map((r) => r.pointsScored).filter((v) => v !== null);
  const zScores = new Map();
  if (values.length === 0) return zScores;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);

  for (const r of yearRows) {
    if (r.pointsScored === null) continue;
    zScores.set(r.managerKey, std > EPS ? (r.pointsScored - mean) / std : 0);
  }
  return zScores;
}

/**
 * Luck Index for one year's rows: that manager's Points Scored Rank minus
 * their Final Standing. Positive = finished better than their scoring
 * alone would predict (lucky); negative = finished worse (unlucky).
 * @returns {Map<string, number>} managerKey -> luck index
 */
export function luckIndexForYear(yearRows) {
  const ranks = pointsScoredRanksForYear(yearRows);
  const luck = new Map();
  for (const r of yearRows) {
    const rank = ranks.get(r.managerKey);
    if (rank === undefined || r.finalStanding === null) continue;
    luck.set(r.managerKey, rank - r.finalStanding);
  }
  return luck;
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
  // Precompute per-year last place + the reg-season leader's key once, plus
  // each year's points-scored z-scores and Luck Index (both need the whole
  // year's rows, not just one manager's, so they're computed once per year
  // rather than recomputed per manager below).
  const lastPlaceByYear = new Map();
  const regLeaderKeyByYear = new Map();
  const zScoreByYear = new Map(); // year -> Map<managerKey, zscore>
  const luckByYear = new Map(); // year -> Map<managerKey, luckIndex>
  const bottomTwoByYear = new Map(); // year -> Set<finalStanding> ("Maid Bowl" standings)
  for (const { year, rows } of seasons) {
    lastPlaceByYear.set(year, rows.length ? lastPlaceStandingForYear(rows) : null);
    const leader = regSeasonLeaderForYear(rows);
    regLeaderKeyByYear.set(year, leader ? leader.managerKey : null);
    zScoreByYear.set(year, pointsScoredZScoresForYear(rows));
    luckByYear.set(year, luckIndexForYear(rows));
    bottomTwoByYear.set(year, rows.length ? bottomTwoStandingsForYear(rows) : new Set());
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

    // Personal single-season bests/worsts (career-table columns). Each is
    // null only if the manager has no year with the underlying stat
    // available (e.g. no year ever had a recorded Highest Single Week
    // Score). Ties are broken deterministically: for best/worst record,
    // by regular-season win count in the "more extreme" direction, then by
    // earliest year; for PPG and single-week, by earliest year.
    let bestRecord = null; // { year, regW, regL, regT, winPct }
    let worstRecord = null;
    let bestPPGSeason = null; // { year, ppg }
    let bestSingleWeek = null; // { year, value }
    let bestPAGame = null; // { year, value } - highest points-against/game
    let bestZScoreSeason = null; // { year, value }
    let worstZScoreSeason = null; // { year, value } - lowest single-season z-score
    let luckiestSeason = null; // { year, value } - max Luck Index
    let unluckiestSeason = null; // { year, value } - min Luck Index
    let zScoreSum = 0, zScoreCount = 0; // for career-average z-score
    let playoffSeasonCount = 0; // seasons finishing #1-4 ("made playoffs")
    let maidBowlAppearances = 0; // seasons finishing in the bottom two

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

      if (r.finalStanding <= 4) playoffSeasonCount += 1;
      const bottomTwo = bottomTwoByYear.get(r.year);
      if (bottomTwo && bottomTwo.has(r.finalStanding)) maidBowlAppearances += 1;

      const winPct = regSeasonWinPct(r);
      if (winPct !== null) {
        if (
          bestRecord === null ||
          winPct > bestRecord.winPct + EPS ||
          (Math.abs(winPct - bestRecord.winPct) < EPS &&
            (r.regW > bestRecord.regW || (r.regW === bestRecord.regW && r.year < bestRecord.year)))
        ) {
          bestRecord = { year: r.year, regW: r.regW, regL: r.regL, regT: r.regT, winPct };
        }
        if (
          worstRecord === null ||
          winPct < worstRecord.winPct - EPS ||
          (Math.abs(winPct - worstRecord.winPct) < EPS &&
            (r.regW < worstRecord.regW || (r.regW === worstRecord.regW && r.year < worstRecord.year)))
        ) {
          worstRecord = { year: r.year, regW: r.regW, regL: r.regL, regT: r.regT, winPct };
        }
      }

      const ppg = pointsPerGame(r);
      if (
        ppg !== null &&
        (bestPPGSeason === null ||
          ppg > bestPPGSeason.ppg + EPS ||
          (Math.abs(ppg - bestPPGSeason.ppg) < EPS && r.year < bestPPGSeason.year))
      ) {
        bestPPGSeason = { year: r.year, ppg };
      }

      if (
        r.highestWeek !== null &&
        (bestSingleWeek === null ||
          r.highestWeek > bestSingleWeek.value + EPS ||
          (Math.abs(r.highestWeek - bestSingleWeek.value) < EPS && r.year < bestSingleWeek.year))
      ) {
        bestSingleWeek = { year: r.year, value: r.highestWeek };
      }

      const paGame = pointsAgainstPerGame(r);
      if (
        paGame !== null &&
        (bestPAGame === null ||
          paGame > bestPAGame.value + EPS ||
          (Math.abs(paGame - bestPAGame.value) < EPS && r.year < bestPAGame.year))
      ) {
        bestPAGame = { year: r.year, value: paGame };
      }

      const zScore = zScoreByYear.get(r.year)?.get(managerKey);
      if (
        zScore !== undefined &&
        (bestZScoreSeason === null ||
          zScore > bestZScoreSeason.value + EPS ||
          (Math.abs(zScore - bestZScoreSeason.value) < EPS && r.year < bestZScoreSeason.year))
      ) {
        bestZScoreSeason = { year: r.year, value: zScore };
      }
      if (
        zScore !== undefined &&
        (worstZScoreSeason === null ||
          zScore < worstZScoreSeason.value - EPS ||
          (Math.abs(zScore - worstZScoreSeason.value) < EPS && r.year < worstZScoreSeason.year))
      ) {
        worstZScoreSeason = { year: r.year, value: zScore };
      }
      if (zScore !== undefined) {
        zScoreSum += zScore;
        zScoreCount += 1;
      }

      const luck = luckByYear.get(r.year)?.get(managerKey);
      if (
        luck !== undefined &&
        (luckiestSeason === null ||
          luck > luckiestSeason.value + EPS ||
          (Math.abs(luck - luckiestSeason.value) < EPS && r.year < luckiestSeason.year))
      ) {
        luckiestSeason = { year: r.year, value: luck };
      }
      if (
        luck !== undefined &&
        (unluckiestSeason === null ||
          luck < unluckiestSeason.value - EPS ||
          (Math.abs(luck - unluckiestSeason.value) < EPS && r.year < unluckiestSeason.year))
      ) {
        unluckiestSeason = { year: r.year, value: luck };
      }
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
      bestRecord,
      worstRecord,
      bestPPGSeason,
      bestSingleWeek,
      bestPAGame,
      bestZScoreSeason,
      worstZScoreSeason,
      avgZScore: zScoreCount > 0 ? zScoreSum / zScoreCount : null,
      luckiestSeason,
      unluckiestSeason,
      pctPlayoffSeasons: playoffSeasonCount / rows.length,
      maidBowlAppearances,
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

/** Same as tiedHolders but finds the minimum instead of the maximum. */
function tiedHoldersMin(entries, valueFn) {
  const negated = tiedHolders(entries, (e) => {
    const v = valueFn(e);
    return v === null || v === undefined ? null : -v;
  });
  return { value: negated.value === null ? null : -negated.value, holders: negated.holders };
}

export function computeRecordBook(seasons, careers) {
  const allRows = seasons.flatMap((s) => s.rows);

  const highestSingleWeek = tiedHolders(
    allRows.filter((r) => r.highestWeek !== null),
    (r) => r.highestWeek
  );

  const mostChampionships = tiedHolders(careers, (c) => c.championships);
  const mostRegSeasonWins = tiedHolders(careers, (c) => c.regW);
  const mostRegSeasonFirsts = tiedHolders(careers, (c) => c.regSeasonFirsts);
  const mostLastPlace = tiedHolders(careers, (c) => c.lastPlaceFinishes);

  const ppgRows = allRows
    .map((r) => ({ ...r, ppg: pointsPerGame(r) }))
    .filter((r) => r.ppg !== null);
  const bestSeasonPPG = tiedHolders(ppgRows, (r) => r.ppg);

  const paGameRows = allRows
    .map((r) => ({ manager: r.manager, year: r.year, value: pointsAgainstPerGame(r) }))
    .filter((r) => r.value !== null);
  const mostPAGame = tiedHolders(paGameRows, (r) => r.value);

  const winsRows = allRows.map((r) => ({ manager: r.manager, year: r.year, value: r.regW }));
  const mostWinsSeason = tiedHolders(winsRows, (r) => r.value);

  const lossesRows = allRows.map((r) => ({ manager: r.manager, year: r.year, value: r.regL }));
  const mostLossesSeason = tiedHolders(lossesRows, (r) => r.value);

  // Z-score and Luck Index both depend on a whole season's rows, not one
  // row in isolation, so they're built here per year (same computation
  // aggregateCareers does independently for its own per-manager bests).
  const zScoreRows = [];
  const luckRows = [];
  for (const { year, rows } of seasons) {
    const zScores = pointsScoredZScoresForYear(rows);
    const luck = luckIndexForYear(rows);
    for (const r of rows) {
      const z = zScores.get(r.managerKey);
      if (z !== undefined) zScoreRows.push({ manager: r.manager, year, value: z });
      const l = luck.get(r.managerKey);
      if (l !== undefined) luckRows.push({ manager: r.manager, year, value: l });
    }
  }
  const bestZScore = tiedHolders(zScoreRows, (r) => r.value);
  const worstZScore = tiedHoldersMin(zScoreRows, (r) => r.value);
  const luckiestSeasonEver = tiedHolders(luckRows, (r) => r.value);
  const unluckiestSeasonEver = tiedHoldersMin(luckRows, (r) => r.value);

  const mostCareerPoints = tiedHolders(careers, (c) => c.careerPointsScored);
  const highestPlayoffWinPct = tiedHolders(careers, (c) => c.playoffWinPct);
  const mostPlayoffWins = tiedHolders(careers, (c) => c.playoffW);
  const mostChampGameApp = tiedHolders(careers, (c) => c.championshipAppearances);
  const mostMaidBowl = tiedHolders(careers, (c) => c.maidBowlAppearances);

  const withYear = (r) => ({ manager: r.manager, year: r.year });
  const noYear = (c) => ({ manager: c.manager });

  return {
    highestSingleWeek: { value: highestSingleWeek.value, holders: highestSingleWeek.holders.map(withYear) },
    mostChampionships: { value: mostChampionships.value, holders: mostChampionships.holders.map(noYear) },
    mostRegSeasonWins: { value: mostRegSeasonWins.value, holders: mostRegSeasonWins.holders.map(noYear) },
    mostRegSeasonFirsts: { value: mostRegSeasonFirsts.value, holders: mostRegSeasonFirsts.holders.map(noYear) },
    mostLastPlace: { value: mostLastPlace.value, holders: mostLastPlace.holders.map(noYear) },
    bestSeasonPPG: { value: bestSeasonPPG.value, holders: bestSeasonPPG.holders.map(withYear) },

    mostPAGame: { value: mostPAGame.value, holders: mostPAGame.holders.map(withYear) },
    mostCareerPoints: { value: mostCareerPoints.value, holders: mostCareerPoints.holders.map(noYear) },
    mostWinsSeason: { value: mostWinsSeason.value, holders: mostWinsSeason.holders.map(withYear) },
    mostLossesSeason: { value: mostLossesSeason.value, holders: mostLossesSeason.holders.map(withYear) },
    highestPlayoffWinPct: { value: highestPlayoffWinPct.value, holders: highestPlayoffWinPct.holders.map(noYear) },
    mostPlayoffWins: { value: mostPlayoffWins.value, holders: mostPlayoffWins.holders.map(noYear) },
    mostChampGameApp: { value: mostChampGameApp.value, holders: mostChampGameApp.holders.map(noYear) },
    mostMaidBowl: { value: mostMaidBowl.value, holders: mostMaidBowl.holders.map(noYear) },
    luckiestSeasonEver: { value: luckiestSeasonEver.value, holders: luckiestSeasonEver.holders.map(withYear) },
    unluckiestSeasonEver: { value: unluckiestSeasonEver.value, holders: unluckiestSeasonEver.holders.map(withYear) },
    bestZScore: { value: bestZScore.value, holders: bestZScore.holders.map(withYear) },
    worstZScore: { value: worstZScore.value, holders: worstZScore.holders.map(withYear) },
  };
}

export function buildLeaderboard(seasons) {
  const careers = aggregateCareers(seasons);
  const recordBook = computeRecordBook(seasons, careers);
  return { careers, recordBook };
}
