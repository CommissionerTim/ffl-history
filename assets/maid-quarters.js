import { SHEET_ID, YEARS, PASSWORD_HASH, SITE_TITLE } from '../config.js';
import { MAID_QUARTERS } from '../photo-pages-data.js';
import { initPhotoPage } from './photo-page.js';
import { lastPlaceStandingForYear } from './calc.js';

document.title = SITE_TITLE + ' — Maid Quarters';
document.querySelector('#site-title').textContent = SITE_TITLE;

initPhotoPage({
  passwordHash: PASSWORD_HASH,
  sheetId: SHEET_ID,
  years: YEARS,
  entries: MAID_QUARTERS,
  selectRow: (yearRows) => {
    if (!yearRows.length) return null;
    const lastPlace = lastPlaceStandingForYear(yearRows);
    return yearRows.find((r) => r.finalStanding === lastPlace) ?? null;
  },
  photoDir: 'photos/maid-quarters',
  gridId: 'photo-grid',
  statusId: 'status',
  emptyMessage: 'No entries yet.',
  showTeamName: false,
}).catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading Maid Quarters: ' + err.message;
  console.error(err);
});
