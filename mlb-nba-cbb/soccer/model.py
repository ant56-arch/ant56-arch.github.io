"""
model.py - Soccer Edge's match model: time-decayed attack and defence
ratings for every club, linked across leagues, turned into home win / draw /
away win chances.

Each side's expected goals in a match come from a Poisson model (Dixon and
Coles, 1997):

  home goals ~ Poisson(exp(mu + home + att[home] - def[away]))
  away goals ~ Poisson(exp(mu + att[away] - def[home]))

where a club's att and def are its league's level plus its own difference
from that level (league[L] + team[t]). The team part is shrunk toward zero
(reg, in matches' worth of evidence), so a club with few results sits near its
league's average; the league part is what Champions League results pin down:
when Premier League sides beat Eredivisie sides in Europe, every Premier
League club moves up together. A neutral venue (a final) has no home edge.
Older results count less: a match's weight halves every half_life days, and
only the last `years` years count.

The fit is weighted maximum likelihood, solved by block Newton steps. Draws
get the Dixon-Coles low-score correction rho, fitted on the same weighted
matches. The scoreline grid (0-10 goals a side) then sums to the three
chances. Results are regular-time results (90 minutes plus stoppage), so
extra time never enters the ratings.
"""

import math
from datetime import date

import numpy as np

DEFAULT_RECIPE = {"half_life": 400, "reg": 3.0, "years": 3, "xg": 0.3, "home_reg": 100.0}
# Optional recipe keys (each absent = off, which is the original model):
#   xg         0-1: weight on the shots-on-target expected-goals proxy in the
#              rating target (the rest on actual goals); matches without shot
#              counts (Champions League) use goals alone
#   home_reg   per-competition home edges, each pulled toward the overall one
#              with this many matches' worth of weight (None = one home edge)
# The default (shots blend 0.3, per-competition home edges) beat the plain
# goals model on both 2024-25 and 2025-26 walk-forward (research/experiments.py).
#   promoted   prior for a club new to its league: its attack and defence are
#              pulled toward -promoted instead of the league average
#   draw       draw inflation: the draw chance is scaled by 1 + draw, then the
#              three chances are renormalised
#   rho        a fixed low-score correction instead of the fitted one
LEAGUE_REG = 1.0  # a light pull on league levels, which have plenty of evidence
OTHER = "OTHER"   # clubs seen only in the Champions League
MAX_GOALS = 10
MIN_MATCHES = 300
RHO_GRID = np.round(np.arange(-0.25, 0.101, 0.01), 3)


def ordinal(day):
    return date.fromisoformat(day[:10]).toordinal()


class Data:
    """Every stored match as arrays, built once and fitted many times."""

    def __init__(self, matches):
        self.matches = matches
        self.teams = sorted({m["hk"] for m in matches} | {m["ak"] for m in matches})
        self.tidx = {t: i for i, t in enumerate(self.teams)}
        self.leagues = sorted({m["league"] for m in matches if m.get("league")}) + [OTHER]
        self.lidx = {l: i for i, l in enumerate(self.leagues)}
        n = len(matches)
        self.ord = np.array([ordinal(m["date"]) for m in matches], dtype=np.int64)
        self.h = np.array([self.tidx[m["hk"]] for m in matches], dtype=np.int64)
        self.a = np.array([self.tidx[m["ak"]] for m in matches], dtype=np.int64)
        self.hg = np.array([m["hg"] for m in matches], dtype=float)
        self.ag = np.array([m["ag"] for m in matches], dtype=float)
        self.hf = np.array([0.0 if m.get("neutral") else 1.0 for m in matches])
        self.lg = np.array([self.lidx[m["league"]] if m.get("league") else -1 for m in matches], dtype=np.int64)
        # Home-edge group: the league, or OTHER for the Champions League.
        self.grp = np.where(self.lg >= 0, self.lg, self.lidx[OTHER])
        shots = [m.get("shots") or [np.nan] * 4 for m in matches]
        self.shots = np.array(shots, dtype=float).reshape(n, 4)  # HS, AS, HST, AST
        self.n = n

    def team_leagues(self, mask):
        """Each club's league: that of its latest league match in the window."""
        tl = np.full(len(self.teams), self.lidx[OTHER], dtype=np.int64)
        idx = np.nonzero(mask & (self.lg >= 0))[0]
        for i in idx:  # matches are in date order, so the latest wins
            tl[self.h[i]] = tl[self.a[i]] = self.lg[i]
        return tl


