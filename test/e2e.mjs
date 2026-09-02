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

await page.fill('.auth-box input[type=password]', 'f00tball');
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

// Sorting: click "Championships" header, confirm Tim (3) sorts to top in descending order.
await page.click(`#career-table thead th:nth-child(${champIndex + 1})`); // ascending first
await page.click(`#career-table thead th:nth-child(${champIndex + 1})`); // then descending
const topManagerAfterSort = await page.$eval('#career-table tbody tr:first-child td:first-child', (td) => td.textContent);
assert(topManagerAfterSort === 'Tim', `sorting by Championships desc puts Tim first (got ${topManagerAfterSort})`);

// Page titles / nav labels reflect the renamed pages.
assert((await page.title()).includes('All-Time Records'), 'index.html title includes "All-Time Records"');
const navText = await page.$$eval('nav.site-nav a', (as) => as.map((a) => a.textContent));
assert(navText.includes('All-Time Records') && navText.includes('Stats by Season'), `nav shows renamed labels (got ${navText})`);

// ---- season.html: gate should already be unlocked (same session) ----
await page.goto(`${baseUrl}/season.html`);
const gateVisible = await page.$('.auth-box');
assert(gateVisible === null, 'season.html does not re-prompt within the same session');

assert((await page.title()).includes('Stats by Season'), 'season.html title includes "Stats by Season"');

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

await browser.close();
server.close();

if (failed) {
  console.error('\nE2E TEST FAILED');
  process.exit(1);
} else {
  console.log('\nAll E2E checks passed.');
}
