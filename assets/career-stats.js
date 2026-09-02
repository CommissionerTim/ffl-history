import { SHEET_ID, YEARS, PASSWORD_HASH, SITE_TITLE } from '../config.js';
import { requireAuth } from './auth.js';
import { loadAllSeasons } from './data.js';
import { aggregateCareers } from './calc.js';
import { renderSortableTable } from './table.js';

document.title = SITE_TITLE + ' — Career Stats';
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

  const { seasons, errors } = await loadAllSeasons(SHEET_ID, YEARS);

  if (errors.length) {
    status.className = 'status-banner error';
    status.textContent =
      `Could not load ${errors.length} season(s), so totals below are incomplete: ` +
      errors.map((e) => `${e.year} (${e.message})`).join('; ');
  } else {
    status.hidden = true;
  }

  const careers = aggregateCareers(seasons);
  renderCareerTable(careers);
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
      key: 'pctPlayoffSeasons', label: '% of Playoff Seasons', numeric: true,
      get: (r) => r.pctPlayoffSeasons, format: (r) => pct(r.pctPlayoffSeasons),
      tooltip: 'The percentage of this manager\'s seasons in which they made the playoffs — i.e. finished #1-4 in the final standings.',
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
    {
      key: 'bestRecord', label: 'Best Single-Season Record', numeric: true,
      get: (r) => r.bestRecord ? r.bestRecord.winPct : null,
      format: (r) => r.bestRecord
        ? `${num(r.bestRecord.regW)}-${num(r.bestRecord.regL)}-${num(r.bestRecord.regT)} (${r.bestRecord.year})`
        : '—',
    },
    {
      key: 'worstRecord', label: 'Worst Single-Season Record', numeric: true,
      get: (r) => r.worstRecord ? r.worstRecord.winPct : null,
      format: (r) => r.worstRecord
        ? `${num(r.worstRecord.regW)}-${num(r.worstRecord.regL)}-${num(r.worstRecord.regT)} (${r.worstRecord.year})`
        : '—',
    },
    {
      key: 'bestPPGSeason', label: 'Highest Scoring Season', numeric: true,
      get: (r) => r.bestPPGSeason ? r.bestPPGSeason.ppg : null,
      format: (r) => r.bestPPGSeason ? `${num(r.bestPPGSeason.ppg, 2)} (${r.bestPPGSeason.year})` : '—',
    },
    {
      key: 'bestSingleWeek', label: 'Highest Single-Week Score', numeric: true,
      get: (r) => r.bestSingleWeek ? r.bestSingleWeek.value : null,
      format: (r) => r.bestSingleWeek ? `${num(r.bestSingleWeek.value, 2)} (${r.bestSingleWeek.year})` : '—',
    },
    {
      key: 'bestPAGame', label: 'Highest Points-Against/Game (Season)', numeric: true,
      get: (r) => r.bestPAGame ? r.bestPAGame.value : null,
      format: (r) => r.bestPAGame ? `${num(r.bestPAGame.value, 2)} (${r.bestPAGame.year})` : '—',
    },
    {
      key: 'bestZScoreSeason', label: 'Highest Single-Season Z-Score', numeric: true,
      get: (r) => r.bestZScoreSeason ? r.bestZScoreSeason.value : null,
      format: (r) => r.bestZScoreSeason ? `${signedNum(r.bestZScoreSeason.value, 2)} (${r.bestZScoreSeason.year})` : '—',
      tooltip: "The manager's highest single-season Z-score — how many standard deviations above that season's league-average points scored they were.",
    },
    {
      key: 'worstZScoreSeason', label: 'Lowest Single-Season Z-Score', numeric: true,
      get: (r) => r.worstZScoreSeason ? r.worstZScoreSeason.value : null,
      format: (r) => r.worstZScoreSeason ? `${signedNum(r.worstZScoreSeason.value, 2)} (${r.worstZScoreSeason.year})` : '—',
      tooltip: "The manager's lowest single-season Z-score — how many standard deviations below that season's league-average points scored they were.",
    },
    {
      key: 'avgZScore', label: 'All-Time Average Z-Score', numeric: true,
      get: (r) => r.avgZScore, format: (r) => signedNum(r.avgZScore, 2),
      tooltip: "The average of this manager's single-season Z-scores across every season they've played — a career-long view of how they've scored relative to the league average each year.",
    },
    {
      key: 'luckiestSeason', label: 'Luckiest Season', numeric: true,
      get: (r) => r.luckiestSeason ? r.luckiestSeason.value : null,
      format: (r) => r.luckiestSeason ? `${signedInt(r.luckiestSeason.value)} (${r.luckiestSeason.year})` : '—',
      tooltip: "Luck Index = that season's Points-Scored Rank minus Final Standing. Positive = finished better than their scoring alone would predict (lucky). This shows the manager's single luckiest season.",
    },
    {
      key: 'unluckiestSeason', label: 'Unluckiest Season', numeric: true,
      get: (r) => r.unluckiestSeason ? r.unluckiestSeason.value : null,
      format: (r) => r.unluckiestSeason ? `${signedInt(r.unluckiestSeason.value)} (${r.unluckiestSeason.year})` : '—',
      tooltip: "Luck Index = that season's Points-Scored Rank minus Final Standing. Negative = finished worse than their scoring alone would predict (unlucky). This shows the manager's single unluckiest season.",
    },
  ];
  renderSortableTable(table, careers, columns, 'manager', { key: 'regW', dir: -1 });
}

main().catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading career stats: ' + err.message;
  console.error(err);
});
