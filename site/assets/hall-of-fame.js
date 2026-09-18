import { SHEET_ID, YEARS, PASSWORD_HASH, SITE_TITLE, HALL_OF_FAME_LINEUPS_TAB } from '../config.js';
import { HALL_OF_FAME } from '../photo-pages-data.js';
import { initPhotoPage } from './photo-page.js';
import { loadHallOfFameLineups } from './data.js';

document.title = SITE_TITLE + ' — Hall of Fame';
document.querySelector('#site-title').textContent = SITE_TITLE;

// The lineup tab is optional and hand-maintained (see config.js) — fetched
// alongside everything initPhotoPage itself loads, and its own fetch
// failure is only logged, never surfaced as a page-breaking error: a
// missing/renamed tab just means no card gets an expandable lineup this
// load, not a broken Hall of Fame page.
const lineupsPromise = loadHallOfFameLineups(SHEET_ID, HALL_OF_FAME_LINEUPS_TAB).then(({ lineups, error }) => {
  if (error) console.error('Hall of Fame lineups tab:', error);
  return lineups;
});

const lineups = await lineupsPromise;

initPhotoPage({
  passwordHash: PASSWORD_HASH,
  sheetId: SHEET_ID,
  years: YEARS,
  entries: HALL_OF_FAME,
  selectRow: (yearRows) => yearRows.find((r) => r.finalStanding === 1) ?? null,
  photoDir: 'photos/hall-of-fame',
  gridId: 'photo-grid',
  statusId: 'status',
  emptyMessage: 'No champions on record yet.',
  lineups,
}).catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading the Hall of Fame: ' + err.message;
  console.error(err);
});
