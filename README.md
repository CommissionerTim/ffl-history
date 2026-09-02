# League Record Book

A static site that reads the league's Google Sheet directly (as CSV, at page-load
time) and computes all-time standings and records with plain, deterministic
JavaScript — nothing here is estimated or hand-typed.

## Pages

- `index.html` — All-Time Records: career totals (sortable) + the record book.
- `season.html` — Stats by Season: pick a year, see that year's full standings (sortable).

Both pages are behind a simple shared-password gate (`assets/auth.js`). It's
client-side only — good enough to keep the site out of casual/search reach, not
real security.

## Day-to-day maintenance

**Adding a new season:** duplicate the TEMPLATE tab in the Sheet as usual, fill
it in, then add the year to the `YEARS` array in `config.js`. That's the only
code change needed — both pages re-fetch the sheet on every page load.

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

## Extending the site later

The header/nav in `index.html` and `season.html` is deliberately plain so you
can drop in more static pages later (Hall of Fame, Maid Quarters, League
Rules) and just add matching `<a href="...">` links to `nav.site-nav` — they'll
pick up the same styling automatically. Those pages don't need any of the
data-fetching machinery here unless you want them to.

## Local testing

```
cd test
npm install
node run_calc.mjs          # prints computed leaderboard as JSON
python3 independent_check.py   # cross-checks it independently
node e2e.mjs                # full browser test of the real site files
```
