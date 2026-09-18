# League Record Book

A static site that reads the league's Google Sheet directly (as CSV, at page-load
time) and computes all-time standings and records with plain, deterministic
JavaScript. The deliberate exceptions are the "Other Records" and "Draft
History" tabs (see below) — freeform, hand-typed content, passed through
verbatim — everything else is computed, never estimated or hand-typed.

## Pages

- `index.html` — the site's homepage: Hall of Fame, one photo card per
  year's champion, manager's name looked up live from the sheet. Each card
  has an expandable "Starting Lineup" section (collapsed by default) showing
  that year's championship starting lineup — position pills (QB, RB, WR,
  TE, FLEX, D/ST, K — no colon) next to each player's name — pulled from the
  sheet's "Hall of Fame" tab (see "Day-to-day maintenance"). A year with no
  lineup entered on that tab just gets no expandable section.
- `all-time-records.html` — All-Time Records: the record book (21 computed
  cards, one extreme/leader stat per card, ties shown as multiple holders —
  see "Advanced stats" below for how the Z-score/luck/playoff-driven ones
  are computed), plus any freeform cards from the sheet's "Other Records"
  tab appended after them in the same format (see "Day-to-day
  maintenance"). The 4 cards whose stat also appears as a column on
  Career/Season Stats (Luckiest/Unluckiest season ever, Best/Worst
  single-season Z-score) carry the same hover "ⓘ" explainer as that column.
  "Most Chat Ragequits" and "Most Chat Ragequits, Single Season" are
  computed from the sheet's "Chat Ragequits" column (see below) the same
  way every other computed card is — not to be confused with the unrelated,
  hand-typed "Other Records" entry that predates this column, if one still
  exists on your sheet. "Most Appearances by a Single Player in
  Championship Lineups" is the one card computed from the "Hall of Fame"
  tab's lineup data rather than the season tabs (D/ST and unfilled slots
  never count) — it just doesn't appear if that tab doesn't exist yet.
- `career-stats.html` — Career Stats: the full sortable career-totals table.
  A toggle above the table switches between "All Managers" (every manager
  who's ever played, the default) and "Active Managers" (only whoever has a
  row in the most recently loaded season — see `YEARS` in `config.js`).
  This is a display filter only: it never changes any manager's computed
  totals, just which rows show. The Manager column is frozen (sticky) so it
  stays in view while scrolling horizontally through the table's many
  columns. Columns include each manager's personal single-season
  bests/worsts:
  Best/Worst Single-Season Record (by regular-season win%), Highest Scoring
  Season (best single-season points/game), Highest Single-Week Score,
  Highest Points-Against/Game, Highest/Lowest Single-Season Z-Score,
  All-Time Average Z-Score, % of Playoff Seasons, and Luckiest/Unluckiest
  Season (see "Advanced stats" below), plus career Chat Ragequits totals
  (see below). A manager with no recorded weekly high in any season shows
  "—" there, never "0.00". Every stat built from the Playoff W/L columns
  (Playoff W, Playoff L, Playoff Win%, % of Playoff Seasons here; Highest
  career playoff win% and Most career playoff wins on All-Time Records)
  carries a hover "ⓘ" noting that playoff record does not include play-in
  games — see "Play-in games" below.
- `season.html` — Season Stats: pick a year, see that year's full standings
  (sortable), including Z-score, Pythagorean win expectation, and win%
  over/under Pythagorean expectation for that season (see "Advanced stats"),
  plus that year's raw Chat Ragequits count per manager.
- `maid-quarters.html` — one photo card per year's last-place finisher (only for years you've added).
- `draft-history.html` — Draft History: one write-up per draft, newest
  first, pulled straight from the sheet's "Draft History" tab (see
  "Day-to-day maintenance" below) — freeform and hand-typed, like Other
  Records, never computed.
- `rules.html` — the league's custom rules, pulled live from a Google Doc.

All seven pages are behind a simple shared-password gate (`assets/auth.js`). It's
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

**Adding/editing a Hall of Fame starting lineup:** on the sheet's "Hall of
Fame" tab (one column per year, rows labeled "Year" / "Champion" / "Team
Name" / "Championship Starting Lineup"), fill in that year's "Championship
Starting Lineup" cell as one line per roster spot: `POSITION: Player Name`
(e.g. `QB: Patrick Mahomes`), one line per Enter/newline within the cell. A
spot that genuinely wasn't filled that year can read `TE: [empty]` — it
still shows on the card, just styled as empty. Multiple lines with the same
position (e.g. two `QB:` lines, two `FLEX:` lines) are fine and expected in
years with 2 flex/2-QB rosters. The "Champion" and "Team Name" rows on this
tab are just Tim's own cross-check copy — the site never actually reads
them, since it already gets that data live from the season tabs and
`photo-pages-data.js`; only the "Championship Starting Lineup" row feeds
the site (the expandable section on Hall of Fame, and the "Most
Appearances" card on All-Time Records). If this tab doesn't exist yet (or
gets renamed), both of those quietly don't appear rather than breaking
their pages; to rename the tab, update `HALL_OF_FAME_LINEUPS_TAB` in
`config.js` to match.

**Editing the league rules:** just edit the Google Doc — the page re-fetches
it live on every load, no site change needed. To point it at a different
doc, change `RULES_DOC_ID` in `config.js`.

