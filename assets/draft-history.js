import { SHEET_ID, DRAFT_HISTORY_TAB, PASSWORD_HASH, SITE_TITLE } from '../config.js';
import { requireAuth } from './auth.js';
import { loadDraftHistory } from './data.js';

document.title = SITE_TITLE + ' — Draft History';
document.querySelector('#site-title').textContent = SITE_TITLE;

async function main() {
  await requireAuth(PASSWORD_HASH);

  const entries = await loadDraftHistory(SHEET_ID, DRAFT_HISTORY_TAB);

  // Newest first, matching Hall of Fame / Maid Quarters. A blank "Year"
  // (a draft that predates organized year-by-year records) sorts to the
  // very end rather than 0 or "now" — it's the oldest entry, not undated.
  const sorted = [...entries].sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));

  const list = document.getElementById('draft-history-list');
  list.innerHTML = '';

  if (sorted.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'draft-history-empty';
    empty.textContent = 'No draft history on record yet.';
    list.appendChild(empty);
    return;
  }

  for (const entry of sorted) {
    const card = document.createElement('article');
    card.className = 'draft-history-entry';

    const heading = document.createElement('h3');
    heading.className = 'draft-history-heading';
    const yearText = entry.year !== null ? String(entry.year) : 'Before 2015';
    heading.appendChild(document.createTextNode(yearText));
    if (entry.location) {
      const loc = document.createElement('span');
      loc.className = 'draft-history-location';
      loc.textContent = entry.location;
      heading.appendChild(loc);
    }
    card.appendChild(heading);

    const recap = document.createElement('p');
    recap.className = 'draft-history-recap';
    recap.textContent = entry.recap;
    card.appendChild(recap);

    list.appendChild(card);
  }
}

main().catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading draft history: ' + err.message;
  console.error(err);
});
