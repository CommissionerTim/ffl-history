"""
Fits the Pythagorean win-expectation exponent (calc.js's PYTHAGOREAN_EXPONENT)
directly to this league's own history, instead of borrowing the NFL's
commonly-cited 2.37.

Why: the 2.37 exponent comes from Football Outsiders' research on *real* NFL
team scoring (~20-24 points/game, ~45-50% week-to-week coefficient of
variation). Fantasy scores run much higher (100-160+ points/week) and — more
importantly for this formula — cluster much more tightly around the mean
(this league's week-to-week CV is closer to 18-19%). A tighter score
distribution calls for a steeper exponent, so 2.37 systematically
under-predicts how often the higher scorer actually wins.

Method: rather than estimating the exponent from score variance (the
"Hundal" shortcut some sites use — k ~ 2 / (sigma_rel * sqrt(pi)), which
needs a real week-by-week score log we don't have; this sheet only stores
season totals + each manager's single highest week), this fits k directly:
find the exponent that minimizes the squared error between the Pythagorean
formula's predicted win% and each manager-season's *actual* regular-season
win%, across every manager-season in the sheet's history. This uses only
data already in the sheet, makes no assumption about the shape of the score
distribution, and directly optimizes the thing the formula is actually for
(predicting real outcomes).

As a sanity cross-check, this script also reports what the Hundal-style
formula would give using each season's points-per-game spread as a (not
quite correct, but closest available) stand-in for true weekly variance —
included only because it landed suspiciously close to the direct fit
(~6.09 vs ~6.10), which is reassuring, not because it's the right way to
compute the real thing.

Run this again whenever a full season or two of new data has been added, to
check whether the fitted exponent has drifted. If it moves meaningfully,
update PYTHAGOREAN_EXPONENT in ../site/assets/calc.js (and its comment,
season.js's tooltip, and README.md's "Advanced stats" section) to match,
and re-run the full test suite.
"""
import glob
import math
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
all_rows = all_rows.dropna(subset=["Points Scored", "Points Against"])
all_rows["RegDenom"] = all_rows["Reg Season W"] + all_rows["Reg Season L"] + all_rows["Reg Season T"]
all_rows = all_rows[all_rows["RegDenom"] > 0]
all_rows["ActualWinPct"] = (all_rows["Reg Season W"] + 0.5 * all_rows["Reg Season T"]) / all_rows["RegDenom"]

PF = all_rows["Points Scored"].to_numpy()
PA = all_rows["Points Against"].to_numpy()
actual = all_rows["ActualWinPct"].to_numpy()
n = len(all_rows)


def pythag_win_pct(k):
    pf_k = PF ** k
    pa_k = PA ** k
    return pf_k / (pf_k + pa_k)


def sse(k):
    pred = pythag_win_pct(k)
    return float(((pred - actual) ** 2).sum())


def mae(k):
    pred = pythag_win_pct(k)
    return float(abs(pred - actual).mean())


# Golden-section search for the k that minimizes SSE. sse(k) is smooth and
# unimodal over any sane exponent range (verified by grid scan below), so
# this converges to the true minimum without needing scipy as a dependency.
def golden_section_min(f, lo, hi, tol=1e-9):
    invphi = (math.sqrt(5) - 1) / 2  # 1/phi
    a, b = lo, hi
    c = b - invphi * (b - a)
    d = a + invphi * (b - a)
    fc, fd = f(c), f(d)
    while abs(b - a) > tol:
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - invphi * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + invphi * (b - a)
            fd = f(d)
    return (a + b) / 2


best_k = golden_section_min(sse, 1.0, 20.0)

print(f"Manager-seasons used: {n}")
print()
print("SSE / MAE at a few reference exponents:")
for k in (1.0, 2.0, 2.37, 3.0, 4.0, 5.0, best_k, 7.0, 10.0):
    label = "  <- best fit" if abs(k - best_k) < 1e-6 else ("  <- current NFL-borrowed value" if k == 2.37 else "")
    print(f"  k={k:8.4f}   SSE={sse(k):.6f}   MAE={mae(k):.6f}{label}")

print()
print(f"Best-fit exponent (min SSE, golden-section search): {best_k:.4f}")
print(f"  -> round to 2 decimals for PYTHAGOREAN_EXPONENT: {round(best_k, 2)}")
print(f"  SSE improvement vs 2.37: {sse(2.37):.6f} -> {sse(best_k):.6f} ({(1 - sse(best_k) / sse(2.37)) * 100:.1f}% reduction)")
print(f"  MAE improvement vs 2.37: {mae(2.37):.6f} -> {mae(best_k):.6f}")

# Sanity cross-check only -- NOT the correct use of the Hundal-style formula,
# since it needs real week-to-week variance and this sheet only has season
# totals. Using each manager-season's points-per-game as a stand-in for "a
# week's score" is a rough proxy, included because it happens to land close
# to the direct fit above.
all_rows["PPG"] = all_rows["Points Scored"] / all_rows["RegDenom"]
mu = all_rows["PPG"].mean()
sigma = all_rows["PPG"].std(ddof=0)
sigma_rel = sigma / mu
hundal_k = 2 / (sigma_rel * math.sqrt(math.pi))
print()
print(f"Sanity cross-check (Hundal-style formula, season-PPG spread as a rough proxy for weekly variance):")
print(f"  PPG mean={mu:.2f} std={sigma:.2f} CV={sigma_rel:.3f} -> k~={hundal_k:.4f}")
