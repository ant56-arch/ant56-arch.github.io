"""
td_model.py
Anytime touchdown model: the chance each player scores at least one rushing
or receiving TD in his next game (passing TDs don't count, a QB's own runs do).

The old TD Scorers numbers multiplied a player's carries and targets by his
TD rate per touch. That treats a carry at midfield the same as a carry from
the 1, so it ran hot for busy backs (Gibbs 68% when books said ~55%). This
model prices touches by where they happen and adds the game around them:

  - Expected TDs (xTD): every carry and target is worth the league TD rate
    from that spot on the field, so goal-line work counts for what it is.
    His recency-weighted xTD per game is the core of the projection.
  - Finishing: his actual TDs over his xTD, heavily shrunk toward 1.
  - Red zone share: his share of his team's carries and targets inside the 20.
  - Team implied points from the spread and total. More expected points,
    more TDs to go around.
  - Defense vs position: TDs the opponent allowed to his position (RB, WR,
    TE, QB) over its last 8 games, against the league rate.
  - Quiet games: games he was active for with no carry or target count as
    zeros (add_quiet_games), so a backup isn't priced like he always plays.

These combine in a Poisson regression on the TD count, fit by fit_td_model.py
on past games with every feature built only from games before the one being
predicted. Chance to score = 1 - exp(-expected TDs).
"""

import json
import os

import numpy as np
import pandas as pd
from scipy.optimize import minimize

COEFFICIENTS_PATH = os.path.join(os.path.dirname(__file__), "models", "fitted_td_coefficients.json")

HALF_LIFE_GAMES = 6        # a player's game 6 games back counts half as much
DEFENSE_WINDOW = 8         # opponent's last 8 games for TDs allowed by position
MIN_PRIOR_GAMES = 3        # same floor as the rest of the props
XTD_PRIOR_GAMES = 2.0      # pseudo-games pulling a player's xTD toward his position's average
FINISH_PRIOR_XTD = 3.0     # pseudo-xTD pulling his TDs/xTD toward 1
DEFENSE_PRIOR_GAMES = 4.0  # pseudo-games pulling a defense toward league average
LEAGUE_POINTS = 22.5       # a typical team's implied points
FEATURES = ["log_xtd", "log_finish", "rz_share", "log_implied", "log_def_pos", "is_RB", "is_TE", "is_QB"]
POSITIONS = ("RB", "WR", "TE", "QB")

PBP_COLUMNS = ["season", "week", "game_id", "posteam", "defteam", "yardline_100", "play_type",
               "rusher_player_id", "rusher_player_name", "receiver_player_id", "receiver_player_name",
               "rush_touchdown", "pass_touchdown", "two_point_attempt"]

# Yardline buckets (yards from the end zone) for the xTD table
YARD_BINS = [0, 1, 2, 3, 5, 10, 20, 40, 100]


def _bucket(yardline):
    return pd.cut(yardline, YARD_BINS, labels=False, include_lowest=True)


def opportunities(pbp):
    """One row per carry or target: who, where on the field, and whether it
    scored for him. Scrambles count as carries; two-point tries don't count."""
    pbp = pbp[(pbp.get("two_point_attempt", 0).fillna(0) == 0) & pbp["yardline_100"].notna()]
    runs = pbp[(pbp["play_type"] == "run") & pbp["rusher_player_id"].notna()]
    rush = pd.DataFrame({
        "player_id": runs["rusher_player_id"], "player_name": runs["rusher_player_name"],
        "kind": "rush", "td": runs["rush_touchdown"].fillna(0),
    })
    passes = pbp[(pbp["play_type"] == "pass") & pbp["receiver_player_id"].notna()]
    rec = pd.DataFrame({
        "player_id": passes["receiver_player_id"], "player_name": passes["receiver_player_name"],
        "kind": "target", "td": passes["pass_touchdown"].fillna(0),
    })
    out = []
    for part, src in ((rush, runs), (rec, passes)):
        for col in ("season", "week", "game_id", "posteam", "defteam", "yardline_100"):
            part[col] = src[col].values
        out.append(part)
    opps = pd.concat(out, ignore_index=True).rename(columns={"posteam": "team", "defteam": "opponent"})
    opps["bucket"] = _bucket(opps["yardline_100"])
    return opps


def xtd_table(opps):
    """League TD rate per carry and per target from each yardline bucket."""
    t = opps.groupby(["kind", "bucket"])["td"].mean()
    return {f"{k}|{int(b)}": float(v) for (k, b), v in t.items()}


