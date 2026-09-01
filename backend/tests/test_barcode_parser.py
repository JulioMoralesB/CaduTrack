"""Barcode parsing tests.

The GS1-128 shape asserted here — no separators between (01) and (310n) —
is not assumed: it is exactly what a real GS1-128 barcode built from #30's
own HEB example decoded to, verified independently with zbar and cross-
checked against Chrome's BarcodeDetector on the same image.
"""

from decimal import Decimal

from app.barcode_parser import is_restricted_circulation, parse_barcode


def test_a_plain_ean13_is_its_own_item_code_with_no_weight():
    result = parse_barcode("2520157108483")

    assert result.item_code == "2520157108483"
    assert result.quantity is None
    assert result.unit is None


def test_a_gs1_gtin_with_a_weight_is_split_apart():
    """The nopal label from #30's own example: (01) GTIN, (3103) net
    weight in kg to 3 decimal places -> 0.586 kg, rounded to the 2 decimal
    places Product.quantity actually stores."""
    raw = "01" + "29045580000076" + "3103" + "000586"

    result = parse_barcode(raw)

    assert result.item_code == "29045580000076"
    assert result.quantity == Decimal("0.59")
    assert result.unit == "kg"


def test_a_gs1_gtin_with_a_trailing_field_after_the_weight_is_still_parsed():
    """A real label also carries (3922) the price — not something this
    parser reads, see its own module docstring, but its presence after the
    weight must not break extracting the weight itself."""
    raw = "01" + "29045580000076" + "3103" + "000586" + "3922" + "00002341"

    result = parse_barcode(raw)

    assert result.item_code == "29045580000076"
    assert result.quantity == Decimal("0.59")


def test_a_gs1_gtin_with_no_weight_field_has_no_quantity():
    raw = "01" + "29045580000076"

    result = parse_barcode(raw)

    assert result.item_code == "29045580000076"
    assert result.quantity is None
    assert result.unit is None


def test_a_gtin_prefix_with_a_non_digit_gtin_is_not_treated_as_gs1():
    """"01" followed by something that isn't a 14-digit number is not a
    GTIN — the whole raw value is the item code instead of misreading a
    garbled prefix as one."""
    raw = "01abcdefghijklmn"

    result = parse_barcode(raw)

    assert result.item_code == raw
    assert result.quantity is None


def test_a_weight_field_that_is_not_actually_6_digits_is_ignored():
    """A malformed or truncated weight field must not produce a wrong
    quantity — see #83/#84's own "never guess" standard applied here too."""
    raw = "01" + "29045580000076" + "3103" + "12"  # too short

    result = parse_barcode(raw)

    assert result.item_code == "29045580000076"
    assert result.quantity is None


def test_a_zero_weight_is_treated_as_absent():
    raw = "01" + "29045580000076" + "3103" + "000000"

    assert parse_barcode(raw).quantity is None


def test_the_milanesa_label_from_30s_own_example_has_no_weight_field():
    """A plain EAN-13 never carries a GS1 weight — confirmed directly on
    the issue's own second real example, which has no AIs at all."""
    result = parse_barcode("2520157108483")

    assert result.quantity is None


def test_restricted_circulation_prefix():
    assert is_restricted_circulation("2520157108483") is True
    assert is_restricted_circulation("29045580000076") is True


def test_a_normal_prefix_is_not_restricted_circulation():
    assert is_restricted_circulation("5449000000996") is False
