"""Spanish labels for the language-neutral keys the database stores.

Mirrors frontend/src/labels.ts. Duplicated rather than shared because the two
runtimes cannot import each other, and the alert has to speak the same Spanish
the UI does — seeing "fridge" in a notification from an app that says
"Refrigerador" everywhere else would read as a bug.
"""

LOCATION_LABELS: dict[str, str] = {
    "fridge": "Refrigerador",
    "freezer": "Congelador",
    "pantry": "Alacena",
}


def expiry_phrase(days_until_expiry: int) -> str:
    """Phrase a day count the way a person would say it."""
    if days_until_expiry < 0:
        days = abs(days_until_expiry)
        return "caducó ayer" if days == 1 else f"caducó hace {days} días"
    if days_until_expiry == 0:
        return "caduca hoy"
    if days_until_expiry == 1:
        return "caduca mañana"
    return f"caduca en {days_until_expiry} días"
