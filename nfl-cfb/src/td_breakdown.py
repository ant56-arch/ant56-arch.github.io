"""
td_breakdown.py
The "why" behind each TD Props pick, for the tab's game cards (build_site.py):

  - player_breakdowns: each player's last BREAKDOWN_GAMES games (active games
    with no touches included): touches, red-zone and goal-line touches a game,
    target share, his share of the team's red-zone touches, and his carries,
    targets and expected TDs from each zone of the field. TD debt is expected
    TDs minus TDs scored over those games (positive = the ball has found him
    in scoring spots more than the scoreboard shows).
  - defense_notes: what each defense allowed by position over its last
    DEFENSE_GAMES games (TDs, rushing yards, targets) with its league rank,
    and the few that stand out as one-line notes.
  - tags: short labels for why a player shows up, from fixed thresholds.

None of this changes the chance to score; that is td_model.py's alone. The
tags and notes describe the inputs it already uses.
"""

import numpy as np
import pandas as pd

BREAKDOWN_GAMES = 10
DEFENSE_GAMES = 8
ZONES = [("Goal line (inside 5)", 0, 5), ("Red zone (6-20)", 6, 20),
         ("Fringe (21-40)", 21, 40), ("Open field", 41, 100)]
POS_WORDS = {"RB": "running backs", "WR": "wide receivers", "TE": "tight ends", "QB": "quarterbacks"}

# Tag thresholds
GOAL_LINE_PG = 1.0      # goal-line touches a game
RZ_SHARE = 0.33         # share of his team's red-zone touches
HIGH_VOLUME_PG = 18     # touches a game
TARGET_SHARE = 0.24     # share of his team's targets
SHOOTOUT_TOTAL = 47.5   # game total
SHOOTOUT_IMPLIED = 25   # his team's implied points
SOFT_DEFENSE = 1.25     # opponent's TDs allowed to his position vs league
DUE_DEBT = 1.0          # expected TDs minus TDs scored


def _zone(yardline):
    for name, lo, hi in ZONES:
        if lo <= yardline <= hi:
            return name
    return ZONES[-1][0]


def player_breakdowns(opps, pg, player_ids, games=BREAKDOWN_GAMES):
    """player_id -> breakdown dict over his last `games` games (pg includes
    quiet games, so a game he was active for without a touch counts)."""
    team_targets = opps[opps["kind"] == "target"].groupby(["game_id", "team"]).size()
    team_rz = opps[opps["yardline_100"] <= 20].groupby(["game_id", "team"]).size()
    by_player = {pid: g for pid, g in opps[opps["player_id"].isin(player_ids)].groupby("player_id")}
    out = {}
    for pid, hist in pg[pg["player_id"].isin(player_ids)].groupby("player_id"):
        hist = hist.sort_values(["season", "week"]).tail(games)
        n = len(hist)
        if not n:
            continue
        keys = list(zip(hist["game_id"], hist["team"]))
        plays = by_player.get(pid, opps.iloc[0:0])
        plays = plays[plays["game_id"].isin(hist["game_id"])]
        tgt = int((plays["kind"] == "target").sum())
        car = int((plays["kind"] == "rush").sum())
        rz = int((plays["yardline_100"] <= 20).sum())
        gl = int((plays["yardline_100"] <= 5).sum())
        team_t = sum(team_targets.get(k, 0) for k in keys)
        team_r = sum(team_rz.get(k, 0) for k in keys)
        zones = []
        for name, lo, hi in ZONES:
            z = plays[(plays["yardline_100"] >= lo) & (plays["yardline_100"] <= hi)]
            zones.append({"zone": name, "carries": int((z["kind"] == "rush").sum()),
                          "targets": int((z["kind"] == "target").sum()), "xtd": round(float(z["xtd"].sum()), 2)})
        xtd, tds = float(hist["xtd"].sum()), int(hist["tds"].sum())
        first, last = hist.iloc[0], hist.iloc[-1]
        out[pid] = {
            "games": n, "span": f"{int(first['season'])} W{int(first['week'])} to {int(last['season'])} W{int(last['week'])}",
            "touches_pg": round((car + tgt) / n, 1), "carries_pg": round(car / n, 1), "targets_pg": round(tgt / n, 1),
            "rz_pg": round(rz / n, 1), "gl_pg": round(gl / n, 1),
            "target_share": round(tgt / team_t, 3) if team_t else 0.0,
            "rz_share": round(rz / team_r, 3) if team_r else 0.0,
            "xtd": round(xtd, 2), "tds": tds, "debt": round(xtd - tds, 2), "zones": zones,
        }
    return out


