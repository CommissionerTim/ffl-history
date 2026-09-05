import { SHEET_ID, YEARS, OTHER_RECORDS_TAB, PASSWORD_HASH, SITE_TITLE } from '../config.js';
import { requireAuth } from './auth.js';
import { loadAllSeasons, loadOtherRecords } from './data.js';
import { buildLeaderboard } from './calc.js';
import { makeInfoIcon } from './table.js';

document.title = SITE_TITLE + ' — All-Time Records';
document.querySelector('#site-title').textContent = SITE_TITLE;

const pct = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
const num = (v, digits = 0) => (v === null || v === undefined ? '—' : v.toFixed(digits));
const signedNum = (v, digits = 2) => {
  if (v === null || v === undefined) return '—';
  const rounded = Number(v.toFixed(digits));
  const s = Math.abs(rounded).toFixed(digits);
  return rounded > 0 ? '+' + s : rounded < 0 ? '-' + s : s;
};
const signedInt = (v) => (v === null || v === undefined ? '—' : v > 0 ? '+' + v : String(v));

async function main() {
  await requireAuth(PASSWORD_HASH);

  const status = document.getElementById('status');
  status.textContent = `Loading ${YEARS.length} seasons from the sheet…`;
  status.className = 'status-banner loading';
  status.hidden = false;

  const [{ seasons, errors }, otherRecords] = await Promise.all([
    loadAllSeasons(SHEET_ID, YEARS),
    loadOtherRecords(SHEET_ID, OTHER_RECORDS_TAB),
  ]);

  if (errors.length) {
    status.className = 'status-banner error';
    status.textContent =
      `Could not load ${errors.length} season(s), so totals below are incomplete: ` +
      errors.map((e) => `${e.year} (${e.message})`).join('; ');
  } else {
    status.hidden = true;
  }

  // The "Other Records" tab is optional and hand-maintained (see config.js) —
  // if it doesn't exist yet, or a fetch hiccup happens, that's not worth a
  // scary banner on top of the real computed stats. Just skip the extra
  // cards and leave a trail in the console for debugging.
  if (otherRecords.error) {
    console.error('Other Records tab:', otherRecords.error);
  }

  const grid = document.getElementById('record-grid');
  grid.innerHTML = '';
  const { recordBook } = buildLeaderboard(seasons);
  appendRecordCards(grid, computedRecordCards(recordBook));
  appendRecordCards(grid, otherRecordCards(otherRecords.records));
}

