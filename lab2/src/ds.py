"""The Lab 2 design system, applied to the live site's CSS.

The live CSS uses about 25 font sizes and 30 letter-spacings, and sets most
labels in DM Mono. snap() rewrites a stylesheet onto a small set of tokens:

  type scale   11 12 14 16 18 20 24 28 32 40 48 56 (bigger and fluid sizes stay)
  tracking     -0.02em for big headings, 0 for text, 0.06em for small caps labels
  fonts        Archivo for everything, tabular figures for numbers;
               DM Mono only for chart axes; number columns use tabular figures
  labels       small caps labels in Archivo 600
"""
import re

SCALE = [11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56]


def size(px):
    if px > 60:
        return px
    best = min(SCALE, key=lambda s: (abs(s - px), s))  # ties go to the smaller size
    return best


def track(v):
    m = re.fullmatch(r"\s*(-?\d*\.?\d+)(em|px)\s*", v)
    if not m:
        return v
    n, u = float(m.group(1)), m.group(2)
    em = n if u == "em" else n / 12
    if em < -0.005:
        return "-0.02em"
    if em < 0.03:
        return "0"
    return "0.06em"


def block(decls):
    mono = "var(--font-mono)" in decls or "var(--f-mono)" in decls
    d = re.sub(r"font-size:\s*(\d*\.?\d+)px", lambda m: f"font-size: {size(float(m.group(1))):g}px", decls)
    d = re.sub(r"letter-spacing:\s*([^;}]+)", lambda m: "letter-spacing: " + track(m.group(1)), d)
    if mono:
        d = d.replace("var(--font-mono)", "var(--font)").replace("var(--f-mono)", "var(--f-display)")
        d += "; font-variant-numeric: tabular-nums"
        if "uppercase" in d and "font-weight" not in d:
            d += "; font-weight: 600"
    return d


def snap(css):
    css = re.sub(r"\{([^{}]*)\}", lambda m: "{" + block(m.group(1)) + "}", css)
    # the variable itself: anything still asking for mono gets the sans
    return css.replace("--font-mono: 'DM Mono'", "--font-data: 'DM Mono'").replace(
        "--font-data: 'DM Mono'", "--font-mono: var(--font); --font-data: 'DM Mono'", 1)