def defense_notes(opps, positions, games=DEFENSE_GAMES, max_notes=4):
    """team -> {"allowed": {metric: {"value", "rank"}}, "notes": [...]}: what
    each defense gave up to each position over its last `games` games, ranked
    across the league (1 = allowed the most)."""
    o = opps.assign(pos=opps["player_id"].map(positions).fillna("OTHER"))
    o = o[o["pos"].isin(POS_WORDS)]
    recent = (o[["season", "week", "game_id", "opponent"]].drop_duplicates(["game_id", "opponent"])
              .sort_values(["season", "week"]).groupby("opponent").tail(games))
    o = o.merge(recent[["game_id", "opponent"]], on=["game_id", "opponent"])
    metrics = {}
    for pos, word in POS_WORDS.items():
        p = o[o["pos"] == pos]
        metrics[f"{pos}_tds"] = (p.groupby("opponent")["td"].sum(), f"{{n}} TDs to {word}")
    metrics["RB_rush_yds"] = (o[(o["pos"] == "RB") & (o["kind"] == "rush")].groupby("opponent")["yards"].sum(),
                              "{n} rushing yards to running backs")
    for pos in ("WR", "TE", "RB"):
        p = o[(o["pos"] == pos) & (o["kind"] == "target")]
        metrics[f"{pos}_targets"] = (p.groupby("opponent").size(), f"{{n}} targets to {POS_WORDS[pos]}")
    metrics["QB_rush_yds"] = (o[(o["pos"] == "QB") & (o["kind"] == "rush")].groupby("opponent")["yards"].sum(),
                              "{n} rushing yards to quarterbacks")
    teams = sorted(recent["opponent"].unique())
    out = {t: {"allowed": {}, "notes": []} for t in teams}
    for key, (series, text) in metrics.items():
        s = series.reindex(teams).fillna(0)
        ranks = s.rank(ascending=False, method="min").astype(int)
        for t in teams:
            out[t]["allowed"][key] = {"value": int(round(s[t])), "rank": int(ranks[t])}
    for t in teams:
        cands = sorted(((v["rank"], k) for k, v in out[t]["allowed"].items() if v["rank"] <= 6 and v["value"] > 0))
        for rank, key in cands[:max_notes]:
            where = "the most in the league" if rank == 1 else f"{_ordinal(rank)} most"
            n = out[t]["allowed"][key]["value"]
            out[t]["notes"].append(f"{t} has allowed {metrics[key][1].format(n=n)} in its last {games} games, {where}.")
    return out


def _ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def tags(b, pos, implied, total, def_factor):
    """Why this player shows up, as short labels (fixed thresholds above)."""
    out = []
    if not b:
        return out
    if b["gl_pg"] >= GOAL_LINE_PG and pos in ("RB", "QB"):
        out.append("Goal Line Back")
    if b["rz_share"] >= RZ_SHARE:
        out.append("Elite Red Zone Role")
    if b["target_share"] >= TARGET_SHARE:
        out.append("Target Monster")
    if b["touches_pg"] >= HIGH_VOLUME_PG:
        out.append("High Volume")
    if pd.notna(total) and pd.notna(implied) and total >= SHOOTOUT_TOTAL and implied >= SHOOTOUT_IMPLIED:
        out.append("Shootout Script")
    if pd.notna(def_factor) and def_factor >= SOFT_DEFENSE:
        out.append("Soft TD Defense")
    if b["debt"] >= DUE_DEBT:
        out.append(f"Due For TD (+{b['debt']:.1f})")
    return out


def json_safe(obj):
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [json_safe(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    return obj
