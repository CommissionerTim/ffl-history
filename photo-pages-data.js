// photo-pages-data.js — hand-maintained data for the Hall of Fame and Maid
// Quarters pages. This is the ONLY file you need to touch to update either
// page: add a year, a team name (Hall of Fame only), and drop the matching
// photo into photos/hall-of-fame/ or photos/maid-quarters/ — `photo` below
// must match the filename you dropped exactly (spaces and all are fine).
//
// The manager's name is never typed here — both pages look it up live from
// the Sheet (Final Standing 1 for Hall of Fame, the year's last place for
// Maid Quarters), so it can never drift out of sync with the rest of the
// site.

// One entry per year. teamName is pulled from each year's championship
// photo filename ("<year> - <team name>.<ext>").
export const HALL_OF_FAME = [
  { year: 2025, teamName: 'maidbait', photo: '2025 - maidbait.png' },
  { year: 2024, teamName: 'babys second league', photo: '2024 - babys second league.png' },
  { year: 2023, teamName: 'BACK 2 BACK', photo: '2023 - BACK 2 BACK.png' },
  { year: 2022, teamName: 'Corrupt Commissioner', photo: '2022 - Corrupt Commissioner.png' },
  { year: 2021, teamName: 'The Pretty Boys', photo: '2021 - The Pretty Boys.png' },
  { year: 2020, teamName: 'Jason Exotica', photo: '2020 - Jason Exotica.png' },
  { year: 2019, teamName: 'In Lamar I Trust', photo: '2019 - In Lamar I Trust.png' },
  { year: 2018, teamName: '52 Shades of Clay', photo: '2018 - 52 Shades of Clay.png' },
  { year: 2017, teamName: 'JAKE PAUL DAB SLUTS', photo: '2017 - JAKE PAUL DAB SLUTS.png' },
  { year: 2016, teamName: 'RealD 3D -fences', photo: '2016 - RealD 3D -fences.png' },
  { year: 2015, teamName: 'Waiver Wired', photo: '2015 - Waiver Wired.png' },
];

// Maid Quarters doesn't go back to the start of the league — only list the
// years you actually have a photo for. No team names here by design (just
// year + manager name on this page). Add a line here (and drop the photo in
// photos/maid-quarters/) whenever a new one happens.
export const MAID_QUARTERS = [
  { year: 2025, photo: '2025.png' },
  { year: 2024, photo: '2024.png' },
  { year: 2023, photo: '2023.png' },
  { year: 2022, photo: '2022.png' },
  { year: 2021, photo: '2021.png' },
  { year: 2020, photo: '2020.png' },
  { year: 2019, photo: '2019.png' },
  { year: 2018, photo: '2018.png' },
];
