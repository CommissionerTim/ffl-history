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
    stem = os.path.basename(path).replace(".csv", "")
    if not stem.isdigit():
        continue  # skip non-year fixtures, e.g. "Other Records.csv" (freeform, checked separately below)
    year = int(stem)
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

# Points-against/game, Pythagorean win expectation (football-tuned exponent
# per Football Outsiders), Points Scored Rank (1 = most that year, ties
# share a rank), Z-score (population std within that season), and Luck
# Index (Points Scored Rank - Final Standing).
all_rows["PAGame"] = all_rows["Points Against"] / all_rows["RegDenom"]

PYTHAG_EXP = 6.1  # fit to this league's own history -- see fit_pythagorean_exponent.py
all_rows["PythagWinPct"] = (all_rows["Points Scored"] ** PYTHAG_EXP) / (
    all_rows["Points Scored"] ** PYTHAG_EXP + all_rows["Points Against"] ** PYTHAG_EXP
)

def zscore_group(g):
    mean = g["Points Scored"].mean()
    std = g["Points Scored"].std(ddof=0)  # population std -- a season's rows are the whole league that year
    if pd.isna(std) or std == 0:
        return pd.Series(0.0, index=g.index)
    return (g["Points Scored"] - mean) / std

all_rows["ZScore"] = all_rows.groupby("Year", group_keys=False).apply(zscore_group)
all_rows["PointsScoredRank"] = all_rows.groupby("Year")["Points Scored"].rank(ascending=False, method="min").astype(int)
all_rows["LuckIndex"] = all_rows["PointsScoredRank"] - all_rows["Final Standing"]

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
    careerChatRagequits=("Chat Ragequits", "sum"),
    avgRagequits=("Chat Ragequits", "mean"),
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
        ("careerChatRagequits", row["careerChatRagequits"], js["careerChatRagequits"]),
        ("avgRagequits", row["avgRagequits"], js["avgRagequits"]),
    ]:
        if abs(py_val - js_val) > 1e-6:
            print(f"MISMATCH {key}.{name}: pandas={py_val} js={js_val}")
            mismatches += 1
    py_playoff = row["playoffWinPct"]
    js_playoff = js["playoffWinPct"]
    py_playoff_is_none = py_playoff is None or (isinstance(py_playoff, float) and pd.isna(py_playoff))
    if py_playoff_is_none != (js_playoff is None):
        print(f"MISMATCH {key}.playoffWinPct: pandas={py_playoff} js={js_playoff}")
        mismatches += 1
    elif not py_playoff_is_none and abs(py_playoff - js_playoff) > 1e-6:
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

print("=== Season Stats row-level check: pandas vs calc.js (every manager-year) ===")
js_season_stats = {(s["year"], s["managerKey"]): s for s in js_out["seasonStats"]}
row_mismatches = 0
for _, row in all_rows.iterrows():
    key = (int(row["Year"]), row["ManagerKey"])
    js = js_season_stats.get(key)
    if js is None:
        print(f"MISMATCH {key}: missing from JS seasonStats")
        row_mismatches += 1
        continue
    if pd.notna(row["PythagWinPct"]):
        if js["pythagWinPct"] is None or abs(row["PythagWinPct"] - js["pythagWinPct"]) > 1e-6:
            print(f"MISMATCH {key}.pythagWinPct: pandas={row['PythagWinPct']} js={js['pythagWinPct']}")
            row_mismatches += 1
    elif js["pythagWinPct"] is not None:
        print(f"MISMATCH {key}.pythagWinPct: pandas=NaN js={js['pythagWinPct']}")
        row_mismatches += 1
    if abs(row["ZScore"] - js["zScore"]) > 1e-6:
        print(f"MISMATCH {key}.zScore: pandas={row['ZScore']} js={js['zScore']}")
        row_mismatches += 1
    if int(row["PointsScoredRank"]) != js["pointsScoredRank"]:
        print(f"MISMATCH {key}.pointsScoredRank: pandas={row['PointsScoredRank']} js={js['pointsScoredRank']}")
        row_mismatches += 1
    if int(row["LuckIndex"]) != js["luckIndex"]:
        print(f"MISMATCH {key}.luckIndex: pandas={row['LuckIndex']} js={js['luckIndex']}")
        row_mismatches += 1

print(f"\n{row_mismatches} row-level mismatches found across {len(all_rows)} manager-years.\n")