def weights(data, as_of, recipe):
    """Each match's weight for a fit on the morning of as_of (an ordinal): only
    earlier matches within `years`, halving every half_life days."""
    age = as_of - data.ord
    mask = (age > 0) & (age <= 365 * recipe["years"])
    w = np.where(mask, 0.5 ** (np.maximum(age, 0) / recipe["half_life"]), 0.0)
    return mask, w


def tau(lh, la, hg, ag, rho):
    """Dixon-Coles low-score correction factor for each match."""
    t = np.ones_like(lh)
    t = np.where((hg == 0) & (ag == 0), 1 - lh * la * rho, t)
    t = np.where((hg == 0) & (ag == 1), 1 + lh * rho, t)
    t = np.where((hg == 1) & (ag == 0), 1 + la * rho, t)
    t = np.where((hg == 1) & (ag == 1), 1 - rho, t)
    return t


class Ratings:
    def __init__(self, data, tl, params, rho, as_of, n_used, recipe):
        self.data, self.tl, self.rho, self.as_of, self.n_used, self.recipe = data, tl, rho, as_of, n_used, recipe
        self.mu, self.home, self.A, self.D, self.att, self.dfn, self.dh = params

    def _side(self, key, league):
        i = self.data.tidx.get(key)
        own = OTHER if i is None else self.data.leagues[self.tl[i]]
        if own == OTHER and league in self.data.lidx:
            own = league  # no league match in the window yet (just promoted): use the competition's league
        li = self.data.lidx[own]
        a = self.att[i] if i is not None else 0.0
        d = self.dfn[i] if i is not None else 0.0
        return self.A[li] + a, self.D[li] + d

    def expected_goals(self, hk, ak, neutral=False, league=None):
        """(home, away) expected goals. league: the competition's league code
        for a league match, None for the Champions League."""
        ha, hd = self._side(hk, league)
        aa, ad = self._side(ak, league)
        g = self.data.lidx.get(league or OTHER, self.data.lidx[OTHER])
        home = 0.0 if neutral else self.home + self.dh[g]
        lh = math.exp(self.mu + home + ha - ad)
        la = math.exp(self.mu + aa - hd)
        return lh, la

    def probs(self, hk, ak, neutral=False, league=None):
        """{"home", "draw", "away"} chances (0-1) and the expected goals."""
        lh, la = self.expected_goals(hk, ak, neutral, league)
        p = outcome_probs(lh, la, self.rho, self.recipe.get("draw") or 0.0)
        return {"home": p[0], "draw": p[1], "away": p[2], "xg": (lh, la)}

    def known(self, key):
        return key in self.data.tidx

    def strength(self, att, dfn):
        """Goal difference per match against an average side on neutral ground."""
        return math.exp(self.mu + att) - math.exp(self.mu - dfn)

    def table(self, active_since=None):
        """[(team key, league, strength)] for clubs with a match in the window."""
        mask, _ = weights(self.data, self.as_of, self.recipe)
        if active_since is not None:
            mask &= self.data.ord >= active_since
        active = set(self.data.h[mask]) | set(self.data.a[mask])
        out = []
        for i in active:
            li = self.tl[i]
            out.append((self.data.teams[i], self.data.leagues[li],
                        self.strength(self.A[li] + self.att[i], self.D[li] + self.dfn[i])))
        return sorted(out, key=lambda r: -r[2])

    def home_edges(self):
        """Each competition's home edge in goals a match (OTHER = Champions League)."""
        return {l: math.exp(self.mu + self.home + self.dh[i]) - math.exp(self.mu) for l, i in self.data.lidx.items()}

    def league_strengths(self):
        return {l: self.strength(self.A[i], self.D[i]) for l, i in self.data.lidx.items()}