function computedRecordCards(rb) {
  const holdersText = (holders, withYear) =>
    holders
      .map((h) => (withYear ? `${h.manager} (${h.year})` : h.manager))
      .join(', ');

  return [
    {
      label: 'Most championships',
      value: rb.mostChampionships.value ?? '—',
      holders: holdersText(rb.mostChampionships.holders, false),
    },
    {
      label: 'Most Regular Season Wins',
      value: rb.mostRegSeasonWins.value ?? '—',
      holders: holdersText(rb.mostRegSeasonWins.holders, false),
    },
    {
      label: 'Most #1 regular-season finishes',
      value: rb.mostRegSeasonFirsts.value ?? '—',
      holders: holdersText(rb.mostRegSeasonFirsts.holders, false),
    },
    {
      label: 'Most last-place finishes',
      value: rb.mostLastPlace.value ?? '—',
      holders: holdersText(rb.mostLastPlace.holders, false),
    },
    {
      label: 'Highest single-week score ever',
      value: rb.highestSingleWeek.value !== null ? rb.highestSingleWeek.value.toFixed(2) : '—',
      holders: holdersText(rb.highestSingleWeek.holders, true),
    },
    {
      label: 'Best single-season points/game',
      value: rb.bestSeasonPPG.value !== null ? rb.bestSeasonPPG.value.toFixed(2) : '—',
      holders: holdersText(rb.bestSeasonPPG.holders, true),
    },
    {
      label: 'Most single-season points against/game',
      value: rb.mostPAGame.value !== null ? rb.mostPAGame.value.toFixed(2) : '—',
      holders: holdersText(rb.mostPAGame.holders, true),
    },
    {
      label: 'Most career points',
      value: rb.mostCareerPoints.value !== null ? num(rb.mostCareerPoints.value, 2) : '—',
      holders: holdersText(rb.mostCareerPoints.holders, false),
    },
    {
      label: 'Most wins in a single season',
      value: rb.mostWinsSeason.value ?? '—',
      holders: holdersText(rb.mostWinsSeason.holders, true),
    },
    {
      label: 'Most losses in a single season',
      value: rb.mostLossesSeason.value ?? '—',
      holders: holdersText(rb.mostLossesSeason.holders, true),
    },
    {
      label: 'Highest career playoff win%',
      value: pct(rb.highestPlayoffWinPct.value),
      holders: holdersText(rb.highestPlayoffWinPct.holders, false),
    },
    {
      label: 'Most career playoff wins',
      value: rb.mostPlayoffWins.value ?? '—',
      holders: holdersText(rb.mostPlayoffWins.holders, false),
    },
    {
      label: 'Most championship game appearances',
      value: rb.mostChampGameApp.value ?? '—',
      holders: holdersText(rb.mostChampGameApp.holders, false),
    },
    {
      label: 'Most Maid Bowl appearances',
      value: rb.mostMaidBowl.value ?? '—',
      holders: holdersText(rb.mostMaidBowl.holders, false),
    },
    {
      label: 'Luckiest season ever',
      value: signedInt(rb.luckiestSeasonEver.value),
      holders: holdersText(rb.luckiestSeasonEver.holders, true),
      tooltip: "Luck Index = that season's Points-Scored Rank minus Final Standing. Positive = finished better than their scoring alone would predict (lucky). This is the single luckiest season anyone has ever had.",
    },
    {
      label: 'Unluckiest season ever',
      value: signedInt(rb.unluckiestSeasonEver.value),
      holders: holdersText(rb.unluckiestSeasonEver.holders, true),
      tooltip: "Luck Index = that season's Points-Scored Rank minus Final Standing. Negative = finished worse than their scoring alone would predict (unlucky). This is the single unluckiest season anyone has ever had.",
    },
    {
      label: 'Best single-season Z-score',
      value: signedNum(rb.bestZScore.value, 2),
      holders: holdersText(rb.bestZScore.holders, true),
      tooltip: "The single highest Z-score anyone has ever posted in a season — how many standard deviations above that season's league-average points scored they were.",
    },
    {
      label: 'Worst single-season Z-score',
      value: signedNum(rb.worstZScore.value, 2),
      holders: holdersText(rb.worstZScore.holders, true),
      tooltip: "The single lowest Z-score anyone has ever posted in a season — how many standard deviations below that season's league-average points scored they were.",
    },
    {
      label: 'Most Chat Ragequits',
      value: rb.mostCareerRagequits.value ?? '—',
      holders: holdersText(rb.mostCareerRagequits.holders, false),
    },
    {
      label: 'Most Chat Ragequits, Single Season',
      value: rb.mostRagequitsSeason.value ?? '—',
      holders: holdersText(rb.mostRagequitsSeason.holders, true),
    },
  ];
}

// Freeform, hand-entered records from the sheet's "Other Records" tab (e.g.
// "Most drinks consumed at the draft — 3 — Tim"). These aren't computed —
// they're typed directly into the sheet — so this just maps each row's
// three columns onto the same {label, value, holders} card shape the
// computed record-book cards use, rendered identically below.
function otherRecordCards(records) {
  return records.map((r) => ({ label: r.label, value: r.value, holders: r.holders }));
}

function appendRecordCards(grid, cards) {
  for (const c of cards) {
    const div = document.createElement('div');
    div.className = 'record-card';

    const label = document.createElement('div');
    label.className = 'label';
    label.appendChild(document.createTextNode(c.label));
    if (c.tooltip) label.appendChild(makeInfoIcon(c.tooltip));

    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = c.value || '—';

    const holders = document.createElement('div');
    holders.className = 'holders';
    holders.textContent = c.holders || '—';

    div.append(label, value, holders);
    grid.appendChild(div);
  }
}

main().catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading the leaderboard: ' + err.message;
  console.error(err);
});
