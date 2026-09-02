// photo-pages-data.js — hand-maintained data for the Hall of Fame and Maid
// Quarters pages. This is the ONLY file you need to touch to update either
// page: add a year, a team name, and drop the matching photo into
// photos/hall-of-fame/ or photos/maid-quarters/ (named "<year>.jpg" or
// "<year>.png" — match the `photo` filename below to whatever you dropped).
//
// The manager's name is never typed here — both pages look it up live from
// the Sheet (Final Standing 1 for Hall of Fame, the year's last place for
// Maid Quarters), so it can never drift out of sync with the rest of the
// site.

// One entry per year. teamName: '' until you fill it in — the card will
// just show a blank team-name line until then.
export const HALL_OF_FAME = [
  { year: 2025, teamName: '', photo: '2025.jpg' },
  { year: 2024, teamName: '', photo: '2024.jpg' },
  { year: 2023, teamName: '', photo: '2023.jpg' },
  { year: 2022, teamName: '', photo: '2022.jpg' },
  { year: 2021, teamName: '', photo: '2021.jpg' },
  { year: 2020, teamName: '', photo: '2020.jpg' },
  { year: 2019, teamName: '', photo: '2019.jpg' },
  { year: 2018, teamName: '', photo: '2018.jpg' },
  { year: 2017, teamName: '', photo: '2017.jpg' },
  { year: 2016, teamName: '', photo: '2016.jpg' },
  { year: 2015, teamName: '', photo: '2015.jpg' },
];

// Maid Quarters doesn't go back to the start of the league — only list the
// years you actually have a photo + team name for. Add a line here (and
// drop the photo in photos/maid-quarters/) whenever a new one happens.
export const MAID_QUARTERS = [
  // { year: 2023, teamName: '', photo: '2023.jpg' },
];
