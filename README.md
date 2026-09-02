# League Record Book

A static site that reads the league's Google Sheet directly (as CSV, at page-load
time) and computes all-time standings and records with plain, deterministic
JavaScript — nothing here is estimated or hand-typed.

## Pages

- `index.html` — All-Time Records: the record book only (18 cards, one
  extreme/leader stat per card, ties shown as multiple holders). See
  "Advanced stats" below for how the Z-score/luck/playoff-driven cards
  are computed.
- `career-stats.html` — Career Stats: the full sortable career-totals table.
  Columns include each manager's personal single-season bests/worsts:
  Best/Worst Single-Season Record (by regular-season win%), Highest Scoring
  Season (best single-season points/game), Highest Single-Week Score,
  Highest Points-Against/Game, Highest/Lowest Single-Season Z-Score,
  All-Time Average Z-Score, % of Playoff Seasons, and Luckiest/Unluckiest
  Season (see "Advanced stats" below). A manager with no recorded weekly
  high in any season shows "—" there, never "0.00".
- `season.html` — Season Stats: pick a year, see that year's full standings
  (sortable), including Z-score, Pythagorean win expectation, and win%
  over/under Pythagorean expectation for that season (see "Advanced stats").
- `hall-of-fame.html` — one photo card per year's champion.
- `maid-quarters.html` — one photo card per year's last-place finisher (only for years you've added).
- `rules.html` — the league's custom rules, pulled live from a Google Doc.

All six pages are behind a simple shared-password gate (`assets/auth.js`). It's
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

### Advanced stats (Season Stats + Career Stats columns + record book)

Each has a hover "ⓘ" next to its column header on the site itself with a
plain-language explainer; here's the exact math:

- **Pythagorean win expectation** — `PF^6.1 / (PF^6.1 + PA^6.1)`, the win% a
  record "should" be based only on points scored (PF) vs. points allowed
  (PA), independent of actual wins/losses. The 6.1 exponent is **fit to
  this league's own history**, not borrowed from anywhere: it's the value
  that minimizes squared error between predicted and actual regular-season
  win% across every manager-season on record (`test/fit_pythagorean_exponent.py`,
  a golden-section search — re-run it every season or two to check whether
  it's drifted as more data comes in). This league previously used the
  commonly-cited football-tuned 2.37 (Football Outsiders' research on real
  NFL scoring, vs. baseball's traditional 2), but that's calibrated for
  real NFL team scoring, which is both lower-magnitude and proportionally
  much noisier week-to-week (~45-50% coefficient of variation) than fantasy
  scoring (~18-19% here). A tighter score distribution calls for a steeper
  exponent — fitting directly to our own results roughly halves prediction
  error (mean squared error) versus 2.37. See `pythagoreanWinPct` in
  `calc.js`.
- **Win% over/under Pythagorean** — actual regular-season win% minus
  Pythagorean win%. Positive means a manager won more than their scoring
  predicted (lucky matchups/timing); negative means they won less.
- **Z-score (points scored)** — how many standard deviations above or below
  that *season's own* league mean a manager's points scored were, using the
  population standard deviation (a season's rows are the whole league that
  year, not a sample of it). 0 = exactly average. Career Stats shows each
  manager's best (highest) and worst (lowest) single-season Z-score, plus
  their All-Time Average Z-Score (the mean of their own single-season
  Z-scores across every season played). The record book separately tracks
  the single best and worst Z-score *anyone* has ever posted, league-wide.
- **Luck Index** — `Points Scored Rank (that season) − Final Standing (that
  season)`, where Points Scored Rank is 1 for the most points scored that
  year. Positive = finished better than their scoring alone would predict
  (lucky); negative = finished worse (unlucky). "Luckiest/Unluckiest Season"
  on Career Stats is each manager's single best/worst Luck Index, with the
  year it happened; the record book's "Luckiest/Unluckiest season ever"
  cards are the same, league-wide.
- **% of Playoff Seasons** — the percentage of a manager's seasons in which
  they finished #1-4 in the final standings ("made the playoffs"). Uses
  Final Standing directly, unlike the "#1 regular-season finish" judgment
  call described above.
- **Maid Bowl appearances** — how many of a manager's seasons ended with
  them in the bottom two of the final standings (last place or
  second-to-last that year, whatever the league size was that season). See
  `bottomTwoStandingsForYear` in `calc.js`.

All of the above are cross-checked at the individual manager-season level
(not just in aggregate) against an independent pandas recomputation in
`test/independent_check.py` — 0 mismatches across every manager-year before
this shipped. The 18 record-book cards on `index.html` (6 original + 12
added this round: Most Single-Season Points Against/Game, Most Career
Points, Most Wins/Losses in a Single Season, Highest Career Playoff Win%,
Most Career Playoff Wins, Most Championship Game Appearances, Most Maid
Bowl Appearances, Luckiest/Unluckiest Season Ever, and Best/Worst
Single-Season Z-Score) are likewise cross-checked, value and holder(s),
against the same pandas recomputation.

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
python3 fit_pythagorean_exponent.py   # re-check the fitted exponent as data grows
```
