"""Turn every fixed colour in the web app's stylesheets into a colour token.

Usage: python3 scripts/theme_tokens.py apps/web/src [--apply]
Already applied once; new stylesheets with fixed colours can be run through it again.
Dark values are the original colours, so the dark theme looks the same as before. Light and
high-contrast values are derived per role (text, background, border) in OKLCH.
"""
import math
import pathlib
import re
import sys
from collections import Counter, defaultdict

SRC = pathlib.Path(sys.argv[1])
APPLY = "--apply" in sys.argv
SKIP = {"theme.css", "theme-tokens.css"}
FILES = [p for p in sorted(SRC.rglob("*.css")) if p.name not in SKIP]

COLOUR = re.compile(
    r"#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b"
    r"|rgba?\(\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*[0-9.]+\s*(?:,\s*[0-9.]+%?\s*)?\)"
    r"|(?<![-\w])(?:white|black)(?![-\w])"
)
DECL = re.compile(r"([-\w]+)\s*:\s*([^;{}]+)(;|(?=}))")


def parse(text):
    t = text.lower()
    if t == "white":
        return (255, 255, 255, 1.0)
    if t == "black":
        return (0, 0, 0, 1.0)
    if t.startswith("#"):
        h = t[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return (r, g, b, round(a, 3))
    nums = re.findall(r"[0-9.]+%?", t)
    r, g, b = (float(n) for n in nums[:3])
    a = 1.0
    if len(nums) > 3:
        a = float(nums[3].rstrip("%")) / (100 if nums[3].endswith("%") else 1)
    return (round(r), round(g), round(b), round(a, 3))


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def delin(c):
    c = max(0.0, min(1.0, c))
    return 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)


def to_oklch(rgb):
    r, g, b = (lin(c) for c in rgb)
    l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360


def from_oklch(L, C, H):
    for _ in range(40):  # reduce chroma until the colour fits in sRGB
        A, B = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
        l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
        m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
        s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
        rgb = (
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        )
        if all(-0.001 <= c <= 1.001 for c in rgb):
            break
        C *= 0.9
    return tuple(round(delin(c)) for c in rgb)


def luminance(rgb):
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def role_of(prop):
    p = prop.lower()
    if p.startswith("--"):
        if re.search(r"surface|bg|panel|header|raised|soft|backdrop|fill", p):
            return "bg"
        if re.search(r"line|border", p):
            return "border"
        return "text"
    if p in ("color", "fill", "caret-color", "text-decoration-color", "stroke", "accent-color"):
        return "text"
    if p.startswith("background"):
        return "bg"
    if p.startswith("border") or p.startswith("outline") or p in ("column-rule",):
        return "border"
    if "shadow" in p:
        return "shadow"
    return "text"


HUES = [(20, "red"), (50, "orange"), (85, "amber"), (110, "yellow"), (150, "green"),
        (190, "teal"), (230, "cyan"), (255, "blue"), (285, "indigo"), (320, "violet"),
        (350, "pink"), (361, "red")]


def hue_name(L, C, H):
    if C < 0.035:
        return "grey" if C < 0.015 else "slate"
    return next(name for limit, name in HUES if H < limit)


def light_value(rgb, role):
    L, C, H = to_oklch(rgb)
    if role == "bg":
        if C > 0.1 and 0.45 < L < 0.8:
            return from_oklch(L * 0.85, C, H)  # saturated fills (buttons, badges) keep their colour
        if L <= 0.215:
            L2 = 0.968 + (0.215 - L) * 0.25
        elif L <= 0.30:
            L2 = 1.0 - (L - 0.215) / 0.085 * 0.025
        elif L <= 0.55:
            L2 = 0.975 - (L - 0.30) / 0.25 * 0.16
        else:
            L2 = max(0.2, 1.17 - L)
        return from_oklch(min(L2, 1.0), C * (0.6 if L2 > 0.85 else 1.0), H)
    if role == "border":
        return from_oklch(max(0.55, min(0.93, 1.2 - L)), C * 0.7, H)
    # Text and icons: mirror the lightness so light-on-dark becomes dark-on-light.
    L2 = 1.16 - L
    if L >= 0.45:
        L2 = min(L2, 0.5)  # muted and accent text must reach 4.5:1 on light backgrounds
    return from_oklch(max(0.18, min(0.97, L2)), min(C, 0.2), H)


