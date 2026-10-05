"""
cfb_ratings_lab.py  (research only, not used by the site)
Walk-forward test of possible upgrades to the CFB power ratings
(src/cfb_ratings.py). Before each week of 2022-2026 it fits each variant on
the games before that week and predicts that week's FBS-vs-FBS games, then
prints straight-up accuracy, average miss, and the same next to Vegas.

Variants:
  base      the live settings (points ridge, last season carried at 0.6)
  fade      last season fades faster
  prior     last season replaced by a preseason prior: last season's final
            rating, scaled by returning production, plus roster talent;
            this season's games pull away from it as they come in
  eff       an efficiency rating (EPA per play, garbage time removed,
            opponent-adjusted) blended with the points rating
"""

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from fetch_cfb_data import _get, current_cfb_season
from cfb_ratings import FCS, _order, fbs_teams, fit_ratings, rating_line, season_games

SEASON = current_cfb_season()
YEARS = list(range(SEASON - 5, SEASON + 1))          # 2021-2026; 2021 only feeds 2022
TEST = [y for y in YEARS if y >= SEASON - 4]


def pick(d, *keys):
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return None


def load():
    games = pd.concat([season_games(y) for y in YEARS], ignore_index=True)
    fbs = {y: set(fbs_teams(y)["team"]) for y in YEARS}
    lines, adv, ret, tal = [], [], [], []
    for y in YEARS:
        for st in ("regular", "postseason"):
            for g in _get("/lines", {"year": y, "seasonType": st}):
                ls = g.get("lines") or []
                p = next((x for x in ls if x.get("provider") == "consensus"), ls[0] if ls else None)
                if p and p.get("spread") is not None:
                    lines.append({"id": g.get("id"), "vegas": -float(p["spread"])})
            try:
                for r in _get("/stats/game/advanced", {"year": y, "seasonType": st, "excludeGarbageTime": "true"}):
                    o, d = r.get("offense") or {}, r.get("defense") or {}
                    adv.append({"id": pick(r, "gameId", "game_id"), "team": r.get("team"),
                                "off_ppa": o.get("ppa"), "off_sr": pick(o, "successRate", "success_rate"),
                                "plays": o.get("plays")})
            except Exception as e:  # noqa: BLE001
                print(f"  no advanced stats {y} {st}: {e}")
        if y > YEARS[0]:
            try:
                for r in _get("/player/returning", {"year": y}):
                    ret.append({"season": y, "team": r.get("team"),
                                "ret": pick(r, "percentPPA", "percent_ppa")})
            except Exception as e:  # noqa: BLE001
                print(f"  no returning production {y}: {e}")
            try:
                for r in _get("/talent", {"year": y}):
                    tal.append({"season": y, "team": pick(r, "team", "school"), "talent": r.get("talent")})
            except Exception as e:  # noqa: BLE001
                print(f"  no talent {y}: {e}")
    lines = pd.DataFrame(lines).drop_duplicates("id")
    adv = pd.DataFrame(adv).dropna(subset=["off_ppa"])
    ret, tal = pd.DataFrame(ret), pd.DataFrame(tal)
    print(f"Loaded {len(games)} games, {len(lines)} lines, {len(adv)} efficiency rows, "
          f"{len(ret)} returning rows, {len(tal)} talent rows", flush=True)
    return games, fbs, lines, adv, ret, tal


# ---------------------------------------------------------------- fitting

def design(g, idx, n):
    m = len(g)
    X = np.zeros((2 * m, 2 * n + 2))
    rows = np.arange(m)
    hi, ai = g["home"].map(idx).values, g["away"].map(idx).values
    h = np.where(g["neutral"].fillna(False).astype(bool).values, 0.0, 1.0)
    X[rows, hi] = 1
    X[rows, n + ai] = 1
    X[rows, 2 * n] = h / 2
    X[m + rows, ai] = 1
    X[m + rows, n + hi] = 1
    X[m + rows, 2 * n] = -h / 2
    X[:, 2 * n + 1] = 1
    return X


