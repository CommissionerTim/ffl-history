import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = '/home/claude/ffl/site';
const fixturesDir = '/home/claude/ffl/test/fixtures';
const outDir = '/home/claude/ffl/screenshots';
fs.mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg':'image/jpeg', '.png':'image/png' };

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

async function shootPage(name, urlPath, viewport, extraWait, afterAuth) {
  const page = await browser.newContext({ viewport }).then(c => c.newPage());

  // This sandbox's network policy blocks cdnjs.cloudflare.com outbound, so
  // for the test only, serve the same PapaParse build from the local npm
  // package instead. The real deployed site still loads it from cdnjs.
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/**', async (route) => {
    const local = fs.readFileSync(path.join(__dirname, 'node_modules/papaparse/papaparse.min.js'));
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: local });
  });

  // Mock the Google Sheets gviz CSV endpoint with the real fixture data —
  // same fixtures/pattern e2e.mjs uses, so these screenshots show real
  // computed content (including the new Hall of Fame lineups) instead of
  // an empty/error state.
  await page.route('https://docs.google.com/spreadsheets/**', async (route) => {
    const url = new URL(route.request().url());
    const sheet = url.searchParams.get('sheet');
    const fixturePath = path.join(fixturesDir, `${sheet}.csv`);
    if (fs.existsSync(fixturePath)) {
      await route.fulfill({ status: 200, contentType: 'text/csv', body: fs.readFileSync(fixturePath) });
    } else {
      await route.fulfill({ status: 404, body: 'no fixture' });
    }
  });

  // Mock the Google Doc export endpoint rules.js fetches (rules.html only).
  await page.route('https://docs.google.com/document/**/export**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: fs.readFileSync(path.join(fixturesDir, 'rules-doc.html')),
    });
  });

  await page.goto(`${baseUrl}/${urlPath}`);
  await page.waitForTimeout(300);
  const passInput = await page.$('.auth-box input');
  if (passInput) {
    await passInput.fill('corrupt');
    await page.click('.auth-box button');
    await page.waitForTimeout(extraWait || 800);
  } else {
    await page.waitForTimeout(extraWait || 800);
  }
  if (afterAuth) await afterAuth(page);
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
  await page.close();
}

// index.html is now the Hall of Fame page (site homepage); the record book
// that used to live there moved to its own all-time-records.html.
await shootPage('desktop-hof.png', 'index.html', { width: 1440, height: 900 }, 1200);
// Same page again, but with every "Starting Lineup" panel expanded, so the
// new position-pill UI is actually visible in a screenshot rather than
// just the collapsed toggle buttons.
await shootPage('desktop-hof-expanded.png', 'index.html', { width: 1440, height: 900 }, 1200, async (page) => {
  await page.$$eval('.lineup-toggle', (els) => els.forEach((el) => el.click()));
  await page.waitForTimeout(150);
});
await shootPage('desktop-atr.png', 'all-time-records.html', { width: 1440, height: 900 }, 1000);
await shootPage('desktop-career.png', 'career-stats.html', { width: 1440, height: 900 }, 1000);
await shootPage('desktop-draft.png', 'draft-history.html', { width: 1440, height: 900 }, 1000);
await shootPage('mobile-hof.png', 'index.html', { width: 390, height: 844 }, 1200);
await shootPage('mobile-hof-expanded.png', 'index.html', { width: 390, height: 844 }, 1200, async (page) => {
  await page.$eval('.lineup-toggle', (el) => el.click());
  await page.waitForTimeout(150);
});
await shootPage('mobile-atr.png', 'all-time-records.html', { width: 390, height: 844 }, 1000);
await shootPage('mobile-career.png', 'career-stats.html', { width: 390, height: 844 }, 1000);

await browser.close();
server.close();
console.log('done');