def hc_value(rgb, role, theme):
    L, C, H = to_oklch(rgb)
    if role == "text":
        L = min(1.0, L * 1.1 + 0.08) if theme == "dark" else max(0.0, L * 0.7 - 0.04)
    elif role == "border":
        L = min(0.85, L + 0.3) if theme == "dark" else max(0.3, L - 0.35)
    elif role == "bg" and C > 0.1 and 0.4 < L < 0.8:
        L = L * 0.8
    return from_oklch(L, C, H)


def css(rgb, alpha=1.0):
    r, g, b = rgb
    if alpha >= 0.999:
        return f"#{r:02x}{g:02x}{b:02x}"
    return f"rgb({r} {g} {b} / {alpha:g})"


# 1. Collect every colour with its role.
uses = []  # (file, rgba, role)
texts = {f: f.read_text() for f in FILES}
on_accent = set()
for f, text in texts.items():
    for block in re.finditer(r"\{([^{}]*)\}", text):
        decls = DECL.findall(block.group(1))
        bg = [parse(c) for p, v, _ in decls if p.startswith("background") for c in COLOUR.findall(v)]
        saturated = any(a > 0.9 and to_oklch((r, g, b))[1] > 0.05 and to_oklch((r, g, b))[0] > 0.3 for r, g, b, a in bg)
        for prop, value, _ in decls:
            for c in COLOUR.findall(value):
                rgba = parse(c)
                role = role_of(prop)
                if role == "text" and saturated and rgba[:3] == (255, 255, 255):
                    role = "on-accent"
                uses.append((f, rgba, role))

# 2. Merge colours that look the same, per role.
tokens = {}  # (rgba, role) -> name
groups = defaultdict(list)
for _, rgba, role in uses:
    groups[role].append(rgba)
names = Counter()
values = {}
for role, colours in groups.items():
    reps = []
    for rgba, _ in Counter(colours).most_common():
        lab = to_oklch(rgba[:3])
        match = None
        for rep in reps:
            rl = to_oklch(rep[:3])
            dist = math.dist(
                (lab[0], lab[1] * math.cos(math.radians(lab[2])), lab[1] * math.sin(math.radians(lab[2]))),
                (rl[0], rl[1] * math.cos(math.radians(rl[2])), rl[1] * math.sin(math.radians(rl[2]))),
            )
            if dist < 0.012 and abs(rep[3] - rgba[3]) < 0.02:
                match = rep
                break
        if match is None:
            reps.append(rgba)
            match = rgba
        key = (match, role)
        if key not in values:
            L, C, H = to_oklch(match[:3])
            base = f"--c-{role}-{hue_name(L, C, H)}-{round(L * 100)}"
            if match[3] < 0.999:
                base += f"-a{round(match[3] * 100)}"
            names[base] += 1
            name = base if names[base] == 1 else f"{base}-{names[base]}"
            values[key] = name
        tokens[(rgba, role)] = values[key]

# 3. Work out each token's value in every theme.
themes = {"dark": {}, "light": {}, "dark-hc": {}, "light-hc": {}}
for (rgba, role), name in values.items():
    rgb, alpha = rgba[:3], rgba[3]
    if role == "on-accent":
        for t in themes:
            themes[t][name] = css(rgb, alpha)
        continue
    if alpha < 0.999 and rgb in ((0, 0, 0), (255, 255, 255)):
        light_rgb, light_alpha = (0, 0, 0), alpha * (0.5 if rgb == (0, 0, 0) else 0.6)
        if role == "shadow" or rgb == (0, 0, 0):
            light_alpha = alpha * 0.45
    else:
        light_rgb, light_alpha = light_value(rgb, "text" if alpha < 0.999 else role), alpha
    themes["dark"][name] = css(rgb, alpha)
    themes["light"][name] = css(light_rgb, light_alpha)
    themes["dark-hc"][name] = css(hc_value(rgb, role, "dark"), alpha)
    themes["light-hc"][name] = css(hc_value(light_rgb, role, "light"), light_alpha)

# 3b. The original dark theme had three pairs under 4.5:1. Nudge those tokens until they pass.
def nudge(name, against, direction):
    fixed = {}
    for t in ("dark", "dark-hc"):
        rgb = hexrgb(themes[t][name])
        other = hexrgb(themes[t][against])
        L, C, H = to_oklch(rgb)
        while contrast(rgb, other) < 4.6 and 0.05 < L < 0.98:
            L += 0.01 * direction
            rgb = from_oklch(L, C, H)
        themes[t][name] = css(rgb)
def hexrgb(v):
    if v.startswith("#"):
        return tuple(int(v[i : i + 2], 16) for i in (1, 3, 5))
    return None
