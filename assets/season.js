import { SHEET_ID, YEARS, PASSWORD_HASH, SITE_TITLE } from '../config.js';
import { requireAuth } from './auth.js';
import { loadAllSeasons } from './data.js';
import { regSeasonWinPct, playoffWinPct, pointsPerGame } from './calc.js';
import { renderSortableTable } from './table.js';

document.title = SITE_TITLE + ' — Season Stats';
document.querySelector('#site-title').textContent = SITE_TITLE;

const pct = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%');
const num = (v, digits = 0) => (v === null || v === undefined ? '—' : v.toFixed(digits));

let seasonsByYear = new Map();

async function main() {
  await requireAuth(PASSWORD_HASH);

  const status = document.getElementById('status');
  status.textContent = `Loading ${YEARS.length} seasons from the sheet…`;
  status.className = 'status-banner loading';
  status.hidden = false;

  const { seasons, errors } = await loadAllSeasons(SHEET_ID, YEARS);
  seasonsByYear = new Map(seasons.map((s) => [s.year, s]));

  const select = document.getElementById('year-select');
  select.innerHTML = '';
  for (const year of [...YEARS].sort((a, b) => b - a)) {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    if (!seasonsByYear.has(year)) opt.disabled = true;
    select.appendChild(opt);
  }

  if (errors.length) {
    status.className = 'status-banner error';
    status.textContent =
      `Could not load ${errors.length} season(s): ` +
      errors.map((e) => `${e.year} (${e.message})`).join('; ');
  } else {
    status.hidden = true;
  }

  select.addEventListener('change', () => renderYear(Number(select.value)));

  const firstAvailable = [...YEARS].sort((a, b) => b - a).find((y) => seasonsByYear.has(y));
  if (firstAvailable) {
    select.value = String(firstAvailable);
    renderYear(firstAvailable);
  }
}

function renderYear(year) {
  const season = seasonsByYear.get(year);
  const table = document.getElementById('season-table');
  if (!season) {
    table.innerHTML = '<tbody><tr><td>No data loaded for this year.</td></tr></tbody>';
    return;
  }

  const rows = season.rows.map((r) => ({
    ...r,
    regWinPct: regSeasonWinPct(r),
    playoffWinPct: playoffWinPct(r),
    ppg: pointsPerGame(r),
  }));

  const columns = [
    { key: 'manager', label: 'Manager', get: (r) => r.manager, format: (r) => r.manager },
    { key: 'finalStanding', label: 'Final Standing', numeric: true, get: (r) => r.finalStanding, format: (r) => String(r.finalStanding) },
    {
      key: 'regRecord', label: 'Reg W-L-T', numeric: true,
      get: (r) => r.regWinPct, format: (r) => `${num(r.regW)}-${num(r.regL)}-${num(r.regT)}`,
    },
    { key: 'regWinPct', label: 'Reg Win%', numeric: true, get: (r) => r.regWinPct, format: (r) => pct(r.regWinPct) },
    {
      key: 'playoffRecord', label: 'Playoff W-L', numeric: true,
      get: (r) => r.playoffWinPct, format: (r) => `${num(r.playoffW)}-${num(r.playoffL)}`,
    },
    { key: 'playoffWinPct', label: 'Playoff Win%', numeric: true, get: (r) => r.playoffWinPct, format: (r) => pct(r.playoffWinPct) },
    { key: 'pointsScored', label: 'Points Scored', numeric: true, get: (r) => r.pointsScored, format: (r) => num(r.pointsScored, 2) },
    { key: 'pointsAgainst', label: 'Points Against', numeric: true, get: (r) => r.pointsAgainst, format: (r) => num(r.pointsAgainst, 2) },
    { key: 'ppg', label: 'Points/Game', numeric: true, get: (r) => r.ppg, format: (r) => num(r.ppg, 2) },
    { key: 'highestWeek', label: 'Highest Single Week', numeric: true, get: (r) => r.highestWeek, format: (r) => num(r.highestWeek, 2) },
    { key: 'moves', label: 'Moves', numeric: true, get: (r) => r.moves, format: (r) => String(r.moves) },
  ];

  renderSortableTable(table, rows, columns, 'manager', { key: 'finalStanding', dir: 1 });
}

main().catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading the season explorer: ' + err.message;
  console.error(err);
});
