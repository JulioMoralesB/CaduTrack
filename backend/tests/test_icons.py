"""Local icon lookup tests. No database — resolve_icon is pure."""

from app.icons import DEFAULT_ICON, normalize, resolve_icon


def test_a_table_hit_matches_regardless_of_accents_or_case():
    assert resolve_icon("PLÁTANO") == resolve_icon("platano")


def test_matches_a_word_inside_a_longer_typed_name():
    """What a person actually types is rarely just the noun on its own."""
    assert resolve_icon("Nopal limpio") == "\U0001F335"


def test_matches_a_simple_plural_by_stripping_the_trailing_s():
    assert resolve_icon("Tomates") == resolve_icon("Tomate")


def test_matches_a_word_needing_the_es_plural_form():
    assert resolve_icon("Frijoles negros") == resolve_icon("Frijol")


def test_an_unmatched_name_gets_the_default_rather_than_an_empty_result():
    assert resolve_icon("Sultán ácido muriático") == DEFAULT_ICON


def test_the_default_is_never_returned_for_a_name_that_does_match():
    """Guards against a future table entry accidentally equalling DEFAULT_ICON,
    which would make every miss indistinguishable from a real (unlikely) hit."""
    assert resolve_icon("Plátano") != DEFAULT_ICON


def test_normalize_strips_accents_and_lowercases():
    assert normalize("Jabón Grisi") == "jabon grisi"