def fit(done, fbs, t_now, s, y_home, y_away, half_life=30, carry=0.6, ridge=0.5, prior=None, prior_w=0.0):
    """Generic offense/defense ridge on any per-side stat (points, EPA/play).
    prior: dict team -> (off_dev, def_dev) to shrink toward instead of 0.
    carry 0 still keeps last season at a token weight so home field and the
    league average are defined before week 1."""
    teams = sorted(fbs) + [FCS]
    idx = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    g = done.copy()
    g["yh"], g["ya"] = y_home(g), y_away(g)
    g = g.dropna(subset=["yh", "ya"])
    for side in ("home", "away"):
        g[side] = g[f"{side}_team"].where(g[f"{side}_team"].isin(fbs), FCS)
    g = g[(g["home"] != FCS) | (g["away"] != FCS)]
    w = 0.5 ** ((t_now - _order(g).values) / half_life) * np.where(g["season"].values == s, 1.0,
                                                                     max(carry, 1e-3) ** (s - g["season"].values))
    X = design(g, idx, n)
    y = np.concatenate([g["yh"].values, g["ya"].values]).astype(float)
    ww = np.concatenate([w, w])
    A = X.T @ (X * ww[:, None])
    lam = np.full(2 * n + 2, ridge)
    lam[2 * n:] = 0
    target = np.zeros(2 * n + 2)
    if prior is not None:
        lam[:2 * n] += prior_w
        for t, (po, pd_) in prior.items():
            if t in idx:
                target[idx[t]], target[n + idx[t]] = po, pd_
        # the prior is in deviations; let the intercept absorb the level
    beta = np.linalg.solve(A + np.diag(lam), X.T @ (ww * y) + lam * target)
    off, dfn, hfa = beta[:n], beta[n:2 * n], beta[2 * n]
    f = np.array([idx[x] for x in sorted(fbs)])
    out = pd.DataFrame({"team": teams, "off": off - off[f].mean(), "def": dfn - dfn[f].mean()})
    out["overall"] = out["off"] - out["def"]
    return out.set_index("team"), float(hfa)


PTS = (lambda g: g["home_score"], lambda g: g["away_score"])


def line(r, hfa, home, away, neutral):
    if home not in r.index or away not in r.index:
        return np.nan
    return float(r.at[home, "overall"] - r.at[away, "overall"] + (0 if neutral else hfa))


# ---------------------------------------------------------------- priors

def season_final(done, fbs, s):
    g = done[done["season"] == s]
    r, _ = fit(g, fbs[s], _order(g).max() + 1, s, *PTS, half_life=1e9, carry=0.0)
    return r


def prior_features(done, fbs, ret, tal):
    """team-season rows: last season's final off/def deviation, returning
    production, talent (z-scored within season), and this season's final
    deviation (the target)."""
    finals = {s: season_final(done, fbs, s) for s in YEARS if s < SEASON}
    rows = []
    for s in TEST:
        last = finals[s - 1]
        now = finals.get(s)
        rt = ret[ret.season == s].set_index("team")["ret"] if len(ret) else pd.Series(dtype=float)
        tl = tal[tal.season == s].set_index("team")["talent"].astype(float) if len(tal) else pd.Series(dtype=float)
        tl = tl[~tl.index.duplicated()]
        tz = (tl - tl[tl.index.isin(fbs[s])].mean()) / tl[tl.index.isin(fbs[s])].std() if len(tl) else tl
        rt = rt[~rt.index.duplicated()].astype(float) if len(rt) else rt
        for t in fbs[s]:
            lo = last.at[t, "off"] if t in last.index else last.at[FCS, "off"] * 0.5
            ld = last.at[t, "def"] if t in last.index else last.at[FCS, "def"] * 0.5
            r_ = float(rt.get(t, np.nan)) if t in rt.index else np.nan
            rows.append({"season": s, "team": t, "last_off": lo, "last_def": ld,
                         "ret": r_, "talent": float(tz.get(t, 0.0)) if t in tz.index else 0.0,
                         "off": now.at[t, "off"] if now is not None and t in now.index else np.nan,
                         "def": now.at[t, "def"] if now is not None and t in now.index else np.nan})
    df = pd.DataFrame(rows)
    df["ret"] = df["ret"].fillna(df.groupby("season")["ret"].transform("mean"))
    df["ret_c"] = df["ret"] - df.groupby("season")["ret"].transform("mean")
    return df, finals