def add_xtd(opps, table):
    keys = opps["kind"] + "|" + opps["bucket"].astype(int).astype(str)
    opps = opps.copy()
    opps["xtd"] = keys.map(table).fillna(0.0)
    return opps


def player_games(opps):
    """One row per player per game: carries, targets, red-zone touches, xTD, TDs,
    and his share of his team's red-zone touches."""
    opps = opps.assign(rz=(opps["yardline_100"] <= 20).astype(int),
                       xtd_rush=np.where(opps["kind"] == "rush", opps["xtd"], 0.0))
    g = opps.groupby(["season", "week", "game_id", "team", "opponent", "player_id"]).agg(
        player_name=("player_name", "last"),
        carries=("kind", lambda k: (k == "rush").sum()),
        targets=("kind", lambda k: (k == "target").sum()),
        rz=("rz", "sum"), xtd=("xtd", "sum"), xtd_rush=("xtd_rush", "sum"), tds=("td", "sum"),
    ).reset_index()
    by_kind = opps.pivot_table(index=["game_id", "player_id"], columns="kind", values="td", aggfunc="sum", fill_value=0)
    by_kind = by_kind.reindex(columns=["rush", "target"], fill_value=0).rename(columns={"rush": "rush_tds", "target": "rec_tds"})
    g = g.merge(by_kind.reset_index(), on=["game_id", "player_id"], how="left")
    team_rz = g.groupby(["game_id", "team"])["rz"].transform("sum")
    g["team_rz"] = team_rz
    return g.sort_values(["season", "week"]).reset_index(drop=True)


def add_quiet_games(pg, rosters, schedules):
    """Add a zero row for every played game a skill player was active for but
    got no carry or target. Without these the model only ever saw backups in
    games where they touched the ball, so it priced a third-string back as if
    he always plays (85 'Value' long shots on the first live run). Books grade
    an active player with no touches as a loss, so these games count; game-day
    inactives (roster status INA) don't, the same as a voided bet."""
    if rosters is None or rosters.empty or "status" not in rosters.columns:
        return pg
    act = rosters[(rosters["status"] == "ACT") & rosters["gsis_id"].notna()
                  & rosters["position"].map(norm_position).isin(POSITIONS)]
    act = act[["season", "week", "team", "gsis_id"]].drop_duplicates()
    act = act.rename(columns={"gsis_id": "player_id"})
    played = schedules[schedules["result"].notna()]
    games = pd.concat([
        played[["season", "week", "game_id", "home_team", "away_team"]].rename(columns={"home_team": "team", "away_team": "opponent"}),
        played[["season", "week", "game_id", "away_team", "home_team"]].rename(columns={"away_team": "team", "home_team": "opponent"}),
    ], ignore_index=True)
    team_rz = pg.groupby(["game_id", "team"])["team_rz"].first().reset_index()
    quiet = act.merge(games, on=["season", "week", "team"]).merge(team_rz, on=["game_id", "team"])
    quiet = quiet.merge(pg[["game_id", "player_id"]].assign(_had=1), on=["game_id", "player_id"], how="left")
    quiet = quiet[quiet["_had"].isna()].drop(columns="_had")
    names = pg.groupby("player_id")["player_name"].last()
    quiet = quiet[quiet["player_id"].isin(names.index)]  # players with at least one touch on record
    quiet["player_name"] = quiet["player_id"].map(names)
    for c in ("carries", "targets", "rz", "xtd", "xtd_rush", "tds", "rush_tds", "rec_tds"):
        quiet[c] = 0
    out = pd.concat([pg, quiet[pg.columns]], ignore_index=True)
    return out.sort_values(["season", "week"]).reset_index(drop=True)


def implied_points(schedules):
    """(game_id, team) -> implied points from the closing spread and total.
    spread_line is how much the home team is favored by."""
    s = schedules.dropna(subset=["spread_line", "total_line"])
    home = pd.DataFrame({"game_id": s["game_id"], "team": s["home_team"],
                         "implied": (s["total_line"] + s["spread_line"]) / 2})
    away = pd.DataFrame({"game_id": s["game_id"], "team": s["away_team"],
                         "implied": (s["total_line"] - s["spread_line"]) / 2})
    return pd.concat([home, away], ignore_index=True)


def norm_position(pos):
    pos = str(pos or "").upper()
    if pos in ("RB", "FB", "HB"):
        return "RB"
    if pos in ("WR", "TE", "QB"):
        return pos
    return "OTHER"


def _weights(n, half_life=HALF_LIFE_GAMES):
    return 0.5 ** (np.arange(n)[::-1] / half_life)


