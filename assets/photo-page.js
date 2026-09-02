// photo-page.js — shared controller for the Hall of Fame and Maid Quarters
// pages. Both are the same shape: a grid of year -> photo + team name, with
// the manager's name looked up live from the Sheet rather than typed by
// hand (see photo-pages-data.js).

import { requireAuth } from './auth.js';
import { loadAllSeasons } from './data.js';

/**
 * @param {object} opts
 * @param {string} opts.passwordHash
 * @param {string} opts.sheetId
 * @param {number[]} opts.years - full YEARS list, so we can fetch every season once
 * @param {Array<{year:number, teamName:string, photo:string}>} opts.entries
 * @param {(yearRows: Array) => object|null} opts.selectRow - picks the row (champion / last place) for a year
 * @param {string} opts.photoDir - e.g. 'photos/hall-of-fame'
 * @param {string} opts.gridId
 * @param {string} opts.statusId
 * @param {string} opts.emptyMessage - shown when `entries` is empty
 */
export async function initPhotoPage(opts) {
  await requireAuth(opts.passwordHash);

  const status = document.getElementById(opts.statusId);
  status.textContent = `Loading ${opts.years.length} seasons from the sheet…`;
  status.className = 'status-banner loading';
  status.hidden = false;

  const { seasons, errors } = await loadAllSeasons(opts.sheetId, opts.years);
  const seasonsByYear = new Map(seasons.map((s) => [s.year, s.rows]));

  if (errors.length) {
    status.className = 'status-banner error';
    status.textContent =
      `Could not load ${errors.length} season(s), so some names below may be missing: ` +
      errors.map((e) => `${e.year} (${e.message})`).join('; ');
  } else {
    status.hidden = true;
  }

  const grid = document.getElementById(opts.gridId);
  grid.innerHTML = '';

  const sortedEntries = [...opts.entries].sort((a, b) => b.year - a.year);

  if (sortedEntries.length === 0) {
    const p = document.createElement('p');
    p.className = 'photo-empty';
    p.textContent = opts.emptyMessage || 'Nothing here yet.';
    grid.appendChild(p);
    return;
  }

  for (const entry of sortedEntries) {
    const rows = seasonsByYear.get(entry.year);
    const row = rows ? opts.selectRow(rows) : null;
    grid.appendChild(buildCard(entry, row, opts.photoDir));
  }
}

function buildCard(entry, row, photoDir) {
  const managerName = row ? row.manager : null;

  const card = document.createElement('div');
  card.className = 'photo-card';

  const frame = document.createElement('div');
  frame.className = 'photo-frame';

  const img = document.createElement('img');
  img.src = `${photoDir}/${entry.photo}`;
  img.alt = managerName ? `${managerName} — ${entry.year}` : `${entry.year}`;
  img.loading = 'lazy';

  const fallback = document.createElement('div');
  fallback.className = 'photo-fallback';
  fallback.textContent = 'Photo coming soon';

  img.addEventListener('error', () => {
    card.classList.add('photo-missing');
  });

  frame.appendChild(img);
  frame.appendChild(fallback);
  card.appendChild(frame);

  const caption = document.createElement('div');
  caption.className = 'photo-caption';

  const yearEl = document.createElement('div');
  yearEl.className = 'photo-year';
  yearEl.textContent = String(entry.year);

  const managerEl = document.createElement('div');
  managerEl.className = 'photo-manager';
  managerEl.textContent = managerName || '—';

  const teamEl = document.createElement('div');
  teamEl.className = 'photo-team';
  teamEl.textContent = entry.teamName || '';

  caption.appendChild(yearEl);
  caption.appendChild(managerEl);
  caption.appendChild(teamEl);
  card.appendChild(caption);

  return card;
}
