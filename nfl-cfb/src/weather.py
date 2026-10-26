"""
weather.py - kickoff weather for the NFL "weather" tryout, from Open-Meteo
(open-meteo.com: free, no key).

Weather mostly changes how many points get scored, not who's better, so the
tryout gives the spread model two inputs (game_context.weather_features):
  wind_shrink - wind/10 mph times the points-rating gap: lets strong wind pull
                the projected margin toward 0, since fewer points get scored
  cold_visitor - how far below 40F it is, in 10s of degrees, when the visitor
                 plays its home games under a roof or somewhere warm
Domes and closed roofs count as calm, 70F. Past games read
data/weather/nfl_weather.csv (built from Open-Meteo's archive by the
research job, tools/free_data/weather.py); upcoming games read Open-Meteo's
forecast for the home stadium.
"""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "..", "data", "weather", "nfl_weather.csv")

# Home stadium (lat, lon). Close enough for weather; relocations by season.
NFL_STADIUMS = {
    "ARI": (33.528, -112.263), "ATL": (33.755, -84.401), "BAL": (39.278, -76.623), "BUF": (42.774, -78.787),
    "CAR": (35.226, -80.853), "CHI": (41.862, -87.617), "CIN": (39.095, -84.516), "CLE": (41.506, -81.700),
    "DAL": (32.748, -97.093), "DEN": (39.744, -105.020), "DET": (42.340, -83.046), "GB": (44.501, -88.062),
    "HOU": (29.685, -95.411), "IND": (39.760, -86.164), "JAX": (30.324, -81.637), "KC": (39.049, -94.484),
    "LV": (36.091, -115.184), "LAC": (33.953, -118.339), "LA": (33.953, -118.339), "MIA": (25.958, -80.239),
    "MIN": (44.974, -93.258), "NE": (42.091, -71.264), "NO": (29.951, -90.081), "NYG": (40.814, -74.074),
    "NYJ": (40.814, -74.074), "PHI": (39.901, -75.168), "PIT": (40.447, -80.016), "SF": (37.403, -121.970),
    "SEA": (47.595, -122.332), "TB": (27.976, -82.503), "TEN": (36.166, -86.771), "WAS": (38.908, -76.864),
    "OAK": (37.752, -122.201), "SD": (32.783, -117.120), "STL": (38.633, -90.188),
}
# Teams whose home games are under a roof, or warm enough that cold is foreign to them.
ROOF_OR_WARM = {"ARI", "ATL", "DAL", "DET", "HOU", "IND", "LV", "LAC", "LA", "MIA", "MIN", "NO", "TB", "JAX", "STL", "SD", "OAK"}
CALM = {"temp_f": 70.0, "wind_mph": 0.0, "precip_mm": 0.0}


def stadium_for(team, season, location=""):
    if location == "Neutral":
        return None
    if team in ("LA", "LAC") and season < 2020:
        return (34.014, -118.288) if team == "LA" else (33.864, -118.261)
    return NFL_STADIUMS.get(team)


def load_history():
    import csv
    try:
        with open(PATH) as f:
            return {r["game_id"]: {k: float(r[k]) for k in ("temp_f", "wind_mph", "precip_mm")}
                    for r in csv.DictReader(f)}
    except FileNotFoundError:
        return {}


def forecast(lat, lon, day, hour):
    """Open-Meteo's forecast for one kickoff hour (Eastern), or None."""
    url = ("https://api.open-meteo.com/v1/forecast?"
           f"latitude={lat}&longitude={lon}&start_date={day}&end_date={day}"
           "&hourly=temperature_2m,wind_speed_10m,precipitation&wind_speed_unit=mph"
           "&temperature_unit=fahrenheit&timezone=America%2FNew_York")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "NFL Edge"}), timeout=30) as r:
            h = json.load(r)["hourly"]
        i = h["time"].index(f"{day}T{hour}:00")
        return {"temp_f": h["temperature_2m"][i], "wind_mph": h["wind_speed_10m"][i],
                "precip_mm": h["precipitation"][i]}
    except Exception as e:  # noqa: BLE001 - no forecast means no weather input
        print(f"  weather forecast failed for {day} {lat},{lon}: {e}")
        return None
