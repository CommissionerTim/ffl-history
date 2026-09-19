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
 * @param {boolean} [opts.showTeamName] - defaults to true; set false to omit the team-name line (e.g. Maid Quarters)
 * @param {Map<number, Array<{position:string, player:string}>>} [opts.lineups] - year -> championship starting lineup (Hall of Fame only; see calc.js's parseHallOfFameLineups). A year missing from this map (or omitted entirely) just gets no expandable section — never an empty/broken one.
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

  const showTeamName = opts.showTeamName !== false;

  for (const entry of sortedEntries) {
    const rows = seasonsByYear.get(entry.year);
    const row = rows ? opts.selectRow(rows) : null;
    const lineup = opts.lineups?.get(entry.year);
    grid.appendChild(buildCard(entry, row, opts.photoDir, showTeamName, lineup));
  }
}

function buildCard(entry, row, photoDir, showTeamName, lineup) {
  const managerName = row ? row.manager : null;

  const card = document.createElement('div');
  card.className = 'photo-card';

  const frame = document.createElement('div');
  frame.className = 'photo-frame';

  const img = document.createElement('img');
  img.src = `${photoDir}/${encodeURIComponent(entry.photo)}`;
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

  // Primary line: manager name left, year as a pill right (same row). The
  // year always sits here regardless of whether a team name is shown.
  // `.photo-year` keeps plain year text (e.g. "2025") — its pill styling is
  // all CSS, nothing decorative baked into the text itself.
  const managerEl = document.createElement('span');
  managerEl.className = 'photo-manager';
  managerEl.textContent = managerName || '—';

  const yearEl = document.createElement('span');
  yearEl.className = 'photo-year';
  yearEl.textContent = String(entry.year);

  const primary = document.createElement('div');
  primary.className = 'photo-primary';
  primary.appendChild(managerEl);
  primary.appendChild(yearEl);
  caption.appendChild(primary);

  // Secondary line (Hall of Fame only — Maid Quarters has no team names):
  // the team name, quoted. `.photo-team` keeps plain team-name text; the
  // quote marks around it are decorative, added in CSS.
  if (showTeamName && entry.teamName) {
    const teamEl = document.createElement('div');
    teamEl.className = 'photo-team';
    teamEl.textContent = entry.teamName;
    caption.appendChild(teamEl);
  }

  if (lineup && lineup.length) {
    caption.appendChild(buildLineupSection(lineup));
  }

  card.appendChild(caption);

  return card;
}

/**
 * The expandable "Starting Lineup" section on a Hall of Fame card: a
 * toggle button, and a panel (hidden until expanded) listing each roster
 * slot as a small position pill (no colon — see calc.js's
 * parseHallOfFameLineups, which already strips it) next to the player name.
 * @param {Array<{position:string, player:string}>} lineup
 */
function buildLineupSection(lineup) {
  const wrap = document.createElement('div');
  wrap.className = 'lineup-section';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'lineup-toggle';
  toggle.setAttribute('aria-expanded', 'false');

  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = 'Starting Lineup';
  const chevron = document.createElement('span');
  chevron.className = 'lineup-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';
  toggle.append(toggleLabel, chevron);

  const panel = document.createElement('div');
  panel.className = 'lineup-panel';
  panel.hidden = true;

  for (const { position, player } of lineup) {
    const slot = document.createElement('div');
    slot.className = 'lineup-slot';

    const posEl = document.createElement('span');
    posEl.className = 'lineup-pos';
    posEl.textContent = position || '—';

    const playerEl = document.createElement('span');
    const isEmpty = !player || /^\[?empty\]?$/i.test(player);
    playerEl.className = isEmpty ? 'lineup-player lineup-player-empty' : 'lineup-player';
    playerEl.textContent = isEmpty ? 'Empty' : player;

    slot.append(posEl, playerEl);
    panel.appendChild(slot);
  }

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
  });

  wrap.append(toggle, panel);
  return wrap;
}
