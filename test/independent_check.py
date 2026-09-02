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

print("=== 2023 regular-season-first tie check ===")
print(all_rows[all_rows["Year"] == 2023][["Manager", "Reg Season W", "Reg Season L", "RegWinPct", "IsRegSeasonFirst"]])

print("\n=== Record book (pandas) ===")
print("Highest single week:", all_rows.loc[all_rows["Highest Single Week Score"].idxmax()][["Manager", "Year", "Highest Single Week Score"]].to_dict() if all_rows["Highest Single Week Score"].notna().any() else None)
print("Most championships:", careers.loc[careers["championships"] == careers["championships"].max(), ["ManagerKey", "championships"]].to_dict("records"))
print("Most reg season firsts:", careers.loc[careers["regSeasonFirsts"] == careers["regSeasonFirsts"].max(), ["ManagerKey", "regSeasonFirsts"]].to_dict("records"))
print("Most last place:", careers.loc[careers["lastPlaceFinishes"] == careers["lastPlaceFinishes"].max(), ["ManagerKey", "lastPlaceFinishes"]].to_dict("records"))
best_ppg_idx = all_rows["PPG"].idxmax()
print("Best season PPG:", all_rows.loc[best_ppg_idx][["Manager", "Year", "PPG"]].to_dict())

print("\n=== Record book (calc.js) ===")
print(json.dumps(js_out["recordBook"], indent=2))