DARK_FIXES = [("--c-bg-orange-64", "--c-on-accent-grey-100", -1),
              ("--c-bg-indigo-52", "--c-text-indigo-85-2", -1),
              ("--c-text-indigo-56", "--c-bg-slate-21", 1)]
for name, against, direction in DARK_FIXES:
    if name in themes["dark"] and against in themes["dark"]:
        nudge(name, against, direction)

# 4. Contrast: text tokens against the page and card backgrounds, and pairs set in one rule.
PAGES = {"dark": [(17, 24, 39), (27, 37, 54)]}
def hexrgb(v):
    if v.startswith("#"):
        return tuple(int(v[i : i + 2], 16) for i in (1, 3, 5))
    return None
report = []
pairs = set()
for f, text in texts.items():
    for block in re.finditer(r"\{([^{}]*)\}", text):
        decls = DECL.findall(block.group(1))
        fg = [(parse(c), "text") for p, v, _ in decls if role_of(p) == "text" and not p.startswith("--") for c in COLOUR.findall(v)]
        bg = [(parse(c), "bg") for p, v, _ in decls if p in ("background", "background-color") for c in COLOUR.findall(v)]
        sat = any(c[0][3] > 0.9 and to_oklch(c[0][:3])[1] > 0.05 and to_oklch(c[0][:3])[0] > 0.3 for c in bg)
        for a in fg:
            for b in bg:
                if a[0][3] > 0.99 and b[0][3] > 0.99:
                    r = "on-accent" if sat and a[0][:3] == (255, 255, 255) else "text"
                    fa = tokens.get((a[0], r))
                    pairs.add((fa, tokens[(b[0], "bg")]))
page_tokens = {"--c-bg-slate-21", "--c-bg-slate-25"}
for name in {n for (k, r), n in values.items() if r == "text" and k[3] > 0.99}:
    for p in page_tokens:
        pairs.add((name, p))
for t, vals in themes.items():
    fails = []
    for fg, bg in pairs:
        if fg in vals and bg in vals and hexrgb(vals[fg]) and hexrgb(vals[bg]):
            ratio = contrast(hexrgb(vals[fg]), hexrgb(vals[bg]))
            if ratio < 4.5:
                fails.append((round(ratio, 2), fg, vals[fg], bg, vals[bg]))
    report.append((t, sorted(fails)))

print(f"{len(uses)} colour uses, {len(values)} tokens")
for t, fails in report:
    print(f"\n{t}: {len(fails)} text/background pairs under 4.5:1")
    for row in fails[:60]:
        print("  ", row)

if APPLY:
    for f, text in texts.items():
        out = []
        for block in re.split(r"(\{[^{}]*\})", text):
            if not block.startswith("{"):
                out.append(block)
                continue
            decls = DECL.findall(block)
            bg = [parse(c) for p, v, _ in decls if p.startswith("background") for c in COLOUR.findall(v)]
            saturated = any(a > 0.9 and to_oklch((r, g, b))[1] > 0.05 and to_oklch((r, g, b))[0] > 0.3 for r, g, b, a in bg)
            def fix_decl(m):
                prop, value, end = m.group(1), m.group(2), m.group(3)
                role = role_of(prop)
                def swap(c):
                    rgba = parse(c.group(0))
                    r = role
                    if r == "text" and saturated and rgba[:3] == (255, 255, 255):
                        r = "on-accent"
                    return f"var({tokens[(rgba, r)]})"
                return f"{prop}: {COLOUR.sub(swap, value)}{end}"
            out.append(DECL.sub(fix_decl, block))
        f.write_text("".join(out))
    lines = ["/* Colour tokens. Generated from the original dark colours; light is the default theme. */"]
    def block(selector, vals):
        lines.append(f"{selector} {{")
        lines.extend(f"  {k}: {v};" for k, v in sorted(vals.items()))
        lines.append("}")
    block(':root,\n:root[data-theme="light"]', themes["light"])
    block(':root[data-theme="dark"]', themes["dark"])
    lines.append('@media (prefers-color-scheme: dark) {')
    block(':root[data-theme="auto"]', themes["dark"])
    lines.append("}")
    block(':root.pref-hc,\n:root.pref-hc[data-theme="light"]', themes["light-hc"])
    block(':root.pref-hc[data-theme="dark"]', themes["dark-hc"])
    lines.append('@media (prefers-color-scheme: dark) {')
    block(':root.pref-hc[data-theme="auto"]', themes["dark-hc"])
    lines.append("}")
    (SRC / "theme-tokens.css").write_text("\n".join(lines) + "\n")
    print("applied; wrote theme-tokens.css")
