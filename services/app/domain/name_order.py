"""Order people by surname, keeping particles such as "Le" in "Le Guin"."""

import re

from sqlalchemy import func

PARTICLES = r"le|la|de|du|di|da|del|della|der|den|van|von|st\.?"
# The last word, with any particles before it. Matched against lower-case, single-spaced text.
PATTERN = rf"(?:^|\s)((?:(?:{PARTICLES})\s+)*\S+)$"


def surname(name: str | None) -> str | None:
    text = " ".join((name or "").lower().split())
    if not text:
        return None
    found = re.search(PATTERN, text)
    return found.group(1) if found else text


def surname_sql(name):
    text = func.lower(func.trim(func.regexp_replace(name, r"\s+", " ", "g")))
    return func.coalesce(func.substring(text, PATTERN), text)