def player_form(hist, half_life=HALF_LIFE_GAMES):
    """Recency-weighted per-game numbers from a player's past games (oldest
    first). Returns raw weighted sums so callers can shrink them."""
    w = _weights(len(hist), half_life)
    return {
        "w": w.sum(),
        "xtd": (w * hist["xtd"].values).sum(),
        "xtd_rush": (w * hist["xtd_rush"].values).sum(),
        "tds": (w * hist["tds"].values).sum(),
        "rz": (w * hist["rz"].values).sum(),
        "team_rz": (w * hist["team_rz"].values).sum(),
        "n": len(hist),
    }


def form_features(f, pos_xtd_mean):
    """Shrunk features from player_form sums."""
    xtd_pg = (f["xtd"] + pos_xtd_mean * XTD_PRIOR_GAMES) / (f["w"] + XTD_PRIOR_GAMES)
    finish = (f["tds"] + FINISH_PRIOR_XTD) / (f["xtd"] + FINISH_PRIOR_XTD)
    rz_share = f["rz"] / f["team_rz"] if f["team_rz"] > 0 else 0.0
    return {"xtd_pg": xtd_pg, "log_xtd": np.log(max(xtd_pg, 1e-3)),
            "log_finish": np.log(finish), "rz_share": rz_share,
            "rush_xtd_share": f["xtd_rush"] / f["xtd"] if f["xtd"] > 0 else 0.5}


def feature_row(hist, pos, def_hist, implied, league_pg, pos_xtd):
    """Model inputs for one player's game from his earlier games (hist,
    oldest first) and the opponent's earlier games (def_hist)."""
    row = form_features(player_form(hist), pos_xtd.get(pos, 0.2))
    dfac = def_pos_factor(def_hist, pos, league_pg) if def_hist is not None else 1.0
    row.update({"pos": pos, "def_pos_factor": dfac, "log_def_pos": np.log(dfac),
                "implied": implied, "log_implied": np.log(implied / LEAGUE_POINTS)})
    for p in ("RB", "TE", "QB"):
        row[f"is_{p}"] = float(pos == p)
    return row


def defense_allowed(pg, positions):
    """TDs each defense allowed per game to each position, in game order."""
    pg = pg.assign(pos=pg["player_id"].map(positions).fillna("OTHER"))
    games = pg[["season", "week", "game_id", "opponent"]].drop_duplicates(["game_id", "opponent"])
    allowed = pg.pivot_table(index=["game_id", "opponent"], columns="pos", values="tds", aggfunc="sum", fill_value=0)
    allowed = games.merge(allowed.reset_index(), on=["game_id", "opponent"], how="left").fillna(0)
    return allowed.sort_values(["season", "week"]).reset_index(drop=True)


def def_pos_factor(def_hist, pos, league_pg):
    """Opponent's TDs allowed to this position over its last DEFENSE_WINDOW
    games, shrunk and divided by the league rate (1.0 = average)."""
    if pos not in league_pg or league_pg[pos] <= 0:
        return 1.0
    recent = def_hist.tail(DEFENSE_WINDOW)
    total = recent[pos].sum() if pos in recent else 0.0
    rate = (total + league_pg[pos] * DEFENSE_PRIOR_GAMES) / (len(recent) + DEFENSE_PRIOR_GAMES)
    return rate / league_pg[pos]


def league_rates(pg, positions):
    pos = pg["player_id"].map(positions).fillna("OTHER")
    n_def_games = pg[["game_id", "opponent"]].drop_duplicates().shape[0]
    tds = pg.groupby(pos)["tds"].sum() / max(n_def_games, 1)
    xtd_mean = pg.groupby(pos)["xtd"].mean()
    return tds.to_dict(), xtd_mean.to_dict()


def _defense_index(pg, positions):
    index = {}
    for opp, d in defense_allowed(pg, positions).groupby("opponent"):
        d = d.reset_index(drop=True)
        index[opp] = (d, {gid: i for i, gid in enumerate(d["game_id"])})
    return index