def poisson_pmf(lam):
    k = np.arange(MAX_GOALS + 1)
    return np.exp(-lam + k * math.log(lam) - np.array([math.lgamma(x + 1) for x in k]))


def outcome_probs(lh, la, rho, draw=0.0):
    """(home win, draw, away win) from expected goals, the low-score correction
    and the draw inflation."""
    m = np.outer(poisson_pmf(lh), poisson_pmf(la))
    m[0, 0] *= max(1 - lh * la * rho, 1e-6)
    m[0, 1] *= max(1 + lh * rho, 1e-6)
    m[1, 0] *= max(1 + la * rho, 1e-6)
    m[1, 1] *= max(1 - rho, 1e-6)
    h, d, a = float(np.tril(m, -1).sum()), float(np.trace(m)) * (1 + draw), float(np.triu(m, 1).sum())
    s = h + d + a
    return h / s, d / s, a / s


def fit(data, as_of, recipe=None, warm=None, iters=80, tol=1e-5):
    """Ratings fitted on every match before as_of (YYYY-MM-DD or an ordinal).
    warm: earlier Ratings on the same data to start from. None if too few matches."""
    # The optional keys stay off unless the recipe names them, so a stored
    # recipe always means what it meant when it was chosen.
    recipe = {**{k: DEFAULT_RECIPE[k] for k in ("half_life", "reg", "years")}, **(recipe or DEFAULT_RECIPE)}
    as_of = ordinal(as_of) if isinstance(as_of, str) else as_of
    mask, wm = weights(data, as_of, recipe)
    used = int(mask.sum())
    if used < MIN_MATCHES:
        return None
    sel = np.nonzero(mask)[0]
    tl = data.team_leagues(mask)
    nt, nl = len(data.teams), len(data.leagues)
    att_i = np.concatenate([data.h[sel], data.a[sel]])
    def_i = np.concatenate([data.a[sel], data.h[sel]])
    y = np.concatenate([data.hg[sel], data.ag[sel]])
    xw = float(recipe.get("xg") or 0.0)
    if xw > 0:
        # Expected-goals proxy: goals per shot on target and per other shot,
        # fitted (weighted least squares) on the window's matches with shots.
        sh = data.shots[sel]
        sot = np.concatenate([sh[:, 2], sh[:, 3]])
        off = np.concatenate([sh[:, 0], sh[:, 1]]) - sot
        ok = np.isfinite(sot) & np.isfinite(off) & (off >= 0)
        if ok.sum() > 100:
            ww = np.concatenate([wm[sel], wm[sel]])[ok]
            X = np.stack([sot[ok], off[ok]], 1)
            coefs = np.linalg.solve((X * ww[:, None]).T @ X, (X * ww[:, None]).T @ y[ok])
            proxy = np.maximum(coefs[0] * sot[ok] + coefs[1] * off[ok], 0.0)
            y = y.copy()
            y[ok] = (1 - xw) * y[ok] + xw * proxy
    hf = np.concatenate([data.hf[sel], np.zeros(len(sel))])
    grp = np.concatenate([data.grp[sel], data.grp[sel]])
    hreg = recipe.get("home_reg")
    w = np.concatenate([wm[sel], wm[sel]])
    la_i, ld_i = tl[att_i], tl[def_i]
    reg = float(recipe["reg"])
    # A club new to its league (no match in it before the last 300 days of
    # the window) is pulled toward -promoted rather than the league average.
    prior = np.zeros(nt)
    if recipe.get("promoted"):
        seasoned = np.zeros(nt, dtype=bool)
        old = sel[(as_of - data.ord[sel]) > 300]
        seasoned[data.h[old][tl[data.h[old]] == data.lg[old]]] = True
        seasoned[data.a[old][tl[data.a[old]] == data.lg[old]]] = True
        seen = np.zeros(nt, dtype=bool)
        seen[data.h[sel]] = seen[data.a[sel]] = True
        newbie = seen & ~seasoned & (tl != data.lidx[OTHER])
        prior[newbie] = -float(recipe["promoted"])

    if warm is not None:
        mu, home = warm.mu, warm.home
        A, D, att, dfn, dh = warm.A.copy(), warm.D.copy(), warm.att.copy(), warm.dfn.copy(), warm.dh.copy()
    else:
        mu = math.log(max(np.average(y, weights=w), 0.1))
        home, A, D, att, dfn = 0.25, np.zeros(nl), np.zeros(nl), np.zeros(nt), np.zeros(nt)
        dh = np.zeros(nl)

    def eta():
        return mu + (home + dh[grp]) * hf + A[la_i] + att[att_i] - D[ld_i] - dfn[def_i]

    for _ in range(iters):
        biggest = 0.0
        # Each block's Newton step: gradient over curvature, capped for safety.
        lam = np.exp(eta())
        r, c = w * (y - lam), w * lam
        step = (np.bincount(att_i, r, nt) - reg * (att - prior)) / (np.bincount(att_i, c, nt) + reg)
        step = np.clip(step, -1, 1)
        att += step
        biggest = max(biggest, float(np.abs(step).max()))

        lam = np.exp(eta())
        r, c = w * (y - lam), w * lam
        step = (-np.bincount(def_i, r, nt) - reg * (dfn - prior)) / (np.bincount(def_i, c, nt) + reg)
        step = np.clip(step, -1, 1)
        dfn += step
        biggest = max(biggest, float(np.abs(step).max()))

        lam = np.exp(eta())
        r, c = w * (y - lam), w * lam
        step = (np.bincount(la_i, r, nl) - LEAGUE_REG * A) / (np.bincount(la_i, c, nl) + LEAGUE_REG)
        A += np.clip(step, -1, 1)
        biggest = max(biggest, float(np.abs(step).max()))

        lam = np.exp(eta())
        r, c = w * (y - lam), w * lam
        step = (-np.bincount(ld_i, r, nl) - LEAGUE_REG * D) / (np.bincount(ld_i, c, nl) + LEAGUE_REG)
        D += np.clip(step, -1, 1)
        biggest = max(biggest, float(np.abs(step).max()))

        lam = np.exp(eta())
        s = float(np.clip((w * (y - lam)).sum() / (w * lam).sum(), -1, 1))
        mu += s
        lam = np.exp(eta())
        hs = float(np.clip((w * hf * (y - lam)).sum() / max((w * hf * lam).sum(), 1e-9), -1, 1))
        home += hs
        biggest = max(biggest, abs(s), abs(hs))
        if hreg is not None:
            lam = np.exp(eta())
            r, c = w * hf * (y - lam), w * hf * lam
            step = np.clip((np.bincount(grp, r, nl) - hreg * dh) / (np.bincount(grp, c, nl) + hreg), -1, 1)
            dh += step
            biggest = max(biggest, float(np.abs(step).max()))
        if biggest < tol:
            break

    # Dixon-Coles rho: the best weighted fit to the low scores.
    n = len(sel)
    e = eta()
    lh, la = np.exp(e[:n]), np.exp(e[n:])
    hg, ag, wmatch = data.hg[sel], data.ag[sel], wm[sel]
    low = (hg <= 1) & (ag <= 1)
    best, rho = -np.inf, 0.0
    for r_ in ([recipe["rho"]] if recipe.get("rho") is not None else RHO_GRID):
        t = tau(lh[low], la[low], hg[low], ag[low], r_)
        if (t <= 0).any():
            continue
        ll = float((wmatch[low] * np.log(t)).sum())
        if ll > best:
            best, rho = ll, float(r_)
    return Ratings(data, tl, (mu, home, A, D, att, dfn, dh), rho, as_of, used, recipe)


def pick_of(p):
    """The most likely outcome: "home", "draw" or "away"."""
    return max(("home", "draw", "away"), key=lambda k: p[k])


def outcome(hg, ag):
    return "home" if hg > ag else "away" if ag > hg else "draw"
