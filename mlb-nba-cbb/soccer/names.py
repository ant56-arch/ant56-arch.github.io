"""
names.py - one key per club, whatever the source calls it.

football-data.co.uk writes "Man United", "Nott'm Forest" and "Ath Madrid";
ESPN writes "Manchester United", "Nottingham Forest" and "Atlético Madrid".
team_key() turns either into the same key: accents, punctuation and filler
words ("FC", "United", "Real" ...) are dropped, then ALIASES maps the
abbreviations that are left. A club whose ESPN name finds no match in the
league results is still rated, just only from its ESPN games; the research
pull lists those (unmatched()) so a missing alias is easy to spot and add.
"""

import re
import unicodedata

# Whole names that would collide once filler words are dropped, or that are
# spelled too differently to normalize. Matched on the cleaned full name
# (lowercase, no accents or punctuation) before anything is dropped.
FULL = {
    "manchester united": "man united", "man united": "man united", "man utd": "man united",
    "manchester city": "man city", "man city": "man city",
    "paris saint germain": "paris sg", "paris sg": "paris sg", "psg": "paris sg",
    "paris fc": "paris fc",
}

# Filler words dropped from every name.
DROP = {"fc", "afc", "cf", "ac", "as", "sc", "ssc", "rc", "rcd", "cd", "ud", "sd", "club", "de", "calcio", "1",
        "vfb", "vfl", "tsg", "bv", "sv", "united", "city", "town", "albion", "hotspur", "wanderers", "hove",
        "and", "real", "stade", "cp", "29", "ogc", "osc", "hellas", "borussia", "bayer", "fk", "sk", "kv",
        "deportivo", "cfc"}

# What's left after dropping, mapped to one spelling.
ALIASES = {
    # England
    "nottm forest": "nottingham forest", "wolves": "wolverhampton", "spurs": "tottenham",
    "west brom": "west bromwich", "qpr": "queens park rangers", "sheffield weds": "sheffield wednesday",
    # Spain
    "ath madrid": "atletico madrid", "atletico": "atletico madrid", "ath bilbao": "athletic",
    "athletic bilbao": "athletic", "celta": "celta vigo", "vallecano": "rayo vallecano", "espanol": "espanyol",
    "sociedad": "sociedad", "sp gijon": "sporting gijon", "la coruna": "la coruna",
    # Germany
    "ein frankfurt": "eintracht frankfurt", "mgladbach": "monchengladbach", "gladbach": "monchengladbach",
    "koln": "koln", "cologne": "koln", "bayern munchen": "bayern munich", "fortuna dusseldorf": "dusseldorf",
    "hertha": "hertha berlin", "hertha bsc": "hertha berlin", "hamburg": "hamburg", "hamburger": "hamburg",
    "st pauli": "st pauli", "mainz 05": "mainz", "fsv mainz 05": "mainz", "fsv mainz": "mainz",
    "greuther furth": "furth", "arminia bielefeld": "bielefeld", "schalke 04": "schalke",
    # Italy
    "internazionale": "inter", "inter milan": "inter", "milan": "milan", "roma": "roma",
    "parma calcio 1913": "parma",
    # France
    "rennais": "rennes", "brestois": "brest", "st etienne": "saint etienne", "monaco": "monaco",
    "olympique lyonnais": "lyon", "olympique marseille": "marseille", "olympique de marseille": "marseille",
    "lille": "lille", "le havre": "le havre", "clermont foot": "clermont", "ajaccio gfco": "ajaccio",
    # Portugal, Netherlands, Belgium, Turkey, Scotland (UCL regulars)
    "sp lisbon": "sporting", "sporting lisbon": "sporting", "sp braga": "braga", "porto": "porto",
    "psv": "psv eindhoven", "ajax amsterdam": "ajax", "feyenoord rotterdam": "feyenoord",
    "az alkmaar": "az alkmaar", "st gilloise": "union st gilloise", "union saint gilloise": "union st gilloise",
    "union sg": "union st gilloise", "royale union st gilloise": "union st gilloise",
    "brugge": "club brugge", "club brugge": "club brugge", "galatasaray": "galatasaray",
    "fenerbahce": "fenerbahce", "besiktas": "besiktas", "celtic": "celtic", "rangers": "rangers",
}


def clean(name):
    """Lowercase, no accents, no punctuation, single spaces."""
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " ").replace("'", "").replace(".", " ").replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return " ".join(s.split())


def team_key(name):
    """The one key for a club, from any source's spelling of it."""
    full = clean(name)
    if full in FULL:
        return FULL[full]
    if full in ALIASES:
        return ALIASES[full]
    words = [w for w in full.split() if w not in DROP]
    short = " ".join(words) or full
    return ALIASES.get(short, short)


def unmatched(espn_names, known_keys):
    """ESPN team names whose key never shows up in the league results."""
    return sorted({n for n in espn_names if team_key(n) not in known_keys})
