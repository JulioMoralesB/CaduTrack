"""A local, offline lookup from a Spanish food name to an emoji.

No network call, no model, no cost. Covers what a person actually types into
the "Nombre" field when adding a product by hand — not raw receipt text, which
arrives abbreviated and inconsistent (#84 owns cleaning that up before names
ever reach this table).

Matching is by word, not by exact full-string equality: a product is usually
typed as more than one word ("Nopal limpio", "Queso Oaxaca"), and the noun that
actually identifies the food is rarely the whole string. Each word of the
normalized name is checked against the table in order, trying the word itself
and then simple singular forms — the first hit wins.

Accuracy over coverage: an entry is only added when the emoji is genuinely a
recognizable match. A wrong icon is worse than the generic default, so several
common items with no accurate emoji (yogur has none dedicated to it; agua has
no bottled-water glyph) are deliberately left out rather than mapped to
something that would mislead at a glance.
"""

import re
import unicodedata

# Deliberately generic rather than food-shaped: it has to read as "something
# was bought" for anything from groceries to household items, not as a
# specific food the product may not be.
DEFAULT_ICON = "\U0001F9FA"  # 🧺 basket

# Grouped by category purely for maintainability — matching does not care
# about the grouping, only about the flat key -> emoji mapping below.
_ICON_TABLE: dict[str, str] = {
    # Frutas
    "platano": "\U0001F34C",  # 🍌
    "manzana": "\U0001F34E",  # 🍎
    "pera": "\U0001F350",  # 🍐
    "naranja": "\U0001F34A",  # 🍊
    "mandarina": "\U0001F34A",  # 🍊
    "limon": "\U0001F34B",  # 🍋
    "fresa": "\U0001F353",  # 🍓
    "uva": "\U0001F347",  # 🍇
    "sandia": "\U0001F349",  # 🍉
    "melon": "\U0001F348",  # 🍈
    "pina": "\U0001F34D",  # 🍍
    "mango": "\U0001F96D",  # 🥭
    "kiwi": "\U0001F95D",  # 🥝
    "durazno": "\U0001F351",  # 🍑
    "ciruela": "\U0001F351",  # 🍑 — no distinct plum emoji, peach is the closest
    "coco": "\U0001F965",  # 🥥
    "aguacate": "\U0001F951",  # 🥑
    "cereza": "\U0001F352",  # 🍒
    "arandano": "\U0001FAD0",  # 🫐
    # Verduras
    "tomate": "\U0001F345",  # 🍅
    "jitomate": "\U0001F345",  # 🍅
    "papa": "\U0001F954",  # 🥔
    "patata": "\U0001F954",  # 🥔
    "cebolla": "\U0001F9C5",  # 🧅
    "ajo": "\U0001F9C4",  # 🧄
    "zanahoria": "\U0001F955",  # 🥕
    "pepino": "\U0001F952",  # 🥒
    "lechuga": "\U0001F96C",  # 🥬
    "espinaca": "\U0001F96C",  # 🥬
    "brocoli": "\U0001F966",  # 🥦
    "chile": "\U0001F336\uFE0F",  # 🌶️ — VS16 makes it render as emoji, not text, style
    "pimiento": "\U0001FAD1",  # 🫑
    "elote": "\U0001F33D",  # 🌽
    "maiz": "\U0001F33D",  # 🌽
    "nopal": "\U0001F335",  # 🌵 — cactus, the closest available
    "champinon": "\U0001F344",  # 🍄
    "hongo": "\U0001F344",  # 🍄
    "berenjena": "\U0001F346",  # 🍆
    "ejote": "\U0001FADB",  # 🫛 pea pod, closest to a green bean
    "frijol": "\U0001FAD8",  # 🫘
    "habichuela": "\U0001FAD8",  # 🫘
    "calabaza": "\U0001F383",  # 🎃
    # Lácteos y huevo
    "leche": "\U0001F95B",  # 🥛
    "yogurt": "\U0001F95B",  # 🥛 — no dedicated yogurt emoji; dairy is still correct
    "yogur": "\U0001F95B",  # 🥛
    "queso": "\U0001F9C0",  # 🧀
    "mantequilla": "\U0001F9C8",  # 🧈
    "huevo": "\U0001F95A",  # 🥚
    # Carnes y pescado
    "carne": "\U0001F969",  # 🥩
    "res": "\U0001F969",  # 🥩
    "bistec": "\U0001F969",  # 🥩
    "milanesa": "\U0001F969",  # 🥩
    "cerdo": "\U0001F969",  # 🥩
    "puerco": "\U0001F969",  # 🥩
    "tocino": "\U0001F953",  # 🥓
    "jamon": "\U0001F356",  # 🍖
    "pollo": "\U0001F357",  # 🍗
    "pavo": "\U0001F983",  # 🦃
    "pescado": "\U0001F41F",  # 🐟
    "atun": "\U0001F41F",  # 🐟
    "camaron": "\U0001F364",  # 🍤
    "pulpo": "\U0001F419",  # 🐙
    "cangrejo": "\U0001F980",  # 🦀
    # Panadería y granos
    "pan": "\U0001F35E",  # 🍞
    "bolillo": "\U0001F35E",  # 🍞
    "tortilla": "\U0001FAD3",  # 🫓
    "pasta": "\U0001F35D",  # 🍝
    "espagueti": "\U0001F35D",  # 🍝
    "arroz": "\U0001F35A",  # 🍚
    "galleta": "\U0001F36A",  # 🍪
    "pastel": "\U0001F370",  # 🍰
    "torta": "\U0001F96A",  # 🥪 — everyday Mexican usage means "sandwich", not cake
    # Bebidas
    "jugo": "\U0001F9C3",  # 🧃
    "refresco": "\U0001F964",  # 🥤
    "soda": "\U0001F964",  # 🥤
    "cafe": "☕",  # ☕
    "te": "\U0001F375",  # 🍵
    "cerveza": "\U0001F37A",  # 🍺
    "vino": "\U0001F377",  # 🍷
    "chocolate": "\U0001F36B",  # 🍫
    # Condimentos y otros comestibles
    "sal": "\U0001F9C2",  # 🧂
    "aceite": "\U0001FAD2",  # 🫒
    "salsa": "\U0001F336\uFE0F",  # 🌶️ — most bottled Mexican salsa is chili-based
    "sopa": "\U0001F372",  # 🍲
    "caldo": "\U0001F372",  # 🍲
    "helado": "\U0001F366",  # 🍦
    "pizza": "\U0001F355",  # 🍕
    "miel": "\U0001F36F",  # 🍯
    # No-alimentos comunes en un ticket de supermercado
    "jabon": "\U0001F9FC",  # 🧼
    "shampoo": "\U0001F9F4",  # 🧴
    "detergente": "\U0001F9F4",  # 🧴
    "cloro": "\U0001F9F4",  # 🧴
    "papel": "\U0001F9FB",  # 🧻
    "pila": "\U0001F50B",  # 🔋
    "foco": "\U0001F4A1",  # 💡
}

_WORD_RE = re.compile(r"[a-z]+")


def normalize(name: str) -> str:
    """Lowercase and strip accents, for matching regardless of how they were typed."""
    decomposed = unicodedata.normalize("NFKD", name)
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return without_accents.lower()


def _candidates(word: str):
    """A word, then its likely singular — plurals are the main source of misses."""
    yield word
    if word.endswith("es") and len(word) > 3:
        yield word[:-2]
    if word.endswith("s") and len(word) > 2:
        yield word[:-1]


def resolve_icon(name: str) -> str:
    """An emoji for `name`, or DEFAULT_ICON when nothing in the table matches.

    Checks each word of the normalized name in order — the first table hit
    wins — so "Nopal limpio" matches on "nopal" even though the table has no
    entry for the two-word string as a whole.
    """
    for word in _WORD_RE.findall(normalize(name)):
        for candidate in _candidates(word):
            if candidate in _ICON_TABLE:
                return _ICON_TABLE[candidate]
    return DEFAULT_ICON
