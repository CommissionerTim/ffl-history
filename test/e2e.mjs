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

await page.waitForSelector('#career-table tbody tr');
const rowCount = await page.$$eval('#career-table tbody tr', (rows) => rows.length);
assert(rowCount === 17, `career table has 17 managers (got ${rowCount})`);

const recordCards = await page.$$eval('.record-card', (cards) =>
  cards.map((c) => ({
    label: c.querySelector('.label').textContent,
    value: c.querySelector('.value').textContent,
    holders: c.querySelector('.holders').textContent,
  }))
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
    ].join('|'),
  `record cards are in the requested order (got: ${recordCards.map((c) => c.label).join(', ')})`
);
const recordBookHeading = await page.$$eval('h2', (hs) => hs.some((h) => h.textContent.trim() === 'Record Book'));
assert(recordBookHeading === false, '"Record Book" heading has been removed from the page');
const lastPlaceCard = recordCards.find((c) => c.label.includes('last-place'));
assert(lastPlaceCard?.value === '3', 'most last-place finishes = 3');
assert(
  lastPlaceCard?.holders.includes('Ethan') && lastPlaceCard?.holders.includes('Kuba'),
  'most last-place finishes is a tie: Ethan and Kuba'
);

// Column header lookup helper (index-agnostic — survives future column reordering).
async function headerIndex(tableSelector, matchText, excludeText) {
  return page.$$eval(
    `${tableSelector} thead th`,
    (ths, args) => ths.findIndex((th) => th.textContent.includes(args.matchText) && (!args.excludeText || !th.textContent.includes(args.excludeText))),
    { matchText, excludeText }
  );
}

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

// Sorting: click "Championships" header, confirm Tim (3) sorts to top in descending order.
await page.click(`#career-table thead th:nth-child(${champIndex + 1})`); // ascending first
await page.click(`#career-table thead th:nth-child(${champIndex + 1})`); // then descending
const topManagerAfterSort = await page.$eval('#career-table tbody tr:first-child td:first-child', (td) => td.textContent);
assert(topManagerAfterSort === 'Tim', `sorting by Championships desc puts Tim first (got ${topManagerAfterSort})`);

// Page titles / nav labels reflect the renamed pages.
assert((await page.title()).includes('All-Time Records'), 'index.html title includes "All-Time Records"');
const navText = await page.$$eval('nav.site-nav a', (as) => as.map((a) => a.textContent));
assert(navText.includes('All-Time Records') && navText.includes('Season Stats'), `nav shows renamed labels (got ${navText})`);

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

// ---- hall-of-fame.html: manager names pulled live from the sheet, photo fallback ----
await page.goto(`${baseUrl}/hall-of-fame.html`);
const hofGateVisible = await page.$('.auth-box');
assert(hofGateVisible === null, 'hall-of-fame.html does not re-prompt within the same session');

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

// ---- rules.html: still gated, embeds the live Google Doc ----
// (docs.google.com itself isn't reachable from this sandbox, so this only
// checks that the gate + the iframe wiring are correct, not the doc's
// actual rendered content — that was checked separately, live, in a real
// browser on Tim's machine before this shipped.)
await page.goto(`${baseUrl}/rules.html`);
const rulesGateVisible = await page.$('.auth-box');
assert(rulesGateVisible === null, 'rules.html does not re-prompt within the same session (still password-gated)');
await page.waitForSelector('iframe.doc-embed');
const iframeSrc = await page.$eval('iframe.doc-embed', (el) => el.getAttribute('src'));
assert(
  iframeSrc === 'https://docs.google.com/document/d/1LqGI0yQttBau_vQETBBbQpTDmGEJHB8Crg79C_5XgkI/preview',
  `rules.html embeds the correct Doc preview URL (got ${iframeSrc})`
);
const fallbackHref = await page.$eval('.doc-fallback-link a', (el) => el.getAttribute('href'));
assert(fallbackHref?.includes('1LqGI0yQttBau_vQETBBbQpTDmGEJHB8Crg79C_5XgkI'), 'fallback "open doc directly" link points at the right doc');

await browser.close();
server.close();

if (failed) {
  console.error('\nE2E TEST FAILED');
  process.exit(1);
} else {
  console.log('\nAll E2E checks passed.');
}
