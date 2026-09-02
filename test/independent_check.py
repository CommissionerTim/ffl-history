"""
Independent cross-check of the JS calc.js output, written from scratch in
pandas (not sharing any code with calc.js) against the same fixture CSVs.
If this and calc_output.json (produced by run_calc.mjs) don't agree, that's
a real bug to chase down before trusting either one.
"""
import glob
import json
import os

import pandas as pd

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")

frames = []
for path in sorted(glob.glob(os.path.join(FIXTURES, "*.csv"))):
    year = int(os.path.basename(path).replace(".csv", ""))
    df = pd.read_csv(path)
    df["Year"] = year
    frames.append(df)

all_rows = pd.concat(frames, ignore_index=True)
all_rows["Manager"] = all_rows["Manager"].str.strip()
all_rows["ManagerKey"] = all_rows["Manager"].str.lower()

# Per-year last place (max Final Standing that year) and reg-season leader(s)
all_rows["RegDenom"] = all_rows["Reg Season W"] + all_rows["Reg Season L"] + all_rows["Reg Season T"]
all_rows["RegWinPct"] = (all_rows["Reg Season W"] + 0.5 * all_rows["Reg Season T"]) / all_rows["RegDenom"]
all_rows["PPG"] = all_rows["Points Scored"] / all_rows["RegDenom"]

last_place_by_year = all_rows.groupby("Year")["Final Standing"].max()
all_rows["IsLastPlace"] = all_rows.apply(lambda r: r["Final Standing"] == last_place_by_year[r["Year"]], axis=1)

# "#1 regular-season finish": best win% that year; ties broken by points
# scored that year; still tied -> alphabetically. Resolves to exactly one
# manager per year.
def reg_season_leader_key(year_df):
    best_pct = year_df["RegWinPct"].max()
    tied = year_df[(year_df["RegWinPct"] - best_pct).abs() < 1e-9]
    tied = tied.sort_values(["Points Scored", "Manager"], ascending=[False, True])
    return tied.iloc[0]["ManagerKey"]

leader_key_by_year = {year: reg_season_leader_key(g) for year, g in all_rows.groupby("Year")}
all_rows["IsRegSeasonFirst"] = all_rows.apply(lambda r: r["ManagerKey"] == leader_key_by_year[r["Year"]], axis=1)

# Career aggregation
careers = all_rows.groupby("ManagerKey").agg(
    seasonsPlayed=("Year", "count"),
    regW=("Reg Season W", "sum"),
    regL=("Reg Season L", "sum"),
    regT=("Reg Season T", "sum"),
    playoffW=("Playoff W", "sum"),
    playoffL=("Playoff L", "sum"),
    careerPointsScored=("Points Scored", "sum"),
    championships=("Final Standing", lambda s: (s == 1).sum()),
    championshipAppearances=("Final Standing", lambda s: (s <= 2).sum()),
    lastPlaceFinishes=("IsLastPlace", "sum"),
    regSeasonFirsts=("IsRegSeasonFirst", "sum"),
    avgFinalStanding=("Final Standing", "mean"),
    avgMoves=("Moves", "mean"),
).reset_index()
careers["regWinPct"] = (careers["regW"] + 0.5 * careers["regT"]) / (careers["regW"] + careers["regL"] + careers["regT"])
careers["playoffDenom"] = careers["playoffW"] + careers["playoffL"]
careers["playoffWinPct"] = careers.apply(
    lambda r: (r["playoffW"] / r["playoffDenom"]) if r["playoffDenom"] > 0 else None, axis=1
)

careers = careers.sort_values("ManagerKey")

with open(os.path.join(os.path.dirname(__file__), "calc_output.json")) as f:
    js_out = json.load(f)
js_careers = {c["managerKey"]: c for c in js_out["careers"]}

print("=== CAREER TOTALS: pandas vs calc.js ===")
mismatches = 0
for _, row in careers.iterrows():
    key = row["ManagerKey"]
    js = js_careers.get(key)
    if js is None:
        print(f"MISMATCH: {key} missing from JS output")
        mismatches += 1
        continue
    checks = [
        ("seasonsPlayed", row["seasonsPlayed"], js["seasonsPlayed"]),
        ("regW", row["regW"], js["regW"]),
        ("regL", row["regL"], js["regL"]),
        ("regT", row["regT"], js["regT"]),
        ("playoffW", row["playoffW"], js["playoffW"]),
        ("playoffL", row["playoffL"], js["playoffL"]),
        ("championships", row["championships"], js["championships"]),
        ("championshipAppearances", row["championshipAppearances"], js["championshipAppearances"]),
        ("lastPlaceFinishes", row["lastPlaceFinishes"], js["lastPlaceFinishes"]),
        ("regSeasonFirsts", row["regSeasonFirsts"], js["regSeasonFirsts"]),
    ]
    for name, py_val, js_val in checks:
        if py_val != js_val:
            print(f"MISMATCH {key}.{name}: pandas={py_val} js={js_val}")
            mismatches += 1
    for name, py_val, js_val in [
        ("careerPointsScored", row["careerPointsScored"], js["careerPointsScored"]),
        ("avgFinalStanding", row["avgFinalStanding"], js["avgFinalStanding"]),
        ("avgMoves", row["avgMoves"], js["avgMoves"]),
        ("regWinPct", row["regWinPct"], js["regWinPct"]),
    ]:
        if abs(py_val - js_val) > 1e-6:
            print(f"MISMATCH {key}.{name}: pandas={py_val} js={js_val}")
            mismatches += 1
    py_playoff = row["playoffWinPct"]
    js_playoff = js["playoffWinPct"]
    if (py_playoff is None) != (js_playoff is None):
        print(f"MISMATCH {key}.playoffWinPct: pandas={py_playoff} js={js_playoff}")
        mismatches += 1
    elif py_playoff is not None and abs(py_playoff - js_playoff) > 1e-6:
        print(f"MISMATCH {key}.playoffWinPct: pandas={py_playoff} js={js_playoff}")
        mismatches += 1

