import { SHEET_ID, YEARS, PASSWORD_HASH, SITE_TITLE } from '../config.js';
import { requireAuth } from './auth.js';
import { loadAllSeasons } from './data.js';
import { buildLeaderboard } from './calc.js';
import { renderSortableTable } from './table.js';

document.title = SITE_TITLE + ' — All-Time Records';
document.querySelector('#site-title').textContent = SITE_TITLE;

const pct = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
const num = (v, digits = 0) => (v === null || v === undefined ? '—' : v.toFixed(digits));

async function main() {
  await requireAuth(PASSWORD_HASH);

  const status = document.getElementById('status');
  status.textContent = `Loading ${YEARS.length} seasons from the sheet…`;
  status.className = 'status-banner loading';
  status.hidden = false;

  const { seasons, errors } = await loadAllSeasons(SHEET_ID, YEARS);

  if (errors.length) {
    status.className = 'status-banner error';
    status.textContent =
      `Could not load ${errors.length} season(s), so totals below are incomplete: ` +
      errors.map((e) => `${e.year} (${e.message})`).join('; ');
  } else {
    status.hidden = true;
  }

  const { careers, recordBook } = buildLeaderboard(seasons);
  renderRecordBook(recordBook);
  renderCareerTable(careers);
}

function renderRecordBook(rb) {
  const grid = document.getElementById('record-grid');
  const holdersText = (holders, withYear) =>
    holders
      .map((h) => (withYear ? `${h.manager} (${h.year})` : h.manager))
      .join(', ');

  const cards = [
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
  ];

  grid.innerHTML = '';
  for (const c of cards) {
    const div = document.createElement('div');
    div.className = 'record-card';
    div.innerHTML = `
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="holders">${c.holders || '—'}</div>
    `;
    grid.appendChild(div);
  }
}

function renderCareerTable(careers) {
  const table = document.getElementById('career-table');
  const columns = [
    { key: 'manager', label: 'Manager', get: (r) => r.manager, format: (r) => r.manager },
    {
      key: 'seasonsPlayed', label: 'Seasons', numeric: true,
      get: (r) => r.seasonsPlayed, format: (r) => String(r.seasonsPlayed),
    },
    {
      key: 'regW', label: 'Reg W', numeric: true,
      get: (r) => r.regW, format: (r) => num(r.regW),
    },
    {
      key: 'regL', label: 'Reg L', numeric: true,
      get: (r) => r.regL, format: (r) => num(r.regL),
    },
    {
      key: 'regT', label: 'Reg T', numeric: true,
      get: (r) => r.regT, format: (r) => num(r.regT),
    },
    {
      key: 'regWinPct', label: 'Reg Win%', numeric: true,
      get: (r) => r.regWinPct, format: (r) => pct(r.regWinPct),
    },
    {
      key: 'playoffW', label: 'Playoff W', numeric: true,
      get: (r) => r.playoffW, format: (r) => num(r.playoffW),
    },
    {
      key: 'playoffL', label: 'Playoff L', numeric: true,
      get: (r) => r.playoffL, format: (r) => num(r.playoffL),
    },
    {
      key: 'playoffWinPct', label: 'Playoff Win%', numeric: true,
      get: (r) => r.playoffWinPct, format: (r) => pct(r.playoffWinPct),
    },
    {
      key: 'careerPointsScored', label: 'Career Points (Reg)', numeric: true,
      get: (r) => r.careerPointsScored, format: (r) => num(r.careerPointsScored, 2),
    },
    {
      key: 'championships', label: 'Championships', numeric: true,
      get: (r) => r.championships, format: (r) => String(r.championships),
    },
    {
      key: 'championshipAppearances', label: 'Champ. Game App.', numeric: true,
      get: (r) => r.championshipAppearances, format: (r) => String(r.championshipAppearances),
    },
    {
      key: 'lastPlaceFinishes', label: 'Last-Place Finishes', numeric: true,
      get: (r) => r.lastPlaceFinishes, format: (r) => String(r.lastPlaceFinishes),
    },
    {
      key: 'avgFinalStanding', label: 'Avg Final Standing', numeric: true,
      get: (r) => r.avgFinalStanding, format: (r) => num(r.avgFinalStanding, 2),
    },
    {
      key: 'avgMoves', label: 'Avg Moves/Season', numeric: true,
      get: (r) => r.avgMoves, format: (r) => num(r.avgMoves, 1),
    },
  ];
  renderSortableTable(table, careers, columns, 'manager', { key: 'regW', dir: -1 });
}

main().catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading the leaderboard: ' + err.message;
  console.error(err);
});