def prior_for(df, finals, s):
    """Leave-this-season-out regression of final deviation on last season,
    last season x returning production, and talent."""
    train = df[(df.season != s) & df["off"].notna()]
    cur = df[df.season == s]
    out = {}
    coefs = {}
    for side in ("off", "def"):
        Xtr = np.column_stack([train[f"last_{side}"], train[f"last_{side}"] * train["ret_c"], train["talent"],
                               np.ones(len(train))])
        b = np.linalg.lstsq(Xtr, train[side].values, rcond=None)[0]
        coefs[side] = np.round(b, 3)
        Xc = np.column_stack([cur[f"last_{side}"], cur[f"last_{side}"] * cur["ret_c"], cur["talent"],
                              np.ones(len(cur))])
        cur = cur.assign(**{f"p_{side}": Xc @ b})
    for r in cur.itertuples():
        out[r.team] = (r.p_off, r.p_def)
    fl = finals[s - 1]
    out[FCS] = (fl.at[FCS, "off"], fl.at[FCS, "def"])
    return out, coefs


# ---------------------------------------------------------------- walk-forward

def main():
    games, fbs, lines, adv, ret, tal = load()
    done = games.dropna(subset=["home_score", "away_score"]).copy()
    done["t"] = _order(done)
    # efficiency per side, from the garbage-time-free advanced stats
    a = adv.drop_duplicates(["id", "team"]).set_index(["id", "team"])["off_ppa"].astype(float)
    done["home_ppa"] = [a.get((i, h), np.nan) for i, h in zip(done["id"], done["home_team"])]
    done["away_ppa"] = [a.get((i, w), np.nan) for i, w in zip(done["id"], done["away_team"])]
    EFF = (lambda g: g["home_ppa"], lambda g: g["away_ppa"])
    print(f"Efficiency matched on {done['home_ppa'].notna().mean():.0%} of games", flush=True)

    pf, finals = prior_features(done, fbs, ret, tal)
    priors = {}
    for s in TEST:
        priors[s], coefs = prior_for(pf, finals, s)
        print(f"  prior {s}: off coefs (last, last*ret, talent, c) {coefs['off']}  def {coefs['def']}", flush=True)

    variants = {
        "base (live)":             dict(kind="pts", half_life=30, carry=0.6),
        "fade: carry 0.4":         dict(kind="pts", half_life=30, carry=0.4),
        "fade: half-life 16":      dict(kind="pts", half_life=16, carry=0.6),
        "prior w3":                dict(kind="pts", half_life=30, carry=0.0, prior_w=3),
        "prior w6":                dict(kind="pts", half_life=30, carry=0.0, prior_w=6),
        "prior w10":               dict(kind="pts", half_life=30, carry=0.0, prior_w=10),
        "prior w15":               dict(kind="pts", half_life=30, carry=0.0, prior_w=15),
        "prior w6 + last season":  dict(kind="pts", half_life=30, carry=0.3, prior_w=6),
        "eff only":                dict(kind="eff", half_life=30, carry=0.6),
    }
    test = done[done["season"].isin(TEST)]
    preds = {k: [] for k in variants}
    preds["_eff_prior"] = []
    for (s, t), wk in test.groupby(["season", "t"]):
        hist = done[(done["t"] < t) & (done["season"] >= s - 1)]
        if len(hist) < 200:
            continue
        fits = {}
        for name, v in variants.items():
            ys = EFF if v["kind"] == "eff" else PTS
            pw = v.get("prior_w", 0)
            fits[name] = fit(hist, fbs[s], t, s, *ys, half_life=v["half_life"], carry=v["carry"],
                             prior=priors[s] if pw else None, prior_w=pw)
        # efficiency with an efficiency-scale prior isn't available; reuse eff with carry 0.3
        fits["_eff_prior"] = fit(hist, fbs[s], t, s, *EFF, half_life=30, carry=0.3)
        for g in wk.itertuples():
            if g.home_team in fbs[s] and g.away_team in fbs[s] and g.home_score != g.away_score:
                for name, (r, h) in fits.items():
                    preds[name].append((g.id, s, g.week, line(r, h, g.home_team, g.away_team, bool(g.neutral)),
                                        g.home_score - g.away_score))

    frames = {k: pd.DataFrame(v, columns=["id", "season", "week", "line", "margin"]).dropna()
              for k, v in preds.items()}

    # blends: margin ~ a*points line + b*efficiency line, coefficients fit leaving the test season out
    def blend(pts_name, eff_name, label):
        p = frames[pts_name].merge(frames[eff_name][["id", "line"]], on="id", suffixes=("", "_eff"))
        out = []
        for s in TEST:
            tr, te = p[p.season != s], p[p.season == s]
            b = np.linalg.lstsq(tr[["line", "line_eff"]].values, tr["margin"].values, rcond=None)[0]
            out.append(te.assign(line=te[["line", "line_eff"]].values @ b))
            print(f"  {label} {s}: points x{b[0]:.2f} + efficiency x{b[1]:.1f}", flush=True)
        frames[label] = pd.concat(out)[["id", "season", "week", "line", "margin"]]

    blend("base (live)", "eff only", "base + eff blend")
    best_prior = min((k for k in frames if k.startswith("prior")),
                     key=lambda k: (frames[k]["line"] - frames[k]["margin"]).abs().mean())
    blend(best_prior, "_eff_prior", "prior + eff blend")

    def score(p):
        v = p.merge(lines, on="id")
        acc = lambda q, col: (np.sign(q[col]) == np.sign(q["margin"])).mean()
        mae = lambda q, col: (q[col] - q["margin"]).abs().mean()
        early = v[v.week <= 5]
        ats = v[(v["vegas"] - v["margin"]) != 0]
        ats_hit = ((ats["line"] > ats["vegas"]) == (ats["margin"] > ats["vegas"])).mean()
        return (f"{len(v):>5} lined: picks {acc(v, 'line'):.1%} miss {mae(v, 'line'):5.2f} | "
                f"wk1-5 picks {acc(early, 'line'):.1%} miss {mae(early, 'line'):5.2f} | ATS {ats_hit:.1%} | "
                f"Vegas {acc(v, 'vegas'):.1%} miss {mae(v, 'vegas'):5.2f} (wk1-5 {mae(early, 'vegas'):5.2f})")

    print("\n=== RESULTS, 2022-2026 FBS vs FBS, games with a Vegas line ===")
    for k, p in frames.items():
        if not k.startswith("_"):
            print(f"{k:<24} {score(p)}", flush=True)
    print("\n=== by season, miss (ours / Vegas) ===")
    for k in ("base (live)", best_prior, "base + eff blend", "prior + eff blend"):
        v = frames[k].merge(lines, on="id")
        parts = [f"{s}: {(q['line'] - q['margin']).abs().mean():.2f}/{(q['vegas'] - q['margin']).abs().mean():.2f}"
                 for s, q in v.groupby("season")]
        print(f"{k:<24} " + "  ".join(parts), flush=True)

    # today's top 15 under the best prior, and blend, for a look
    cur = done[done.season == SEASON]
    t_now = _order(cur).max() + 1
    hist = done[done.season >= SEASON - 1]
    r0, _ = fit(hist, fbs[SEASON], t_now, SEASON, *PTS)
    w = variants[best_prior]
    r1, _ = fit(hist, fbs[SEASON], t_now, SEASON, *PTS, half_life=30, carry=w["carry"],
                prior=priors[SEASON], prior_w=w["prior_w"])
    re, _ = fit(hist, fbs[SEASON], t_now, SEASON, *EFF, half_life=30, carry=0.6)
    print(f"\n=== {SEASON} top 15 now ===")
    print(f"{'live':<28}{best_prior:<28}{'efficiency only (EPA/play)':<28}")
    a1 = r0.drop(FCS).sort_values("overall", ascending=False).head(15)
    a2 = r1.drop(FCS).sort_values("overall", ascending=False).head(15)
    a3 = re.drop(FCS).sort_values("overall", ascending=False).head(15)
    for (t0, x0), (t1, x1), (t3, x3) in zip(a1["overall"].items(), a2["overall"].items(), a3["overall"].items()):
        print(f"{t0:<20}{x0:+6.1f}  {t1:<20}{x1:+6.1f}  {t3:<20}{x3:+6.3f}")
    print("\npreseason prior top 10:", sorted(((p[0] - p[1], t) for t, p in priors[SEASON].items() if t != FCS),
                                             reverse=True)[:10])


if __name__ == "__main__":
    main()