**Adding an "Other Record" (anecdotal, hand-typed):** on the sheet's "Other
Records" tab, add a row with "Record Name", "Record Value", and "Record
Holder" (e.g. "Most drinks consumed at the draft" / "3" / "Tim"). It shows
up as its own card on the All-Time Records page after the next page load,
appended after the computed cards, in the exact same visual format — no
site change needed. "Record Value" doesn't have to be a number ("Best trade
nickname" / "The Sheep-for-a-Kicker Trade" / "Josh" works fine, as does
"920 Miles" or "6th Round"). "Record Value" and "Record Holder" can each be
left blank independently (a blank one just shows "—" on the card) — handy
for a record whose real content belongs in the other column. Only "Record
Name" is required — a row missing it is skipped rather than shown as a
broken card. Unlike everything else on this site, these values are never
computed or cross-checked — they're exactly what's typed into the sheet.
If the tab gets renamed or deleted, the page just quietly stops showing
those cards (check the browser console for the fetch error) rather than
breaking; to rename the tab,
update `OTHER_RECORDS_TAB` in `config.js` to match.

**Important — keep "Record Value" formatted as Plain Text:** the "Record
Value" column on the "Other Records" tab must have its number format set to
Plain Text (select the column → Format → Number → Plain text in Google
Sheets). This is already set up, so you shouldn't need to touch it — it's
documented here so it stays set if the tab ever gets rebuilt. Without it,
Google's live-CSV export can silently blank out any non-numeric entry in
that column (e.g. "6th Round") the moment the column also contains plain
numbers (e.g. "3") — Sheets' export picks one type for the whole column
based on the mix of values and drops anything that doesn't fit, before the
site ever sees it. This bit the site once already: two real entries ("920
Miles" and "6th Round") were showing up blank on the live page until the
column was set to Plain Text and the values re-saved. Text-formatting the
column sidesteps the issue entirely — plain numbers still display and sort
fine as text on this page, since "Record Value" is never treated as a
number anywhere in the code (see `normalizeOtherRecordsRows` in
`calc.js`).

**Adding a Draft History entry (anecdotal, hand-typed):** on the sheet's
"Draft History" tab, add a row with "Year", "Location", and "Recap" (e.g.
"2029" / "Someone's Backyard | Austin, TX" / "A recap of how the draft
went."). It shows up as its own write-up on the Draft History page after
the next page load, newest year first — no site change needed. Only
"Recap" is required — a row missing it is skipped rather than shown as a
blank entry. "Year" can be left blank for a draft that predates the
league's records; it's shown at the very end of the list, labeled "Before
2015" instead of a year. "Location" can also be left blank (e.g. for a
draft whose venue isn't decided yet) and the page just omits it. Like
"Other Records", these values are never computed or cross-checked —
they're exactly what's typed into the sheet. If the tab gets renamed or
deleted, the page shows its standard error banner rather than silently
breaking; to rename the tab, update `DRAFT_HISTORY_TAB` in `config.js` to
match.

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

Each has a hover "ⓘ" on the site itself (next to the column header on
Season/Career Stats, next to the card label on the record book, where that
stat is also shown there) with a plain-language explainer; here's the exact
math:

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
- **Play-in games** — the sheet's Playoff W/L columns (and everything
  derived from them: Playoff W, Playoff L, Playoff Win%, % of Playoff
  Seasons on Career Stats; Highest career playoff win% and Most career
  playoff wins on the record book) are entered by convention to **exclude**
  play-in games — only games in the actual playoff bracket count. This
  isn't enforced or checked by any code; it's a data-entry convention on
  the sheet itself, which is why every one of those stats carries a hover
  "ⓘ" repeating it as a reminder.
- **Maid Bowl appearances** — how many of a manager's seasons ended with
  them in the bottom two of the final standings (last place or
  second-to-last that year, whatever the league size was that season). See
  `bottomTwoStandingsForYear` in `calc.js`.
- **Chat Ragequits** — a plain count typed into each year-tab's "Chat
  Ragequits" column (0 if it never happened that season, same as Moves —
  never left blank). Nothing fancy: Career Stats shows each manager's career
  total, their single highest-Ragequit season (with the year, ties broken
  by earliest year like every other personal single-season best on this
  site), and their average per season; the record book separately tracks
  the single highest career total and the single highest one-season count,
  league-wide.

All of the above are cross-checked at the individual manager-season level
(not just in aggregate) against an independent pandas recomputation in
`test/independent_check.py` — 0 mismatches across every manager-year before
this shipped. Of the 21 computed record-book cards on `all-time-records.html`,
20 (6 original + 12 added in an earlier round: Most Single-Season Points
Against/Game, Most Career Points, Most Wins/Losses in a Single Season,
Highest Career Playoff Win%, Most Career Playoff Wins, Most Championship
Game Appearances, Most Maid Bowl Appearances, Luckiest/Unluckiest Season
Ever, and Best/Worst Single-Season Z-Score, + 2 added in a later round: Most
Chat Ragequits and Most Chat Ragequits, Single Season) are likewise
cross-checked, value and holder(s), against the same pandas recomputation.
The 21st, "Most Appearances by a Single Player in Championship Lineups", is
computed from the separate, hand-maintained "Hall of Fame" tab rather than
the season tabs, so it isn't part of that pandas cross-check — it was
instead verified directly against the real sheet data (see "Day-to-day
maintenance").

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
