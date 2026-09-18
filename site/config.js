// config.js — the only file you should need to touch for day-to-day changes.

export const SHEET_ID = '1vboMleUSkzw-nwNQ7fpU5sOoabryFmTueK1BsiQ5KDI';

// One entry per year-tab in the sheet. Add the new year here each season
// (must exactly match the tab name).
export const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

export const SITE_TITLE = 'League Record Book';

// Sheet tab name for freeform, hand-entered "other records" (e.g. "Most
// drinks consumed at the draft"). Columns: "Record Name", "Record Value",
// "Record Holder". Each row becomes its own card on the All-Time Records
// page, appended after the computed record-book cards, in the exact same
// format. Add or remove rows on the sheet any time — no site change
// needed. If this tab doesn't exist yet (or gets renamed), those extra
// cards are just silently skipped rather than breaking the page.
export const OTHER_RECORDS_TAB = 'Other Records';

// Sheet tab name for the freeform, hand-entered draft history (one row per
// draft: "Year", "Location", "Recap"). Powers the Draft History page. Add
// or edit rows on the sheet any time — no site change needed. "Year" may
// be left blank for a draft that predates organized year-by-year records
// (it'll still show, just without a year in its heading, sorted after
// every dated entry). If this tab doesn't exist yet (or gets renamed), the
// page shows an error banner rather than a blank page — to rename the tab,
// update DRAFT_HISTORY_TAB below to match.
export const DRAFT_HISTORY_TAB = 'Draft History';

// Google Doc ID for the League Rules page (fetched live and reformatted in
// the site's own style — edits to the doc show up on next page load, no
// site change needed). Doc must be shared as "Anyone with the link" can view.
export const RULES_DOC_ID = '1LqGI0yQttBau_vQETBBbQpTDmGEJHB8Crg79C_5XgkI';

// Sheet tab name for the freeform, hand-entered Hall of Fame detail: one
// column per year, rows for "Year" / "Champion" / "Team Name" / "Championship
// Starting Lineup" (that last cell is a newline-separated list of "POSITION:
// Player Name" lines). Only the lineup is actually used by the site — the
// Champion/Team Name rows are Tim's own cross-check copy of data the site
// already gets live from the season tabs and photo-pages-data.js, so this
// tab is never treated as authoritative for those two. Powers the
// expandable lineup on each Hall of Fame card and the "Most Appearances in
// a Championship Lineup" All-Time Records card. Optional and hand-maintained
// — if this tab doesn't exist yet (or gets renamed), those two features are
// silently skipped rather than breaking their pages.
export const HALL_OF_FAME_LINEUPS_TAB = 'Hall of Fame';

// SHA-256 hex digest of the shared password. Never store the real password
// as plain text here. To change it later: open hash-password.html (not
// linked in the site nav), type the new password, and paste the hash it
// gives you below.
export const PASSWORD_HASH = '11d510e067d2cdcd7559bd86d27a2f4c20babd43670346b97af99b522c1f0075';