print("=== Personal PA/Game, Z-score, Luck Index bests: pandas vs calc.js ===")
extra_mismatches = 0
for key, g in all_rows.groupby("ManagerKey"):
    js = js_careers.get(key)
    if js is None:
        continue

    # Highest points-against/game in a single season; ties -> earliest year.
    g_pa = g.dropna(subset=["PAGame"]).sort_values(["PAGame", "Year"], ascending=[False, True])
    js_pa = js["bestPAGame"]
    if len(g_pa):
        r = g_pa.iloc[0]
        if js_pa is None or r["Year"] != js_pa["year"] or abs(r["PAGame"] - js_pa["value"]) > 1e-6:
            print(f"MISMATCH {key}.bestPAGame: pandas={r[['Year','PAGame']].to_dict()} js={js_pa}")
            extra_mismatches += 1
    elif js_pa is not None:
        print(f"MISMATCH {key}.bestPAGame: pandas=None js={js_pa}")
        extra_mismatches += 1

    # Highest single-season Z-score; ties -> earliest year.
    r = g.sort_values(["ZScore", "Year"], ascending=[False, True]).iloc[0]
    js_z = js["bestZScoreSeason"]
    if js_z is None or r["Year"] != js_z["year"] or abs(r["ZScore"] - js_z["value"]) > 1e-6:
        print(f"MISMATCH {key}.bestZScoreSeason: pandas={r[['Year','ZScore']].to_dict()} js={js_z}")
        extra_mismatches += 1

    # Luckiest / unluckiest season (max/min Luck Index); ties -> earliest year.
    r_max = g.sort_values(["LuckIndex", "Year"], ascending=[False, True]).iloc[0]
    r_min = g.sort_values(["LuckIndex", "Year"], ascending=[True, True]).iloc[0]
    js_luckiest = js["luckiestSeason"]
    js_unluckiest = js["unluckiestSeason"]
    if js_luckiest is None or r_max["Year"] != js_luckiest["year"] or r_max["LuckIndex"] != js_luckiest["value"]:
        print(f"MISMATCH {key}.luckiestSeason: pandas={r_max[['Year','LuckIndex']].to_dict()} js={js_luckiest}")
        extra_mismatches += 1
    if js_unluckiest is None or r_min["Year"] != js_unluckiest["year"] or r_min["LuckIndex"] != js_unluckiest["value"]:
        print(f"MISMATCH {key}.unluckiestSeason: pandas={r_min[['Year','LuckIndex']].to_dict()} js={js_unluckiest}")
        extra_mismatches += 1

print(f"\n{extra_mismatches} PA/Z-score/Luck career-best mismatches found across {len(careers)} managers.\n")

print("=== NEW personal per-manager stats: pandas vs calc.js ===")
print("(worstZScoreSeason, avgZScore, pctPlayoffSeasons, maidBowlAppearances)")

# Bottom-two ("Maid Bowl") standings per year: the two largest Final
# Standing values that year (mirrors bottomTwoStandingsForYear in calc.js).
def bottom_two_standings(year_df):
    distinct = sorted(year_df["Final Standing"].unique(), reverse=True)
    return set(distinct[:2])

bottom_two_by_year = {year: bottom_two_standings(g) for year, g in all_rows.groupby("Year")}
all_rows["IsMaidBowl"] = all_rows.apply(lambda r: r["Final Standing"] in bottom_two_by_year[r["Year"]], axis=1)
all_rows["IsPlayoffSeason"] = all_rows["Final Standing"] <= 4

new_personal_mismatches = 0
for key, g in all_rows.groupby("ManagerKey"):
    js = js_careers.get(key)
    if js is None:
        continue

    # Lowest single-season Z-score; ties -> earliest year.
    r_worst_z = g.sort_values(["ZScore", "Year"], ascending=[True, True]).iloc[0]
    js_worst_z = js["worstZScoreSeason"]
    if js_worst_z is None or r_worst_z["Year"] != js_worst_z["year"] or abs(r_worst_z["ZScore"] - js_worst_z["value"]) > 1e-6:
        print(f"MISMATCH {key}.worstZScoreSeason: pandas={r_worst_z[['Year','ZScore']].to_dict()} js={js_worst_z}")
        new_personal_mismatches += 1

    # All-time average Z-score.
    py_avg_z = g["ZScore"].mean()
    js_avg_z = js["avgZScore"]
    if js_avg_z is None or abs(py_avg_z - js_avg_z) > 1e-6:
        print(f"MISMATCH {key}.avgZScore: pandas={py_avg_z} js={js_avg_z}")
        new_personal_mismatches += 1

    # % of seasons finishing #1-4 ("made playoffs").
    py_pct_playoff = g["IsPlayoffSeason"].sum() / len(g)
    js_pct_playoff = js["pctPlayoffSeasons"]
    if js_pct_playoff is None or abs(py_pct_playoff - js_pct_playoff) > 1e-6:
        print(f"MISMATCH {key}.pctPlayoffSeasons: pandas={py_pct_playoff} js={js_pct_playoff}")
        new_personal_mismatches += 1

    # Maid Bowl appearances (bottom-two finishes).
    py_maid_bowl = int(g["IsMaidBowl"].sum())
    js_maid_bowl = js["maidBowlAppearances"]
    if py_maid_bowl != js_maid_bowl:
        print(f"MISMATCH {key}.maidBowlAppearances: pandas={py_maid_bowl} js={js_maid_bowl}")
        new_personal_mismatches += 1

    # Most Chat Ragequits in a single season (personal best); ties -> earliest year.
    r_ragequits = g.sort_values(["Chat Ragequits", "Year"], ascending=[False, True]).iloc[0]
    js_ragequits = js["bestRagequitsSeason"]
    if js_ragequits is None or r_ragequits["Year"] != js_ragequits["year"] or r_ragequits["Chat Ragequits"] != js_ragequits["value"]:
        print(f"MISMATCH {key}.bestRagequitsSeason: pandas={r_ragequits[['Year','Chat Ragequits']].to_dict()} js={js_ragequits}")
        new_personal_mismatches += 1

