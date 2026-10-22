"""Soccer team abbreviations ESPN gets wrong or makes confusing, fixed by
ESPN team id. ESPN calls Manchester United "MAN", Manchester City "MNC" and
Bayern Munich "MUN", so "MUN" on a Champions League card meant Bayern. Every
soccer feed we read (games.py, teams.py, site_check.py, soccer/espn.py) runs
its abbreviations through fix(); EDGE_SOCCER_ABBR in shared/edge.js is the
same table for the browser's live ESPN reads, so keep the two in step."""

FIX = {
    "360": "MUN",    # Manchester United (ESPN: MAN)
    "382": "MCI",    # Manchester City (MNC)
    "132": "FCB",    # Bayern Munich (MUN)
    "124": "BVB",    # Borussia Dortmund (DOR)
    "134": "STU",    # VfB Stuttgart (VFB)
    "99": "MAL",     # Málaga (MCF)
    "166": "LIL",    # Lille (LILL)
    "175": "LEN",    # Lens (RCL)
    "104": "ROM",    # AS Roma (ROMA)
    "2572": "COM",   # Como (COMO)
    "2980": "BOD",   # Bodø/Glimt (BODO)
    "437": "POR",    # FC Porto (FCP)
    "494": "SLA",    # Slavia Prague (SLP)
    "521": "SLO",    # Slovan Bratislava (SLB, which is Benfica's)
    "510": "VIK",    # Viking FK (VFK, sometimes VIK)
}


def fix(team_id, abbr):
    """The abbreviation to show for an ESPN soccer team."""
    return FIX.get(str(team_id or ""), abbr)