def walkforward_rows(pg, positions, implied, min_prior=MIN_PRIOR_GAMES):
    """Features for every past player-game, each built only from earlier games."""
    league_pg, pos_xtd = league_rates(pg, positions)
    implied_map = implied.set_index(["game_id", "team"])["implied"].to_dict()
    def_index = _defense_index(pg, positions)

    rows = []
    for pid, g in pg.groupby("player_id", sort=False):
        pos = positions.get(pid, "OTHER")
        if pos not in POSITIONS:
            continue
        g = g.reset_index(drop=True)
        for i in range(min_prior, len(g)):
            game = g.iloc[i]
            imp = implied_map.get((game["game_id"], game["team"]))
            if imp is None or np.isnan(imp):
                continue
            d, idx = def_index.get(game["opponent"], (None, {}))
            j = idx.get(game["game_id"])
            row = feature_row(g.iloc[:i], pos, d.iloc[:j] if j is not None else None, imp, league_pg, pos_xtd)
            row.update({
                "season": game["season"], "week": game["week"], "game_id": game["game_id"],
                "player_id": pid, "player_name": game["player_name"],
                "team": game["team"], "opponent": game["opponent"],
                "tds": game["tds"], "scored": int(game["tds"] > 0),
                # The old TD Scorers math, for comparison: carries and targets
                # per game times shrunk TD rates per touch.
                "old_lambda": _old_lambda(g.iloc[:i]),
            })
            rows.append(row)
    return pd.DataFrame(rows)


def upcoming_rows(pg, positions, player_ids, matchups, min_prior=MIN_PRIOR_GAMES):
    """Features for each player's next game. matchups maps a team to
    (opponent, implied points)."""
    league_pg, pos_xtd = league_rates(pg, positions)
    def_index = _defense_index(pg, positions)
    rows = []
    for pid, team in player_ids.items():
        pos = positions.get(pid, "OTHER")
        if pos not in POSITIONS or team not in matchups:
            continue
        hist = pg[pg["player_id"] == pid]
        if len(hist) < min_prior:
            continue
        opp, imp = matchups[team]
        d = def_index.get(opp, (None, {}))[0]
        row = feature_row(hist, pos, d, imp, league_pg, pos_xtd)
        row.update({"player_id": pid, "team": team, "opponent": opp})
        rows.append(row)
    return pd.DataFrame(rows)


def _old_lambda(hist, half_life=6, k_rush=150, k_rec=150, rush_rate=0.032, rec_rate=0.04):
    """Carries and targets per game times TD rates per touch shrunk to league."""
    w = _weights(len(hist), half_life)
    car, tgt = hist["carries"].values, hist["targets"].values
    rr = ((w * hist["rush_tds"].values).sum() + rush_rate * k_rush) / ((w * car).sum() + k_rush)
    cr = ((w * hist["rec_tds"].values).sum() + rec_rate * k_rec) / ((w * tgt).sum() + k_rec)
    return ((w * car).sum() * rr + (w * tgt).sum() * cr) / w.sum()


def design(df, features=FEATURES):
    X = df[features].to_numpy(dtype=float)
    return np.column_stack([np.ones(len(X)), X])


def fit_poisson(df, features=FEATURES, ridge=1.0):
    """Poisson regression on the TD count, with a light ridge penalty so a
    thin feature can't run away."""
    X, y = design(df, features), df["tds"].to_numpy(dtype=float)

    def loss(b):
        eta = np.clip(X @ b, -10, 3)
        mu = np.exp(eta)
        return (mu - y * eta).sum() + ridge * (b[1:] ** 2).sum()

    def grad(b):
        eta = np.clip(X @ b, -10, 3)
        g = X.T @ (np.exp(eta) - y)
        g[1:] += 2 * ridge * b[1:]
        return g

    b0 = np.zeros(X.shape[1])
    b0[0] = np.log(max(y.mean(), 1e-3))
    res = minimize(loss, b0, jac=grad, method="L-BFGS-B")
    return dict(zip(["intercept"] + list(features), res.x.tolist()))


def predict_lambda(df, coefs, features=FEATURES):
    b = np.array([coefs["intercept"]] + [coefs[f] for f in features])
    return np.exp(np.clip(design(df, features) @ b, -10, 3))


def prob_from_lambda(lam):
    return 1 - np.exp(-np.asarray(lam))


def scores(p, y):
    p, y = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6), np.asarray(y, float)
    return {"brier": float(np.mean((p - y) ** 2)),
            "log_loss": float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))),
            "mean_pred": float(p.mean()), "actual_rate": float(y.mean()), "n": int(len(y))}


def calibration(p, y, edges=(0, .1, .2, .3, .4, .5, .6, 1)):
    df = pd.DataFrame({"p": p, "y": y})
    df["bin"] = pd.cut(df["p"], edges, include_lowest=True)
    t = df.groupby("bin", observed=True).agg(n=("y", "size"), predicted=("p", "mean"), actual=("y", "mean"))
    return [{"range": str(i), "n": int(r.n), "predicted": round(float(r.predicted), 3),
             "actual": round(float(r.actual), 3)} for i, r in t.iterrows()]


def load_coefficients(path=COEFFICIENTS_PATH):
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)