print(f"\n{new_personal_mismatches} new-personal-stat mismatches found across {len(careers)} managers.\n")

# Fold maidBowlAppearances into the pandas careers frame for the record-book
# cross-checks below.
maid_bowl_by_manager = all_rows.groupby("ManagerKey")["IsMaidBowl"].sum().rename("maidBowlAppearances")
careers = careers.merge(maid_bowl_by_manager, on="ManagerKey", how="left")
manager_display = all_rows.groupby("ManagerKey")["Manager"].agg(lambda s: s.value_counts().idxmax())

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

print("\n=== NEW record-book stats: pandas vs calc.js (with mismatch counts) ===")
rb_mismatches = 0

def check_scalar(label, py_val, js_entry, tol=1e-6):
    global rb_mismatches
    js_val = js_entry["value"]
    py_is_none = py_val is None or (isinstance(py_val, float) and pd.isna(py_val))
    if py_is_none or js_val is None:
        if py_is_none != (js_val is None):
            print(f"MISMATCH {label}.value: pandas={py_val} js={js_val}")
            rb_mismatches += 1
        return
    if abs(py_val - js_val) > tol:
        print(f"MISMATCH {label}.value: pandas={py_val} js={js_val}")
        rb_mismatches += 1

def check_holders(label, py_holders, js_entry):
    global rb_mismatches
    js_holders = sorted(h["manager"] for h in js_entry["holders"])
    py_holders_sorted = sorted(py_holders)
    if py_holders_sorted != js_holders:
        print(f"MISMATCH {label}.holders: pandas={py_holders_sorted} js={js_holders}")
        rb_mismatches += 1

# Most single-season Points Against/Game
_v = all_rows["PAGame"].max()
_h = all_rows.loc[(all_rows["PAGame"] - _v).abs() < 1e-6, "Manager"].tolist()
check_scalar("mostPAGame", _v, js_out["recordBook"]["mostPAGame"])
check_holders("mostPAGame", _h, js_out["recordBook"]["mostPAGame"])

# Most career points
_v = careers["careerPointsScored"].max()
_h = [manager_display[k] for k in careers.loc[(careers["careerPointsScored"] - _v).abs() < 1e-6, "ManagerKey"]]
check_scalar("mostCareerPoints", _v, js_out["recordBook"]["mostCareerPoints"])
check_holders("mostCareerPoints", _h, js_out["recordBook"]["mostCareerPoints"])

# Most wins in a single season
_v = all_rows["Reg Season W"].max()
_h = all_rows.loc[all_rows["Reg Season W"] == _v, "Manager"].tolist()
check_scalar("mostWinsSeason", _v, js_out["recordBook"]["mostWinsSeason"])
check_holders("mostWinsSeason", _h, js_out["recordBook"]["mostWinsSeason"])

# Most losses in a single season
_v = all_rows["Reg Season L"].max()
_h = all_rows.loc[all_rows["Reg Season L"] == _v, "Manager"].tolist()
check_scalar("mostLossesSeason", _v, js_out["recordBook"]["mostLossesSeason"])
check_holders("mostLossesSeason", _h, js_out["recordBook"]["mostLossesSeason"])

# Highest career playoff win%
_v = careers["playoffWinPct"].max()
_h = [manager_display[k] for k in careers.loc[(careers["playoffWinPct"] - _v).abs() < 1e-6, "ManagerKey"]]
check_scalar("highestPlayoffWinPct", _v, js_out["recordBook"]["highestPlayoffWinPct"])
check_holders("highestPlayoffWinPct", _h, js_out["recordBook"]["highestPlayoffWinPct"])

