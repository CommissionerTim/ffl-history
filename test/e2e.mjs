// End-to-end test: serves the real site files, mocks the Google Sheets
// fetch with the real fixture CSVs (same content the live sheet has), and
// exercises the password gate + both pages in an actual browser.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.join(__dirname, '../site');
const fixturesDir = path.join(__dirname, 'fixtures');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const filePath = path.join(siteDir, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const baseUrl = `http://localhost:${port}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();

let failed = false;
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); failed = true; }
  else console.log('ok:', msg);
};

// This sandbox's network policy blocks cdnjs.cloudflare.com outbound, so
// for the test only, serve the same PapaParse build from the local npm
// package instead. The real deployed site still loads it from cdnjs.
await page.route('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/**', async (route) => {
  const local = fs.readFileSync(path.join(__dirname, 'node_modules/papaparse/papaparse.min.js'));
  await route.fulfill({ status: 200, contentType: 'text/javascript', body: local });
});

// Mock the Google Sheets gviz CSV endpoint with our real fixture data.
await page.route('https://docs.google.com/spreadsheets/**', async (route) => {
  const url = new URL(route.request().url());
  const year = url.searchParams.get('sheet');
  const fixturePath = path.join(fixturesDir, `${year}.csv`);
  if (fs.existsSync(fixturePath)) {
    await route.fulfill({ status: 200, contentType: 'text/csv', body: fs.readFileSync(fixturePath) });
  } else {
    await route.fulfill({ status: 404, body: 'no fixture' });
  }
});

// Mock the Google Doc export endpoint rules.js fetches with a real, saved
// copy of the actual live doc's export?format=html output (test/fixtures/
// rules-doc.html), so the parser in rules.js gets exercised against real
// content, not a hand-written stand-in.
await page.route('https://docs.google.com/document/**/export**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: fs.readFileSync(path.join(fixturesDir, 'rules-doc.html')),
  });
});

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[browser console error]', msg.text());
});
page.on('pageerror', (err) => console.log('[browser page error]', err.message));

// ---- index.html: password gate ----
await page.goto(`${baseUrl}/index.html`);
await page.waitForSelector('.auth-box');
assert(true, 'password overlay appears on index.html');

await page.fill('.auth-box input[type=password]', 'wrongpassword');
await page.click('.auth-box button');
await page.waitForSelector('.auth-error:not([hidden])');
assert(true, 'wrong password shows an error and does not unlock');

await page.fill('.auth-box input[type=password]', 'corrupt');
await page.click('.auth-box button');
await page.waitForSelector('.auth-box', { state: 'detached' });
assert(true, 'correct password removes the gate');

// ---- index.html is now the Hall of Fame page (site homepage) ----
assert((await page.title()).includes('Hall of Fame'), 'index.html title includes "Hall of Fame"');
const homeNavText = await page.$$eval('nav.site-nav a', (as) => as.map((a) => a.textContent));
assert(
  homeNavText.join('|') ===
    ['Hall of Fame', 'Career Stats', 'Season Stats', 'All-Time Records', 'League Rules', 'Draft History', 'Maid Quarters'].join('|'),
  `nav is in the requested order (got ${homeNavText.join(', ')})`
);
const homeAriaCurrent = await page.$eval('nav.site-nav a[aria-current="page"]', (a) => a.textContent);
assert(homeAriaCurrent === 'Hall of Fame', `"Hall of Fame" nav link is marked aria-current on index.html (got ${homeAriaCurrent})`);

await page.waitForSelector('.photo-card');
const hofCards = await page.$$eval('.photo-card', (cards) =>
  cards.map((c) => ({
    year: c.querySelector('.photo-year')?.textContent,
    manager: c.querySelector('.photo-manager')?.textContent,
    team: c.querySelector('.photo-team')?.textContent,
    missing: c.classList.contains('photo-missing'),
  }))
);
console.log('Hall of Fame cards:', hofCards);
assert(hofCards.length === 11, `Hall of Fame shows all 11 years (got ${hofCards.length})`);
assert(hofCards[0].year === '2025' && hofCards[0].manager === 'Tim', `2025 champion is Tim (got ${hofCards[0]?.manager})`);
assert(
  hofCards.find((c) => c.year === '2015')?.manager === 'Marisa',
  `2015 champion is Marisa (got ${hofCards.find((c) => c.year === '2015')?.manager})`
);
assert(
  hofCards.find((c) => c.year === '2016')?.manager === 'Ethan',
  `2016 champion is Ethan (got ${hofCards.find((c) => c.year === '2016')?.manager})`
);
// Team names come from photo-pages-data.js (parsed from each photo's filename), shown alongside the manager.
assert(hofCards[0].team === 'maidbait', `2025 team name is "maidbait" (got ${hofCards[0].team})`);
assert(
  hofCards.find((c) => c.year === '2015')?.team === 'Waiver Wired',
  `2015 team name is "Waiver Wired" (got ${hofCards.find((c) => c.year === '2015')?.team})`
);
// No real photos exist in this test fixture set — every card should fall back gracefully.
await page.waitForTimeout(200);
const allMissing = await page.$$eval('.photo-card', (cards) => cards.every((c) => c.classList.contains('photo-missing')));
assert(allMissing, 'cards fall back to "photo coming soon" when the image 404s, instead of a broken-image icon');

// Pill-caption layout — manager name and year share one row (".photo-primary"),
// with the year pill as the row's second child; the team name (Hall of Fame
// only) is a separate line below it.
const captionStructure = await page.$eval('.photo-card', (card) => {
  const primary = card.querySelector('.photo-primary');
  return {
    hasPrimary: !!primary,
    primaryChildCount: primary?.children.length,
    firstChildClass: primary?.children[0]?.className,
    secondChildClass: primary?.children[1]?.className,
    teamIsSiblingOfPrimary: card.querySelector('.photo-team')?.parentElement === card.querySelector('.photo-caption'),
  };
});
assert(captionStructure.hasPrimary, 'photo card has a .photo-primary row');
assert(captionStructure.primaryChildCount === 2, `.photo-primary contains exactly manager + year (got ${captionStructure.primaryChildCount} children)`);
assert(captionStructure.firstChildClass === 'photo-manager', `.photo-primary's first child is the manager name (got ${captionStructure.firstChildClass})`);
assert(captionStructure.secondChildClass === 'photo-year', `.photo-primary's second child is the year pill (got ${captionStructure.secondChildClass})`);
assert(captionStructure.teamIsSiblingOfPrimary, '.photo-team sits alongside .photo-primary as its own line, not inside it');

// NEW (this round): expandable "Starting Lineup" section on each Hall of Fame
// card, sourced from the "Hall of Fame" sheet tab (test/fixtures/Hall of
// Fame.csv — real captured sheet data, same quirks and all). Every one of
// the 11 fixture years has lineup data, so every card should get a toggle.
const lineupToggleCount = await page.$$eval('.lineup-toggle', (els) => els.length);
assert(lineupToggleCount === 11, `all 11 Hall of Fame cards have a "Starting Lineup" toggle (got ${lineupToggleCount})`);

const toggleInitialState = await page.$eval('.lineup-toggle', (el) => ({
  ariaExpanded: el.getAttribute('aria-expanded'),
  panelHidden: el.nextElementSibling.hidden,
}));
assert(
  toggleInitialState.ariaExpanded === 'false' && toggleInitialState.panelHidden === true,
  'lineup panel starts collapsed (aria-expanded=false, panel hidden)'
);

// Helper: find a photo card by its year pill text.
async function photoCardForYear(year) {
  for (const c of await page.$$('.photo-card')) {
    const y = await c.$eval('.photo-year', (el) => el.textContent).catch(() => null);
    if (y === year) return c;
  }
  return null;
}

const card2025 = await photoCardForYear('2025');
assert(card2025 !== null, 'found the 2025 photo card to inspect its lineup');
const toggle2025 = await card2025.$('.lineup-toggle');
await toggle2025.click();
await page.waitForTimeout(100);
const expandedState = await toggle2025.evaluate((el) => ({
  ariaExpanded: el.getAttribute('aria-expanded'),
  panelHidden: el.nextElementSibling.hidden,
}));
assert(expandedState.ariaExpanded === 'true' && expandedState.panelHidden === false, 'clicking the toggle expands the lineup panel');

const slots2025 = await card2025.$$eval('.lineup-slot', (els) =>
  els.map((el) => ({
    pos: el.querySelector('.lineup-pos')?.textContent,
    player: el.querySelector('.lineup-player')?.textContent,
    isEmpty: el.querySelector('.lineup-player')?.classList.contains('lineup-player-empty'),
  }))
);
console.log('2025 lineup slots:', slots2025);
assert(slots2025.length === 11, `2025 lineup has 11 slots (got ${slots2025.length})`);
assert(
  slots2025[0].pos === 'QB' && slots2025[0].player === 'Trevor Lawrence',
  `2025 first slot is QB pill + "Trevor Lawrence", no colon in the pill (got ${JSON.stringify(slots2025[0])})`
);
assert(slots2025.every((s) => !s.pos.includes(':')), 'position pills never include a colon');
const dstSlot2025 = slots2025.find((s) => s.pos === 'D/ST');
assert(dstSlot2025?.player === 'Seahawks', `2025 D/ST slot player is "Seahawks" (got ${dstSlot2025?.player})`);

// Collapse it back and confirm the toggle works both ways.
await toggle2025.click();
await page.waitForTimeout(100);
const collapsedAgain = await toggle2025.evaluate((el) => el.nextElementSibling.hidden);
assert(collapsedAgain === true, 'clicking the toggle again collapses the lineup panel');

// 2023's real sheet data has "D/ST Bills" with no colon — confirm the
// tolerant parser still splits it into a "D/ST" pill + "Bills" player.
const card2023 = await photoCardForYear('2023');
await card2023.$eval('.lineup-toggle', (el) => el.click());
await page.waitForTimeout(100);
const slots2023 = await card2023.$$eval('.lineup-slot', (els) =>
  els.map((el) => ({ pos: el.querySelector('.lineup-pos')?.textContent, player: el.querySelector('.lineup-player')?.textContent }))
);
const dstSlot2023 = slots2023.find((s) => s.player === 'Bills');
assert(dstSlot2023?.pos === 'D/ST', `2023's colon-less "D/ST Bills" line still parses into a D/ST pill (got ${JSON.stringify(dstSlot2023)})`);

// 2016's real sheet data has an unfilled TE slot ("TE: [empty]") — confirm
// it renders as "Empty" with the muted/italic styling, not a blank pill.
const card2016 = await photoCardForYear('2016');
await card2016.$eval('.lineup-toggle', (el) => el.click());
await page.waitForTimeout(100);
const slots2016 = await card2016.$$eval('.lineup-slot', (els) =>
  els.map((el) => ({
    pos: el.querySelector('.lineup-pos')?.textContent,
    player: el.querySelector('.lineup-player')?.textContent,
    isEmpty: el.querySelector('.lineup-player')?.classList.contains('lineup-player-empty'),
  }))
);
const teSlot2016 = slots2016.find((s) => s.pos === 'TE');
assert(
  teSlot2016?.player === 'Empty' && teSlot2016?.isEmpty === true,
  `2016's unfilled TE slot renders as "Empty" with muted styling (got ${JSON.stringify(teSlot2016)})`
);

// Column header lookup helper (index-agnostic — survives future column reordering).
async function headerIndex(tableSelector, matchText, excludeText) {
  return page.$$eval(
    `${tableSelector} thead th`,
    (ths, args) => ths.findIndex((th) => th.textContent.includes(args.matchText) && (!args.excludeText || !th.textContent.includes(args.excludeText))),
    { matchText, excludeText }
  );
}

// ---- career-stats.html: the career totals table lives here now ----
await page.goto(`${baseUrl}/career-stats.html`);
const careerStatsGateVisible = await page.$('.auth-box');
assert(careerStatsGateVisible === null, 'career-stats.html does not re-prompt within the same session');
assert((await page.title()).includes('Career Stats'), 'career-stats.html title includes "Career Stats"');

await page.waitForSelector('#career-table tbody tr');
const rowCount = await page.$$eval('#career-table tbody tr', (rows) => rows.length);
assert(rowCount === 17, `career table has 17 managers (got ${rowCount})`);

// Default sort (no header clicked yet) should be Reg W descending -> Marisa (80) on top.
const topManagerByDefault = await page.$eval('#career-table tbody tr:first-child td:first-child', (td) => td.textContent);
assert(topManagerByDefault === 'Marisa', `default sort is Reg W descending, Marisa on top (got ${topManagerByDefault})`);

const regWIndex = await headerIndex('#career-table', 'Reg W', 'Win%');
const regWTopValue = await page.$eval(`#career-table tbody tr:first-child td:nth-child(${regWIndex + 1})`, (td) => td.textContent);
assert(regWTopValue === '80', `top row's Reg W column reads 80 (got ${regWTopValue})`);

// Check Tim's row directly for career totals sanity (Reg W/L/T are now separate columns).
const timRow = await page.$$eval('#career-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'Tim');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
console.log('Tim row:', timRow);
const champIndex = await headerIndex('#career-table', 'Championships', 'Champ. Game');
const careerPointsIndex = await headerIndex('#career-table', 'Career Points (Reg)');
assert(timRow && timRow[champIndex] === '3', `Tim championships column = 3 (got ${timRow?.[champIndex]})`);
assert(careerPointsIndex !== -1, '"Career Points (Reg)" column header exists');
assert(timRow && timRow[regWIndex] === '79', `Tim Reg W column = 79 (got ${timRow?.[regWIndex]})`);

// New personal-best/worst columns, cross-checked against the independent pandas run.
const bestRecordIndex = await headerIndex('#career-table', 'Best Single-Season Record');
const worstRecordIndex = await headerIndex('#career-table', 'Worst Single-Season Record');
const bestSeasonIndex = await headerIndex('#career-table', 'Highest Scoring Season');
const bestWeekIndex = await headerIndex('#career-table', 'Highest Single-Week Score');
assert(timRow && timRow[bestRecordIndex] === '10-3-0 (2022)', `Tim best single-season record = 10-3-0 (2022) (got ${timRow?.[bestRecordIndex]})`);
assert(timRow && timRow[worstRecordIndex] === '4-9-0 (2024)', `Tim worst single-season record = 4-9-0 (2024) (got ${timRow?.[worstRecordIndex]})`);
assert(timRow && timRow[bestSeasonIndex] === '155.16 (2025)', `Tim highest scoring season = 155.16 (2025) (got ${timRow?.[bestSeasonIndex]})`);
assert(timRow && timRow[bestWeekIndex] === '227.84 (2023)', `Tim highest single-week score = 227.84 (2023) (got ${timRow?.[bestWeekIndex]})`);

// A manager with no recorded single-week score in any year should show "—", never "0.00" or blank.
const carterRow = await page.$$eval('#career-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'Carter');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
assert(carterRow && carterRow[bestWeekIndex] === '—', `Carter (no recorded weekly high) shows "—" for highest single-week score (got ${carterRow?.[bestWeekIndex]})`);

// Pythagorean/luck-driven career columns, cross-checked against the independent pandas run.
const bestPAGameIndex = await headerIndex('#career-table', 'Highest Points-Against/Game');
const bestZScoreIndex = await headerIndex('#career-table', 'Highest Single-Season Z-Score');
const luckiestIndex = await headerIndex('#career-table', 'Luckiest Season');
const unluckiestIndex = await headerIndex('#career-table', 'Unluckiest Season');
assert(timRow && timRow[bestPAGameIndex] === '141.26 (2021)', `Tim highest points-against/game = 141.26 (2021) (got ${timRow?.[bestPAGameIndex]})`);
assert(timRow && timRow[bestZScoreIndex] === '+2.02 (2025)', `Tim highest single-season z-score = +2.02 (2025) (got ${timRow?.[bestZScoreIndex]})`);
assert(timRow && timRow[luckiestIndex] === '+2 (2021)', `Tim luckiest season = +2 (2021) (got ${timRow?.[luckiestIndex]})`);
assert(timRow && timRow[unluckiestIndex] === '-3 (2016)', `Tim unluckiest season = -3 (2016) (got ${timRow?.[unluckiestIndex]})`);

const marisaCareerRow = await page.$$eval('#career-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'Marisa');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
assert(marisaCareerRow && marisaCareerRow[luckiestIndex] === '+5 (2015)', `Marisa luckiest season = +5 (2015) (got ${marisaCareerRow?.[luckiestIndex]})`);
assert(marisaCareerRow && marisaCareerRow[unluckiestIndex] === '-4 (2021)', `Marisa unluckiest season = -4 (2021) (got ${marisaCareerRow?.[unluckiestIndex]})`);

// NEW career-stats columns (this round): % of Playoff Seasons, Lowest Single-Season
// Z-Score, All-Time Average Z-Score — cross-checked against the independent pandas run.
const pctPlayoffIndex = await headerIndex('#career-table', '% of Playoff Seasons');
const worstZScoreIndex = await headerIndex('#career-table', 'Lowest Single-Season Z-Score');
const avgZScoreIndex = await headerIndex('#career-table', 'All-Time Average Z-Score');
assert(pctPlayoffIndex !== -1, '"% of Playoff Seasons" column header exists, next to Playoff Win%');
assert(pctPlayoffIndex === (await headerIndex('#career-table', 'Playoff Win%')) + 1, '"% of Playoff Seasons" column sits immediately after "Playoff Win%"');

// NEW (this round): every playoff-record stat (Playoff W/L/Win% columns, plus
// % of Playoff Seasons) carries the "no play-in games" note.
const careerHeaderTooltips = await page.$$eval('#career-table thead th', (ths) =>
  ths.map((th) => {
    const info = th.querySelector('.th-info');
    // Strip the trailing sort-arrow text (added as a plain text node) and the
    // tooltip icon's own "ⓘ" glyph to get the clean column label.
    const label = th.childNodes[0]?.nodeValue?.replace(/\s*[▲▼]\s*$/, '').trim() ?? '';
    return { label, tooltip: info ? info.dataset.tooltip : null };
  })
);
const headerTooltip = (label) => careerHeaderTooltips.find((h) => h.label === label)?.tooltip;
assert(headerTooltip('Playoff W') === 'Playoff record does not include play-in games.', `"Playoff W" column has the play-in-games tooltip (got ${JSON.stringify(headerTooltip('Playoff W'))})`);
assert(headerTooltip('Playoff L') === 'Playoff record does not include play-in games.', `"Playoff L" column has the play-in-games tooltip (got ${JSON.stringify(headerTooltip('Playoff L'))})`);
assert(headerTooltip('Playoff Win%') === 'Playoff record does not include play-in games.', `"Playoff Win%" column has the play-in-games tooltip (got ${JSON.stringify(headerTooltip('Playoff Win%'))})`);
assert(
  headerTooltip('% of Playoff Seasons')?.includes('Playoff record does not include play-in games.'),
  `"% of Playoff Seasons" tooltip still explains the stat AND carries the play-in-games note (got ${JSON.stringify(headerTooltip('% of Playoff Seasons'))})`
);
assert(worstZScoreIndex === bestZScoreIndex + 1, '"Lowest Single-Season Z-Score" column sits immediately after "Highest Single-Season Z-Score"');
assert(avgZScoreIndex === worstZScoreIndex + 1, '"All-Time Average Z-Score" column sits immediately after "Lowest Single-Season Z-Score"');

// NEW career-stats columns (this round): All-Time Average Points Against
// Z-Score (right after All-Time Average Z-Score) and Average Luck (right
// after Unluckiest Season). Expected values cross-checked independently in
// pandas (see independent_check.py).
const avgPAZScoreIndex = await headerIndex('#career-table', 'All-Time Average Points Against Z-Score');
const avgLuckIndexIndex = await headerIndex('#career-table', 'Average Luck');
assert(avgPAZScoreIndex === avgZScoreIndex + 1, '"All-Time Average Points Against Z-Score" column sits immediately after "All-Time Average Z-Score"');
assert(avgLuckIndexIndex === unluckiestIndex + 1, '"Average Luck" column sits immediately after "Unluckiest Season"');
assert(timRow && timRow[avgPAZScoreIndex] === '+0.11', `Tim all-time average points-against z-score = +0.11 (got ${timRow?.[avgPAZScoreIndex]})`);
assert(timRow && timRow[avgLuckIndexIndex] === '-0.64', `Tim average luck = -0.64 (got ${timRow?.[avgLuckIndexIndex]})`);
assert(carterRow && carterRow[avgPAZScoreIndex] === '+0.52', `Carter all-time average points-against z-score = +0.52 (got ${carterRow?.[avgPAZScoreIndex]})`);
assert(carterRow && carterRow[avgLuckIndexIndex] === '-2.50', `Carter average luck = -2.50 (got ${carterRow?.[avgLuckIndexIndex]})`);
assert(timRow && timRow[pctPlayoffIndex] === '72.7%', `Tim % of playoff seasons = 72.7% (got ${timRow?.[pctPlayoffIndex]})`);
assert(timRow && timRow[worstZScoreIndex] === '-1.18 (2024)', `Tim lowest single-season z-score = -1.18 (2024) (got ${timRow?.[worstZScoreIndex]})`);
assert(timRow && timRow[avgZScoreIndex] === '+0.74', `Tim all-time average z-score = +0.74 (got ${timRow?.[avgZScoreIndex]})`);
assert(carterRow && carterRow[pctPlayoffIndex] === '0.0%', `Carter % of playoff seasons = 0.0% (got ${carterRow?.[pctPlayoffIndex]})`);
assert(carterRow && carterRow[worstZScoreIndex] === '-0.44 (2017)', `Carter lowest single-season z-score = -0.44 (2017) (got ${carterRow?.[worstZScoreIndex]})`);
assert(carterRow && carterRow[avgZScoreIndex] === '+0.06', `Carter all-time average z-score = +0.06 (got ${carterRow?.[avgZScoreIndex]})`);

// NEW (this round): Chat Ragequits career columns, cross-checked against the independent pandas run.
const davidRow = await page.$$eval('#career-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'David');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
const careerRagequitsIndex = await headerIndex('#career-table', 'Chat Ragequits');
const bestRagequitsIndex = await headerIndex('#career-table', 'Most Ragequits in a Season');
const avgRagequitsIndex = await headerIndex('#career-table', 'Average Ragequits/Season');
assert(davidRow && davidRow[careerRagequitsIndex] === '17', `David career Chat Ragequits = 17 (got ${davidRow?.[careerRagequitsIndex]})`);
assert(davidRow && davidRow[bestRagequitsIndex] === '8 (2020)', `David most ragequits in a season = 8 (2020) (got ${davidRow?.[bestRagequitsIndex]})`);
assert(davidRow && davidRow[avgRagequitsIndex] === '2.1', `David average ragequits/season = 2.1 (got ${davidRow?.[avgRagequitsIndex]})`);
assert(timRow && timRow[careerRagequitsIndex] === '0', `Tim (never ragequit) career Chat Ragequits = 0 (got ${timRow?.[careerRagequitsIndex]})`);
assert(timRow && timRow[bestRagequitsIndex] === '0 (2015)', `Tim most ragequits in a season = 0 (2015, earliest year tiebreak) (got ${timRow?.[bestRagequitsIndex]})`);

// Hover-tooltip icons: Z-score (best+worst), Luckiest/Unluckiest, avg Z-score,
// % Playoff Seasons, Playoff W/L/Win%, plus (this round) avg Points-Against
// Z-score and Average Luck.
const careerTooltips = await page.$$eval('#career-table thead .th-info', (els) => els.map((el) => el.dataset.tooltip));
assert(careerTooltips.length === 11, `career table has 11 tooltip icons (got ${careerTooltips.length})`);
assert(careerTooltips.every((t) => t.length > 20), 'career table tooltips carry real explainer text, not empty strings');

// Sorting: click "Championships" header, confirm Tim (3) sorts to top in descending order.
await page.click(`#career-table thead th:nth-child(${champIndex + 1})`); // ascending first
await page.click(`#career-table thead th:nth-child(${champIndex + 1})`); // then descending
const topManagerAfterSort = await page.$eval('#career-table tbody tr:first-child td:first-child', (td) => td.textContent);
assert(topManagerAfterSort === 'Tim', `sorting by Championships desc puts Tim first (got ${topManagerAfterSort})`);

// Manager filter toggle: "All Managers" (default) vs "Active Managers"
// (only whoever has a row in the most recently loaded season -- 2025 in
// the fixtures, which has 10 managers per fixtures/2025.csv).
const allBtnSelected = await page.$eval('#manager-filter-toggle [data-mode="all"]', (b) => b.classList.contains('is-selected') && b.getAttribute('aria-pressed') === 'true');
assert(allBtnSelected, '"All Managers" is selected by default');
const activeBtnLabel = await page.$eval('#manager-filter-toggle [data-mode="active"]', (b) => b.textContent);
assert(activeBtnLabel === 'Active Managers (2025)', `"Active Managers" button is labeled with the most recent season (got ${activeBtnLabel})`);

await page.click('#manager-filter-toggle [data-mode="active"]');
await page.waitForFunction(() => document.querySelectorAll('#career-table tbody tr').length !== 17);
const activeRowCount = await page.$$eval('#career-table tbody tr', (rows) => rows.length);
assert(activeRowCount === 10, `Active Managers view shows only the 10 managers from the 2025 fixture (got ${activeRowCount})`);
const activeToggleState = await page.$eval('#manager-filter-toggle [data-mode="active"]', (b) => b.classList.contains('is-selected') && b.getAttribute('aria-pressed') === 'true');
assert(activeToggleState, '"Active Managers" button shows selected state after clicking it');
const allToggleState = await page.$eval('#manager-filter-toggle [data-mode="all"]', (b) => b.classList.contains('is-selected') || b.getAttribute('aria-pressed') === 'true');
assert(!allToggleState, '"All Managers" button loses its selected state once "Active Managers" is picked');
const activeManagerNames = await page.$$eval('#career-table tbody tr td:first-child', (tds) => tds.map((td) => td.textContent));
assert(!activeManagerNames.includes('Carter'), 'Carter (no 2025 row) is excluded from the Active Managers view');
assert(activeManagerNames.includes('Tim') && activeManagerNames.includes('Marisa'), 'managers who did play in 2025 remain in the Active Managers view');
// Sort state (Championships desc, set above) should carry over across the toggle rather than resetting.
const topManagerActiveView = activeManagerNames[0];
assert(topManagerActiveView === 'Tim', `sort (Championships desc) is preserved across the filter toggle, Tim still on top (got ${topManagerActiveView})`);

await page.click('#manager-filter-toggle [data-mode="all"]');
await page.waitForFunction(() => document.querySelectorAll('#career-table tbody tr').length === 17);
const restoredRowCount = await page.$$eval('#career-table tbody tr', (rows) => rows.length);
assert(restoredRowCount === 17, `switching back to "All Managers" restores all 17 managers (got ${restoredRowCount})`);
const restoredManagerNames = await page.$$eval('#career-table tbody tr td:first-child', (tds) => tds.map((td) => td.textContent));
assert(restoredManagerNames.includes('Carter'), 'Carter reappears once back on "All Managers"');

// Frozen Manager column: stays pinned in place while the table scrolls horizontally.
const stickyStyles = await page.evaluate(() => {
  const th = document.querySelector('#career-table thead th:first-child');
  const td = document.querySelector('#career-table tbody tr:first-child td:first-child');
  return {
    thPosition: getComputedStyle(th).position,
    thLeft: getComputedStyle(th).left,
    tdPosition: getComputedStyle(td).position,
    tdLeft: getComputedStyle(td).left,
  };
});
assert(
  stickyStyles.thPosition === 'sticky' && stickyStyles.thLeft === '0px',
  `career table's Manager header is a frozen (sticky, left: 0) column (got ${JSON.stringify(stickyStyles)})`
);
assert(
  stickyStyles.tdPosition === 'sticky' && stickyStyles.tdLeft === '0px',
  `career table's Manager cells are a frozen (sticky, left: 0) column (got ${JSON.stringify(stickyStyles)})`
);
const boundingLeftBeforeScroll = await page.$eval('#career-table tbody tr:first-child td:first-child', (td) => td.getBoundingClientRect().left);
await page.$eval('.table-wrap', (el) => { el.scrollLeft = 600; });
await page.waitForTimeout(50);
const scrolledLeft = await page.$eval('.table-wrap', (el) => el.scrollLeft);
assert(scrolledLeft > 0, `table-wrap actually scrolled horizontally (scrollLeft=${scrolledLeft})`);
const boundingLeftAfterScroll = await page.$eval('#career-table tbody tr:first-child td:first-child', (td) => td.getBoundingClientRect().left);
assert(
  boundingLeftAfterScroll === boundingLeftBeforeScroll,
  `Manager column stays visually in place after scrolling right (before=${boundingLeftBeforeScroll}, after=${boundingLeftAfterScroll})`
);
const scrolledManagerName = await page.$eval('#career-table tbody tr:first-child td:first-child', (td) => td.textContent);
assert(scrolledManagerName === 'Tim', `frozen column still shows the right manager name after scrolling (got ${scrolledManagerName})`);
await page.$eval('.table-wrap', (el) => { el.scrollLeft = 0; }); // reset for any later assertions

// ---- season.html: gate should already be unlocked (same session) ----
await page.goto(`${baseUrl}/season.html`);
const gateVisible = await page.$('.auth-box');
assert(gateVisible === null, 'season.html does not re-prompt within the same session');

assert((await page.title()).includes('Season Stats'), 'season.html title includes "Season Stats"');

await page.waitForSelector('#season-table tbody tr');
const selectedYear = await page.$eval('#year-select', (el) => el.value);
assert(selectedYear === '2025', `season explorer defaults to most recent year (got ${selectedYear})`);

const marisaRow2025 = await page.$$eval('#season-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'Marisa');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
console.log('Marisa 2025 row:', marisaRow2025);
assert(marisaRow2025 && marisaRow2025[1] === '2', `2025 Marisa final standing = 2 (got ${marisaRow2025?.[1]})`);

// New Season Stats columns: Z-score, Pythagorean win%, win% over/under Pythagorean.
// Expected values cross-checked independently in pandas (see independent_check.py).
const timRow2025 = await page.$$eval('#season-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'Tim');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
console.log('Tim 2025 season row:', timRow2025);
const zScoreIdx = await headerIndex('#season-table', 'Z-Score');
const pythagIdx = await headerIndex('#season-table', 'Pythagorean Win%');
const overUnderIdx = await headerIndex('#season-table', 'Win% +/- Pythagorean');
assert(timRow2025 && timRow2025[zScoreIdx] === '+2.02', `Tim 2025 Z-score = +2.02 (got ${timRow2025?.[zScoreIdx]})`);
// Pythagorean exponent is fit to this league's own history (6.1), not the NFL's 2.37 — see fit_pythagorean_exponent.py.
assert(timRow2025 && timRow2025[pythagIdx] === '67.1%', `Tim 2025 Pythagorean win% = 67.1% (got ${timRow2025?.[pythagIdx]})`);
assert(timRow2025 && timRow2025[overUnderIdx] === '+9.8%', `Tim 2025 win% over/under Pythagorean = +9.8% (got ${timRow2025?.[overUnderIdx]})`);

// NEW (this round): per-season "Luck" column (previously only surfaced as
// Luckiest/Unluckiest Season on Career Stats). Expected values cross-checked
// independently in pandas (see independent_check.py).
const luckColIdx = await headerIndex('#season-table', 'Luck');
const eriRow2025 = await page.$$eval('#season-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'Eri');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
assert(luckColIdx !== -1, '"Luck" column header exists on Season Stats');
assert(timRow2025 && timRow2025[luckColIdx] === '0', `Tim 2025 luck = 0 (got ${timRow2025?.[luckColIdx]})`);
assert(eriRow2025 && eriRow2025[luckColIdx] === '-4', `Eri 2025 luck = -4 (got ${eriRow2025?.[luckColIdx]})`);

// NEW (this round): raw Chat Ragequits passthrough column on Season Stats.
const ragequitsIdx = await headerIndex('#season-table', 'Chat Ragequits');
const benRow2025 = await page.$$eval('#season-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'Ben');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
assert(ragequitsIdx !== -1, '"Chat Ragequits" column header exists on Season Stats');
assert(benRow2025 && benRow2025[ragequitsIdx] === '2', `Ben 2025 Chat Ragequits = 2 (got ${benRow2025?.[ragequitsIdx]})`);
assert(timRow2025 && timRow2025[ragequitsIdx] === '0', `Tim 2025 Chat Ragequits = 0 (got ${timRow2025?.[ragequitsIdx]})`);

// Hover-tooltip icons exist with real plain-language explainer text.
const seasonTooltips = await page.$$eval('#season-table thead .th-info', (els) => els.map((el) => el.dataset.tooltip));
assert(seasonTooltips.length === 4, `season table has 4 tooltip icons: Z-score, Luck, Pythagorean win%, win% +/- Pythagorean (got ${seasonTooltips.length})`);
assert(seasonTooltips.every((t) => t.length > 20), 'season table tooltips carry real explainer text, not empty strings');

// Switch to a year with blank Highest Single Week Score (2018) and confirm it renders as "—", not "0.00".
await page.selectOption('#year-select', '2018');
await page.waitForTimeout(150);
const ethan2018 = await page.$$eval('#season-table tbody tr', (rows) => {
  const r = rows.find((tr) => tr.children[0].textContent === 'Ethan');
  return r ? [...r.children].map((td) => td.textContent) : null;
});
console.log('Ethan 2018 row:', ethan2018);
const highestWeekIdx = await page.$$eval('#season-table thead th', (ths) => ths.findIndex((th) => th.textContent.includes('Highest Single Week')));
assert(ethan2018 && ethan2018[highestWeekIdx] === '—', `2018 blank Highest Single Week renders as em-dash, not 0 (got ${ethan2018?.[highestWeekIdx]})`);

// ---- all-time-records.html: the record book now lives at its own URL ----
await page.goto(`${baseUrl}/all-time-records.html`);
const atrGateVisible = await page.$('.auth-box');
assert(atrGateVisible === null, 'all-time-records.html does not re-prompt within the same session');
assert((await page.title()).includes('All-Time Records'), 'all-time-records.html title includes "All-Time Records"');
const atrNavText = await page.$$eval('nav.site-nav a', (as) => as.map((a) => a.textContent));
assert(
  atrNavText.includes('All-Time Records') && atrNavText.includes('Career Stats') && atrNavText.includes('Season Stats'),
  `nav shows renamed labels including Career Stats (got ${atrNavText})`
);
assert(atrNavText.includes('Draft History'), `nav includes "Draft History" (got ${atrNavText})`);
assert(atrNavText.length === 7, `nav has 7 links (got ${atrNavText.length})`);
const atrAriaCurrent = await page.$eval('nav.site-nav a[aria-current="page"]', (a) => a.textContent);
assert(atrAriaCurrent === 'All-Time Records', `"All-Time Records" nav link is marked aria-current on all-time-records.html (got ${atrAriaCurrent})`);

await page.waitForSelector('.record-card');
const recordCards = await page.$$eval('.record-card', (cards) =>
  cards.map((c) => {
    const labelEl = c.querySelector('.label');
    const infoEl = labelEl.querySelector('.th-info');
    // The label div's first child is always the plain label text node --
    // a tooltip icon (if any) is a separate <span> appended after it, so
    // this excludes the icon glyph ("ⓘ") from the label text itself.
    const label = (labelEl.childNodes[0]?.nodeValue ?? labelEl.textContent).trim();
    return {
      label,
      value: c.querySelector('.value').textContent,
      holders: c.querySelector('.holders').textContent,
      tooltip: infoEl ? infoEl.dataset.tooltip : null,
    };
  })
);
console.log(recordCards);
assert(
  recordCards.find((c) => c.label.includes('Highest single-week'))?.value === '227.84',
  'highest single-week score = 227.84'
);
assert(
  recordCards.find((c) => c.label.includes('Highest single-week'))?.holders.includes('Tim (2023)'),
  'highest single-week score holder = Tim (2023)'
);
assert(
  recordCards.find((c) => c.label.includes('Most championships'))?.value === '3',
  'most championships = 3'
);
assert(
  recordCards.find((c) => c.label === 'Most Regular Season Wins')?.value === '80',
  'most regular season wins = 80'
);
assert(
  recordCards.find((c) => c.label === 'Most Regular Season Wins')?.holders.includes('Marisa'),
  'most regular season wins holder = Marisa'
);
assert(
  recordCards.find((c) => c.label.includes('#1 regular-season'))?.value === '4',
  'most #1 regular-season finishes = 4'
);
assert(
  recordCards.map((c) => c.label).join('|') ===
    [
      'Most championships',
      'Most Regular Season Wins',
      'Most #1 regular-season finishes',
      'Most last-place finishes',
      'Highest single-week score ever',
      'Best single-season points/game',
      'Most single-season points against/game',
      'Most career points',
      'Most wins in a single season',
      'Most losses in a single season',
      'Highest career playoff win%',
      'Most career playoff wins',
      'Most championship game appearances',
      'Most Maid Bowl appearances',
      'Luckiest season ever',
      'Unluckiest season ever',
      'Best single-season Z-score',
      'Worst single-season Z-score',
      'Most Chat Ragequits',
      'Most Chat Ragequits, Single Season',
      // NEW (this round): computed from the "Hall of Fame" tab's lineup data,
      // appended right after the season-tab-computed cards and before "Other
      // Records" (see leaderboard.js's lineupRecordCards).
      'Most Appearances by a Single Player in Championship Lineups',
      // "Other Records" tab (hand-entered, appended after the computed
      // cards) — fixture has 9 rows (7 real + 2 synthetic edge cases), all
      // with a "Record Name", so all 9 render (only the name is required;
      // a blank value or holder just renders as "—" on its own card).
      'Most Times Slept Through Draft',
      'Most Chat Rage-Quits, Single Season',
      'Most Meals Ordered in Foreign Language at Draft',
      'Farthest Draft from L.A.',
      'Earliest Drafted Kicker',
      'Most Defenses Drafted',
      'Most Championships Secured due to Player Dying on Field',
      'Missing Value Record',
      'Longest losing streak trash talk',
    ].join('|'),
  `record cards are in the requested order, computed then lineup then other-records (got: ${recordCards.map((c) => c.label).join(', ')})`
);
assert(recordCards.length === 30, `record book has 20 computed + 1 lineup + 9 other-records cards = 30 (got ${recordCards.length})`);
const recordBookHeading = await page.$$eval('h2', (hs) => hs.some((h) => h.textContent.trim() === 'Record Book'));
assert(recordBookHeading === false, '"Record Book" heading has been removed from the page');
const lastPlaceCard = recordCards.find((c) => c.label.includes('last-place'));
assert(lastPlaceCard?.value === '3', 'most last-place finishes = 3');
assert(
  lastPlaceCard?.holders.includes('Ethan') && lastPlaceCard?.holders.includes('Kuba'),
  'most last-place finishes is a tie: Ethan and Kuba'
);

// New record-book cards (this round), values cross-checked against the independent pandas run.
const cardByLabel = (label) => recordCards.find((c) => c.label === label);
assert(cardByLabel('Most single-season points against/game')?.value === '160.68', `most PA/game = 160.68 (got ${cardByLabel('Most single-season points against/game')?.value})`);
assert(cardByLabel('Most single-season points against/game')?.holders.includes('Ray (2025)'), 'most PA/game holder = Ray (2025)');
assert(cardByLabel('Most career points')?.value === '17500.01', `most career points = 17500.01 (got ${cardByLabel('Most career points')?.value})`);
assert(cardByLabel('Most career points')?.holders === 'Tim', 'most career points holder = Tim');
assert(cardByLabel('Most wins in a single season')?.value === '12', `most wins in a season = 12 (got ${cardByLabel('Most wins in a single season')?.value})`);
assert(cardByLabel('Most wins in a single season')?.holders.includes('Marisa (2025)'), 'most wins in a season holder = Marisa (2025)');
assert(cardByLabel('Most losses in a single season')?.value === '11', `most losses in a season = 11 (got ${cardByLabel('Most losses in a single season')?.value})`);
assert(
  cardByLabel('Most losses in a single season')?.holders.includes('Eri (2025)') &&
    cardByLabel('Most losses in a single season')?.holders.includes('Ray (2023)'),
  'most losses in a season is a tie: Eri (2025) and Ray (2023)'
);
assert(cardByLabel('Highest career playoff win%')?.value === '100.0%', `highest playoff win% = 100.0% (got ${cardByLabel('Highest career playoff win%')?.value})`);
assert(cardByLabel('Highest career playoff win%')?.holders === 'Ray', 'highest playoff win% holder = Ray');
assert(cardByLabel('Most career playoff wins')?.value === '7', `most playoff wins = 7 (got ${cardByLabel('Most career playoff wins')?.value})`);
assert(cardByLabel('Most career playoff wins')?.holders === 'Tim', 'most playoff wins holder = Tim');

// NEW (this round): playoff-record cards carry the "no play-in games" note.
for (const label of ['Highest career playoff win%', 'Most career playoff wins']) {
  const tooltip = cardByLabel(label)?.tooltip;
  assert(tooltip === 'Playoff record does not include play-in games.', `"${label}" card has the play-in-games tooltip (got ${JSON.stringify(tooltip)})`);
}
assert(cardByLabel('Most championship game appearances')?.value === '4', `most champ game appearances = 4 (got ${cardByLabel('Most championship game appearances')?.value})`);
assert(
  ['Josh', 'Marisa', 'Tim'].every((m) => cardByLabel('Most championship game appearances')?.holders.includes(m)),
  'most champ game appearances is a 3-way tie: Josh, Marisa, Tim'
);
assert(cardByLabel('Most Maid Bowl appearances')?.value === '4', `most Maid Bowl appearances = 4 (got ${cardByLabel('Most Maid Bowl appearances')?.value})`);
assert(cardByLabel('Most Maid Bowl appearances')?.holders === 'Ethan', 'most Maid Bowl appearances holder = Ethan');
assert(cardByLabel('Luckiest season ever')?.value === '+6', `luckiest season ever = +6 (got ${cardByLabel('Luckiest season ever')?.value})`);
assert(
  ['Ethan (2018)', 'Ethan (2023)', 'Josh (2016)'].every((h) => cardByLabel('Luckiest season ever')?.holders.includes(h)),
  'luckiest season ever is a 3-way tie: Ethan (2018), Ethan (2023), Josh (2016)'
);
assert(cardByLabel('Unluckiest season ever')?.value === '-7', `unluckiest season ever = -7 (got ${cardByLabel('Unluckiest season ever')?.value})`);
assert(cardByLabel('Unluckiest season ever')?.holders.includes('Carter (2016)'), 'unluckiest season ever holder = Carter (2016)');
assert(cardByLabel('Best single-season Z-score')?.value === '+2.02', `best single-season z-score = +2.02 (got ${cardByLabel('Best single-season Z-score')?.value})`);
assert(cardByLabel('Best single-season Z-score')?.holders.includes('Tim (2025)'), 'best single-season z-score holder = Tim (2025)');
assert(cardByLabel('Worst single-season Z-score')?.value === '-2.00', `worst single-season z-score = -2.00 (got ${cardByLabel('Worst single-season Z-score')?.value})`);
assert(cardByLabel('Worst single-season Z-score')?.holders.includes('Michael (2017)'), 'worst single-season z-score holder = Michael (2017)');

// NEW (this round): Chat Ragequits record-book cards, cross-checked against the independent pandas run.
assert(cardByLabel('Most Chat Ragequits')?.value === '17', `most career chat ragequits = 17 (got ${cardByLabel('Most Chat Ragequits')?.value})`);
assert(cardByLabel('Most Chat Ragequits')?.holders === 'David', `most career chat ragequits holder = David (got ${cardByLabel('Most Chat Ragequits')?.holders})`);
assert(cardByLabel('Most Chat Ragequits, Single Season')?.value === '8', `most chat ragequits in a season = 8 (got ${cardByLabel('Most Chat Ragequits, Single Season')?.value})`);
assert(cardByLabel('Most Chat Ragequits, Single Season')?.holders.includes('David (2020)'), 'most chat ragequits in a season holder = David (2020)');

// NEW (this round): "Most Appearances by a Single Player in Championship
// Lineups" — computed from the "Hall of Fame" tab's lineup data (D/ST and
// unfilled slots excluded). Verified against the real fetched sheet data
// with a standalone script before this shipped: A.J. Brown appears in the
// 2019, 2022, and 2023 championship lineups — 3 times, more than anyone else.
assert(
  cardByLabel('Most Appearances by a Single Player in Championship Lineups')?.value === '3',
  `most lineup appearances = 3 (got ${cardByLabel('Most Appearances by a Single Player in Championship Lineups')?.value})`
);
assert(
  cardByLabel('Most Appearances by a Single Player in Championship Lineups')?.holders === 'A.J. Brown',
  `most lineup appearances holder = A.J. Brown (got ${cardByLabel('Most Appearances by a Single Player in Championship Lineups')?.holders})`
);
const lineupCardTooltip = cardByLabel('Most Appearances by a Single Player in Championship Lineups')?.tooltip;
assert(
  typeof lineupCardTooltip === 'string' && lineupCardTooltip.includes('D/ST'),
  `lineup-appearances card has a real tooltip explaining the D/ST exclusion (got ${JSON.stringify(lineupCardTooltip)})`
);

// The 4 record-book cards whose stat also has a hover tooltip on Career/Season
// Stats (Luckiest/Unluckiest season ever, Best/Worst single-season Z-score)
// carry the same kind of "ⓘ" tooltip here, with real explainer text.
for (const label of ['Luckiest season ever', 'Unluckiest season ever', 'Best single-season Z-score', 'Worst single-season Z-score']) {
  const tooltip = cardByLabel(label)?.tooltip;
  assert(typeof tooltip === 'string' && tooltip.length > 20, `"${label}" card has a real tooltip (got ${JSON.stringify(tooltip)})`);
}
// Cards with no Career/Season Stats equivalent (e.g. a plain count) don't get one.
assert(cardByLabel('Most championships')?.tooltip == null, '"Most championships" card has no tooltip icon (no Career Stats equivalent needs explaining)');
// The tooltip icon uses the shared custom popup (data-tooltip via CSS ::after), not
// a native `title` attribute -- which is what lets it be sized larger than default.
const luckiestInfoIcon = await page.$('.record-card .th-info');
assert(luckiestInfoIcon !== null, 'a tooltip icon element exists on the All-Time Records page');
const iconHasNoNativeTitle = await page.$eval('.record-card .th-info', (el) => el.getAttribute('title') === null);
assert(iconHasNoNativeTitle, 'tooltip icon has no native title attribute (uses the custom, resizable popup instead)');
const tooltipMaxWidth = await page.$eval('.record-card .th-info', (el) => getComputedStyle(el, '::after').maxWidth);
assert(tooltipMaxWidth && tooltipMaxWidth !== 'none', `tooltip popup has an explicit max-width so it renders as a real text box (got ${tooltipMaxWidth})`);

// "Other Records" tab: freeform, hand-entered cards rendered in the exact same card format.
assert(cardByLabel('Most Times Slept Through Draft')?.value === '1', `other-record value passes through verbatim (got ${cardByLabel('Most Times Slept Through Draft')?.value})`);
assert(cardByLabel('Most Times Slept Through Draft')?.holders === 'Kuba (2017)', `other-record holder passes through verbatim (got ${cardByLabel('Most Times Slept Through Draft')?.holders})`);
assert(
  cardByLabel('Most Championships Secured due to Player Dying on Field')?.value === '1' &&
    cardByLabel('Most Championships Secured due to Player Dying on Field')?.holders === 'Tim (2022, Damar Hamlin)',
  `other-record value can include punctuation/parentheses (got value=${cardByLabel('Most Championships Secured due to Player Dying on Field')?.value} holders=${cardByLabel('Most Championships Secured due to Player Dying on Field')?.holders})`
);
assert(
  cardByLabel('Longest losing streak trash talk')?.value === '17 days' && cardByLabel('Longest losing streak trash talk')?.holders === 'Ethan',
  `other-record row with extra whitespace is trimmed on every column (got value=${cardByLabel('Longest losing streak trash talk')?.value} holders=${cardByLabel('Longest losing streak trash talk')?.holders})`
);
// Rows with a blank "Record Value" (real content lives in Holder instead)
// still render -- only "Record Name" is required -- with "—" for the blank field.
assert(
  cardByLabel('Farthest Draft from L.A.')?.value === '—' && cardByLabel('Farthest Draft from L.A.')?.holders === 'Cabo San Lucas, Mexico (2025)',
  `other-record row with a blank value renders '—' and keeps its holder text (got value=${cardByLabel('Farthest Draft from L.A.')?.value} holders=${cardByLabel('Farthest Draft from L.A.')?.holders})`
);
assert(
  cardByLabel('Missing Value Record')?.value === '—' && cardByLabel('Missing Value Record')?.holders === 'Nobody',
  `other-record row with a blank value still renders as a card, not dropped (got value=${cardByLabel('Missing Value Record')?.value} holders=${cardByLabel('Missing Value Record')?.holders})`
);
const otherRecordCardEls = await page.$$eval('.record-card', (cards) => cards.filter((c) => c.querySelector('.label').textContent === 'Most Times Slept Through Draft'));
assert(otherRecordCardEls.length === 1, 'other-record card uses the same .record-card markup as computed cards');

// ---- maid-quarters.html: entries render with year + manager, no team name ----
await page.goto(`${baseUrl}/maid-quarters.html`);
await page.waitForSelector('.photo-card');
const mqCards = await page.$$eval('.photo-card', (cards) =>
  cards.map((c) => ({
    year: c.querySelector('.photo-year')?.textContent,
    manager: c.querySelector('.photo-manager')?.textContent,
    hasTeam: !!c.querySelector('.photo-team'),
  }))
);
console.log('Maid Quarters cards:', mqCards);
assert(mqCards.length === 8, `Maid Quarters shows all 8 configured years (got ${mqCards.length})`);
assert(mqCards.every((c) => !c.hasTeam), 'Maid Quarters cards never render a team-name line');
assert(mqCards[0].year === '2025', `Maid Quarters sorts newest first (got ${mqCards[0]?.year})`);
assert(mqCards.every((c) => c.manager && c.manager !== '—'), 'every Maid Quarters card resolves a manager name from the sheet');

// ---- draft-history.html: freeform, hand-entered writeups pulled live from the sheet ----
await page.goto(`${baseUrl}/draft-history.html`);
const draftHistoryGateVisible = await page.$('.auth-box');
assert(draftHistoryGateVisible === null, 'draft-history.html does not re-prompt within the same session');
assert((await page.title()).includes('Draft History'), 'draft-history.html title includes "Draft History"');

await page.waitForSelector('.draft-history-entry');
const draftEntries = await page.$$eval('.draft-history-entry', (cards) =>
  cards.map((c) => ({
    // The heading's first child is the plain year/"Before 2015" text node --
    // the location (if any) is a separate <span> appended after it.
    year: c.querySelector('.draft-history-heading')?.childNodes[0]?.nodeValue?.trim(),
    location: c.querySelector('.draft-history-location')?.textContent ?? null,
    recap: c.querySelector('.draft-history-recap')?.textContent,
  }))
);
console.log('Draft History entries:', draftEntries);
// Fixture has 8 data rows; the row with a Location but no Recap is dropped
// (only "Recap" is required for a row to appear), leaving 7 entries.
assert(draftEntries.length === 7, `Draft History shows 7 entries, blank-Recap row dropped (got ${draftEntries.length})`);
assert(draftEntries[0].year === '2027', `Draft History sorts newest first (got ${draftEntries[0]?.year})`);
assert(draftEntries[draftEntries.length - 1].year === 'Before 2015', `the blank-"Year" entry sorts last, labeled "Before 2015" (got ${draftEntries[draftEntries.length - 1]?.year})`);
const entry2019 = draftEntries.find((e) => e.year === '2019');
assert(entry2019?.location === "Jason's House | San Diego, CA", `2019 location is trimmed of surrounding whitespace (got ${JSON.stringify(entry2019?.location)})`);
assert(entry2019?.recap === 'Extra whitespace around every field should be trimmed.', `2019 recap is trimmed of surrounding whitespace (got ${JSON.stringify(entry2019?.recap)})`);
const entry2027 = draftEntries.find((e) => e.year === '2027');
assert(entry2027?.location === null, `an entry with a blank Location renders no location span at all (got ${JSON.stringify(entry2027?.location)})`);

// ---- rules.html: still gated, fetches + reformats the live Google Doc in
// the site's own style (no iframe). The docs.google.com export endpoint is
// mocked above with a real, saved copy of the actual doc's exported HTML
// (test/fixtures/rules-doc.html), so this exercises rules.js's real parser
// against real content, not a hand-written stand-in — the fixture was
// captured live, in a real browser, from the actual doc before this shipped.
await page.goto(`${baseUrl}/rules.html`);
const rulesGateVisible = await page.$('.auth-box');
assert(rulesGateVisible === null, 'rules.html does not re-prompt within the same session (still password-gated)');

await page.waitForSelector('#doc-content .rules-title');
const noIframe = await page.$('iframe.doc-embed');
assert(noIframe === null, 'rules.html no longer embeds the doc via iframe');

const rulesTitle = await page.$eval('#doc-content .rules-title', (el) => el.textContent);
assert(rulesTitle === 'OUR FANTASY FOOTBALL CUSTOM LEAGUE RULES', `doc title renders correctly (got ${JSON.stringify(rulesTitle)})`);

const rulesSubheadings = await page.$$eval('#doc-content .rules-subheading', (els) => els.map((el) => el.textContent));
assert(
  rulesSubheadings.length === 9,
  `all 9 real sections render as subheadings (got ${rulesSubheadings.length}: ${JSON.stringify(rulesSubheadings)})`
);
assert(rulesSubheadings[0] === 'Rule Changes:', `first section is "Rule Changes:" (got ${JSON.stringify(rulesSubheadings[0])})`);
assert(
  rulesSubheadings[rulesSubheadings.length - 1] === 'FOR ANY CONTROVERSIAL MATTERS NOT COVERED ABOVE:',
  `last section (its own all-caps heading, same handling as the Title Case ones) renders correctly (got ${JSON.stringify(rulesSubheadings[rulesSubheadings.length - 1])})`
);

// Nesting: Playoffs' "Week 15/16/17" sub-headers each carry their own
// matchup sub-list (Docs emits these as flat sibling <ul>s keyed by a
// shared list-id — see rules.js's buildList()).
const week15Matchups = await page.$eval('#doc-content', (container) => {
  const allLis = [...container.querySelectorAll('.rules-list li')];
  // Match on the li's own direct text node only, not its full (nested-list-
  // inclusive) textContent, since this li has a nested <ul> of its own.
  const week15 = allLis.find((li) => li.childNodes[0]?.nodeValue === 'Week 15: Play-in');
  const nested = week15?.querySelector(':scope > ul');
  return nested ? [...nested.children].map((li) => li.textContent) : null;
});
assert(week15Matchups?.length === 3, `Week 15 renders its own nested 3-item matchup list (got ${JSON.stringify(week15Matchups)})`);
assert(week15Matchups?.[0]?.startsWith('1 vs. 2'), `Week 15's first matchup is correct (got ${JSON.stringify(week15Matchups?.[0])})`);

// Lead-in bullets (a sole list item that only exists to introduce its own
// nested sub-list) get the no-marker "lead" treatment.
const leadTexts = await page.$$eval('.rules-list-lead', (els) => els.map((el) => el.childNodes[0].textContent));
assert(leadTexts.includes('The winner receives the following prizes:'), 'the Winning Prizes lead-in line is treated as a lead, not a bullet');
assert(leadTexts.includes('We have a custom play-in system:'), 'the Playoffs lead-in line is treated as a lead, not a bullet');

// On Draft's 10-item draft-order list renders in full, in document order.
const draftOrderItems = await page.$$eval('#doc-content .rules-subheading', (headings) => {
  const onDraft = headings.find((h) => h.textContent === 'On Draft:');
  const list = onDraft?.nextElementSibling;
  return list ? [...list.querySelectorAll('li')].filter((li) => !li.classList.contains('rules-list-lead')).map((li) => li.textContent) : null;
});
assert(draftOrderItems?.length === 10, `On Draft's order list has all 10 real items (got ${draftOrderItems?.length})`);
assert(draftOrderItems?.[0] === '5th place (first person out of the playoffs): #1 choice', `On Draft's first item is correct (got ${JSON.stringify(draftOrderItems?.[0])})`);
assert(draftOrderItems?.[9] === '1st place: #10', `On Draft's last item is correct (got ${JSON.stringify(draftOrderItems?.[9])})`);

const fallbackHref = await page.$eval('.doc-fallback-link a', (el) => el.getAttribute('href'));
assert(fallbackHref?.includes('1LqGI0yQttBau_vQETBBbQpTDmGEJHB8Crg79C_5XgkI'), 'fallback "view source doc" link points at the right doc');

await browser.close();
server.close();

if (failed) {
  console.error('\nE2E TEST FAILED');
  process.exit(1);
} else {
  console.log('\nAll E2E checks passed.');
}
