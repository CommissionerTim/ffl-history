# League Record Book

A static site that reads the league's Google Sheet directly (as CSV, at page-load
time) and computes all-time standings and records with plain, deterministic
JavaScript — nothing here is estimated or hand-typed.

## Pages

- `index.html` — All-Time Records: career totals (sortable) + the record book.
  The career table's columns include each manager's personal single-season
  bests/worsts: Best/Worst Single-Season Record (by regular-season win%),
  Highest Scoring Season (best single-season points/game), Highest
  Single-Week Score, Highest Points-Against/Game, Highest Single-Season
  Z-Score, and Luckiest/Unluckiest Season (see "Advanced stats" below). A
  manager with no recorded weekly high in any season shows "—" there,
  never "0.00".
- `season.html` — Season Stats: pick a year, see that year's full standings
  (sortable), including Z-score, Pythagorean win expectation, and win%
  over/under Pythagorean expectation for that season (see "Advanced stats").
- `hall-of-fame.html` — one photo card per year's champion.
- `maid-quarters.html` — one photo card per year's last-place finisher (only for years you've added).
- `rules.html` — the league's custom rules, pulled live from a Google Doc.

All five pages are behind a simple shared-password gate (`assets/auth.js`). It's
client-side only — good enough to keep the site out of casual/search reach, not
real security.

## Day-to-day maintenance

**Adding a new season:** duplicate the TEMPLATE tab in the Sheet as usual, fill
it in, then add the year to the `YEARS` array in `config.js`. That's the only
code change needed — every page re-fetches the sheet on every page load.

**Adding a Hall of Fame / Maid Quarters entry:** drop the photo (2:3 portrait)
into `photos/hall-of-fame/` or `photos/maid-quarters/`, named `<year>.jpg` (or
`.png` — just match the extension), then add a line for that year to
`photo-pages-data.js` with the team name and the photo filename. The
manager's name is never typed there — both pages look it up live from the
Sheet (Final Standing 1 for Hall of Fame, that year's last place for Maid
Quarters), so it can't drift out of sync with the rest of the site. A card
whose photo hasn't been dropped in yet just shows "Photo coming soon"
instead of a broken image.

**Editing the league rules:** just edit the Google Doc — the page re-fetches
it live on every load, no site change needed. To point it at a different
doc, change `RULES_DOC_ID` in `config.js`.

**Changing the password:** open `hash-password.html` in a browser (don't need
to deploy it anywhere, just open the file), type the new password, copy the
hash it prints, and paste it as `PASSWORD_HASH` in `config.js`.

**Changing the site title:** edit `SITE_TITLE` in `config.js`.

## How the numbers are computed

All cross-year math lives in `assets/calc.js` — a small module with no DOM or
network code, so it's easy to read top to bottom and to unit-test. `/test` has
the test suite that was used to verify it against the real sheet data before
this site shipped:

- `test/run_calc.mjs` runs `calc.js` against real fixture CSVs pulled from the sheet.
- `test/independent_check.py` recomputes the same numbers from scratch in
  pandas (no shared code with calc.js) and diffs them — this is what caught
  or ruled out bugs before launch.
- `test/e2e.mjs` drives an actual browser against the real site files (with
  the Google Sheets fetch mocked to the same fixture data) to check the
  password gate, data loading, record book, and sorting all work together.

### One judgment call worth knowing about

"Most #1 regular-season finishes" (and each manager's individual count of
these) is **not** the same as the sheet's `Final Standing` column — Final
Standing reflects the outcome *after* playoffs, so a manager can have the
best regular-season record and still not finish #1 overall (or vice versa).
This stat is computed by ranking regular-season win% within each year, with
ties broken by points scored that year (higher wins), and — in the
practically-impossible event of a tie on both — alphabetically as a last
resort. See `regSeasonLeaderForYear` in `calc.js`.

In the 2023 season, Ethan and Ben tied exactly at 9-4. Ben scored more
points that year (1876.12 vs. 1562.85), so Ben is credited with the 2023
#1 regular-season finish.

### Advanced stats (Season Stats + career-table columns)

Each has a hover "ⓘ" next to its column header on the site itself with a
plain-language explainer; here's the exact math:

- **Pythagorean win expectation** — `PF^2.37 / (PF^2.37 + PA^2.37)`, the win%
  a record "should" be based only on points scored (PF) vs. points allowed
  (PA), independent of actual wins/losses. 2.37 is the commonly-cited
  football-tuned exponent (vs. baseball's traditional 2), from Football
  Outsiders' research on the NFL. See `pythagoreanWinPct` in `calc.js`.
- **Win% over/under Pythagorean** — actual regular-season win% minus
  Pythagorean win%. Positive means a manager won more than their scoring
  predicted (lucky matchups/timing); negative means they won less.
- **Z-score (points scored)** — how many standard deviations above or below
  that *season's own* league mean a manager's points scored were, using the
  population standard deviation (a season's rows are the whole league that
  year, not a sample of it). 0 = exactly average.
- **Luck Index** — `Points Scored Rank (that season) − Final Standing (that
  season)`, where Points Scored Rank is 1 for the most points scored that
  year. Positive = finished better than their scoring alone would predict
  (lucky); negative = finished worse (unlucky). "Luckiest/Unluckiest Season"
  on the career table is each manager's single best/worst Luck Index, with
  the year it happened.

All four are cross-checked at the individual manager-season level (not just
in aggregate) against an independent pandas recomputation in
`test/independent_check.py` — 0 mismatches across every manager-year before
this shipped.

## Extending the site later

The header/nav is deliberately plain, repeated on every page, so you can drop
in more static pages later and just add a matching `<a href="...">` link to
`nav.site-nav` on every page — it'll pick up the same styling automatically.

## Local testing

```
cd test
npm install
node run_calc.mjs          # prints computed leaderboard as JSON
python3 independent_check.py   # cross-checks it independently
node e2e.mjs                # full browser test of the real site files
```
