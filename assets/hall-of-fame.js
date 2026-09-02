import { SHEET_ID, YEARS, PASSWORD_HASH, SITE_TITLE } from '../config.js';
import { HALL_OF_FAME } from '../photo-pages-data.js';
import { initPhotoPage } from './photo-page.js';

document.title = SITE_TITLE + ' — Hall of Fame';
document.querySelector('#site-title').textContent = SITE_TITLE;

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
}).catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading the Hall of Fame: ' + err.message;
  console.error(err);
});