# Most career playoff wins
_v = careers["playoffW"].max()
_h = [manager_display[k] for k in careers.loc[careers["playoffW"] == _v, "ManagerKey"]]
check_scalar("mostPlayoffWins", _v, js_out["recordBook"]["mostPlayoffWins"])
check_holders("mostPlayoffWins", _h, js_out["recordBook"]["mostPlayoffWins"])

# Most championship game appearances
_v = careers["championshipAppearances"].max()
_h = [manager_display[k] for k in careers.loc[careers["championshipAppearances"] == _v, "ManagerKey"]]
check_scalar("mostChampGameApp", _v, js_out["recordBook"]["mostChampGameApp"])
check_holders("mostChampGameApp", _h, js_out["recordBook"]["mostChampGameApp"])

# Most Maid Bowl appearances
_v = careers["maidBowlAppearances"].max()
_h = [manager_display[k] for k in careers.loc[careers["maidBowlAppearances"] == _v, "ManagerKey"]]
check_scalar("mostMaidBowl", _v, js_out["recordBook"]["mostMaidBowl"])
check_holders("mostMaidBowl", _h, js_out["recordBook"]["mostMaidBowl"])

# Luckiest / unluckiest season ever (Luck Index, league-wide)
_v = all_rows["LuckIndex"].max()
_h = all_rows.loc[all_rows["LuckIndex"] == _v, "Manager"].tolist()
check_scalar("luckiestSeasonEver", float(_v), js_out["recordBook"]["luckiestSeasonEver"])
check_holders("luckiestSeasonEver", _h, js_out["recordBook"]["luckiestSeasonEver"])

_v = all_rows["LuckIndex"].min()
_h = all_rows.loc[all_rows["LuckIndex"] == _v, "Manager"].tolist()
check_scalar("unluckiestSeasonEver", float(_v), js_out["recordBook"]["unluckiestSeasonEver"])
check_holders("unluckiestSeasonEver", _h, js_out["recordBook"]["unluckiestSeasonEver"])

# Best / worst single-season Z-score, league-wide
_v = all_rows["ZScore"].max()
_h = all_rows.loc[(all_rows["ZScore"] - _v).abs() < 1e-6, "Manager"].tolist()
check_scalar("bestZScore", _v, js_out["recordBook"]["bestZScore"])
check_holders("bestZScore", _h, js_out["recordBook"]["bestZScore"])

_v = all_rows["ZScore"].min()
_h = all_rows.loc[(all_rows["ZScore"] - _v).abs() < 1e-6, "Manager"].tolist()
check_scalar("worstZScore", _v, js_out["recordBook"]["worstZScore"])
check_holders("worstZScore", _h, js_out["recordBook"]["worstZScore"])

# Most Chat Ragequits (career total)
_v = careers["careerChatRagequits"].max()
_h = [manager_display[k] for k in careers.loc[careers["careerChatRagequits"] == _v, "ManagerKey"]]
check_scalar("mostCareerRagequits", _v, js_out["recordBook"]["mostCareerRagequits"])
check_holders("mostCareerRagequits", _h, js_out["recordBook"]["mostCareerRagequits"])

# Most Chat Ragequits, Single Season
_v = all_rows["Chat Ragequits"].max()
_h = all_rows.loc[all_rows["Chat Ragequits"] == _v, "Manager"].tolist()
check_scalar("mostRagequitsSeason", _v, js_out["recordBook"]["mostRagequitsSeason"])
check_holders("mostRagequitsSeason", _h, js_out["recordBook"]["mostRagequitsSeason"])

print(f"\n{rb_mismatches} record-book mismatches found.\n")

print("=== Other Records tab: pandas vs calc.js ===")
print("(freeform/hand-entered -- this checks the trim + skip-invalid-row parsing logic, not any computed math)")
other_records_mismatches = 0
other_records_path = os.path.join(FIXTURES, "Other Records.csv")
if os.path.exists(other_records_path):
    raw = pd.read_csv(other_records_path, dtype=str, keep_default_na=False)
    expected = []
    for _, row in raw.iterrows():
        label = str(row.get("Record Name", "")).strip()
        value = str(row.get("Record Value", "")).strip()
        holders = str(row.get("Record Holder", "")).strip()
        if not label:
            continue  # rows missing a name are dropped, same as normalizeOtherRecordsRows
        expected.append({"label": label, "value": value, "holders": holders})

    js_other_records = js_out.get("otherRecords", [])
    if expected != js_other_records:
        print(f"MISMATCH otherRecords: pandas={expected} js={js_other_records}")
        other_records_mismatches += 1
else:
    print("(no Other Records.csv fixture found -- skipped)")

print(f"\n{other_records_mismatches} Other Records mismatches found.\n")