print(f"\n{mismatches} mismatches found across {len(careers)} managers.\n")

print("=== Personal single-season bests/worsts: pandas vs calc.js ===")
personal_mismatches = 0
for key, g in all_rows.groupby("ManagerKey"):
    js = js_careers.get(key)
    if js is None:
        continue

    # Best/worst single-season record by RegWinPct; ties broken by more (or
    # fewer, for worst) regular-season wins, then earliest year.
    best_row = g.sort_values(
        ["RegWinPct", "Reg Season W", "Year"], ascending=[False, False, True]
    ).iloc[0]
    worst_row = g.sort_values(
        ["RegWinPct", "Reg Season W", "Year"], ascending=[True, True, True]
    ).iloc[0]

    js_best = js["bestRecord"]
    if js_best is None or best_row["Year"] != js_best["year"] or best_row["Reg Season W"] != js_best["regW"] or best_row["Reg Season L"] != js_best["regL"] or best_row["Reg Season T"] != js_best["regT"]:
        print(f"MISMATCH {key}.bestRecord: pandas={best_row[['Year','Reg Season W','Reg Season L','Reg Season T']].to_dict()} js={js_best}")
        personal_mismatches += 1

    js_worst = js["worstRecord"]
    if js_worst is None or worst_row["Year"] != js_worst["year"] or worst_row["Reg Season W"] != js_worst["regW"] or worst_row["Reg Season L"] != js_worst["regL"] or worst_row["Reg Season T"] != js_worst["regT"]:
        print(f"MISMATCH {key}.worstRecord: pandas={worst_row[['Year','Reg Season W','Reg Season L','Reg Season T']].to_dict()} js={js_worst}")
        personal_mismatches += 1

    # Best single-season PPG; ties broken by earliest year.
    g_ppg = g.dropna(subset=["PPG"]).sort_values(["PPG", "Year"], ascending=[False, True])
    js_ppg = js["bestPPGSeason"]
    if len(g_ppg):
        r = g_ppg.iloc[0]
        if js_ppg is None or r["Year"] != js_ppg["year"] or abs(r["PPG"] - js_ppg["ppg"]) > 1e-6:
            print(f"MISMATCH {key}.bestPPGSeason: pandas={r[['Year','PPG']].to_dict()} js={js_ppg}")
            personal_mismatches += 1
    elif js_ppg is not None:
        print(f"MISMATCH {key}.bestPPGSeason: pandas=None js={js_ppg}")
        personal_mismatches += 1

    # Best single-week score ever; ties broken by earliest year. Managers
    # with no recorded single-week score in any of their years should end
    # up null on both sides, not 0.
    g_week = g.dropna(subset=["Highest Single Week Score"]).sort_values(
        ["Highest Single Week Score", "Year"], ascending=[False, True]
    )
    js_week = js["bestSingleWeek"]
    if len(g_week):
        r = g_week.iloc[0]
        if js_week is None or r["Year"] != js_week["year"] or abs(r["Highest Single Week Score"] - js_week["value"]) > 1e-6:
            print(f"MISMATCH {key}.bestSingleWeek: pandas={r[['Year','Highest Single Week Score']].to_dict()} js={js_week}")
            personal_mismatches += 1
    elif js_week is not None:
        print(f"MISMATCH {key}.bestSingleWeek: pandas=None js={js_week}")
        personal_mismatches += 1

print(f"\n{personal_mismatches} personal-best/worst mismatches found across {len(careers)} managers.\n")

print("=== 2023 regular-season-first tie check ===")
print(all_rows[all_rows["Year"] == 2023][["Manager", "Reg Season W", "Reg Season L", "RegWinPct", "IsRegSeasonFirst"]])

print("\n=== Record book (pandas) ===")
print("Highest single week:", all_rows.loc[all_rows["Highest Single Week Score"].idxmax()][["Manager", "Year", "Highest Single Week Score"]].to_dict() if all_rows["Highest Single Week Score"].notna().any() else None)
print("Most championships:", careers.loc[careers["championships"] == careers["championships"].max(), ["ManagerKey", "championships"]].to_dict("records"))
print("Most regular season wins:", careers.loc[careers["regW"] == careers["regW"].max(), ["ManagerKey", "regW"]].to_dict("records"))
print("Most reg season firsts:", careers.loc[careers["regSeasonFirsts"] == careers["regSeasonFirsts"].max(), ["ManagerKey", "regSeasonFirsts"]].to_dict("records"))
print("Most last place:", careers.loc[careers["lastPlaceFinishes"] == careers["lastPlaceFinishes"].max(), ["ManagerKey", "lastPlaceFinishes"]].to_dict("records"))
best_ppg_idx = all_rows["PPG"].idxmax()
print("Best season PPG:", all_rows.loc[best_ppg_idx][["Manager", "Year", "PPG"]].to_dict())

print("\n=== Record book (calc.js) ===")
print(json.dumps(js_out["recordBook"], indent=2))
