"""Barcode photo decoding tests — see #132 and #137.

Real images, not mocked: this module's whole job is calling into OpenCV
and zbar correctly, so a test that mocks either would only prove the mock
was wired up, never that a real barcode photo actually decodes. Generated
images come from python-barcode (a real encoder) and go through the real
decode_barcode_photo, the same round-trip barcode_parser.py's own
docstring already holds itself to.
"""

import io
from pathlib import Path

import barcode
import pytest
from barcode.writer import ImageWriter
from PIL import Image

from app.barcode_photo import decode_barcode_photo

FIXTURES = Path(__file__).parent / "fixtures"


def _barcode_image(value: str, kind: str = "ean13") -> Image.Image:
    writer = ImageWriter()
    obj = barcode.get_barcode_class(kind)(value, writer=writer)
    buf = io.BytesIO()
    obj.write(buf, options={"write_text": False})
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _png_bytes(image: Image.Image) -> bytes:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.parametrize(
    "kind,value",
    [
        ("ean13", "590123412345"),
        ("ean8", "5901234"),
        ("code128", "012345678901231310212345693922000000"),
    ],
)
def test_decodes_a_real_barcode_photo(kind, value):
    image = _barcode_image(value, kind)

    result = decode_barcode_photo(_png_bytes(image))

    # ean13/ean8 auto-compute and append their own check digit, so the
    # input string alone is one digit short — get_fullcode() is
    # python-barcode's own authoritative expected value (a no-op for
    # code128, which has no such digit to append).
    assert result == barcode.get_barcode_class(kind)(value).get_fullcode()


def test_decodes_a_real_phone_photo_zbar_alone_cannot():
    """#137: a crop of a real bottle photo. The logo printed right next to
    the barcode reads as more bars to zbar scanning the whole frame, so it
    found nothing; localizing the barcode first is what makes it readable."""
    photo = (FIXTURES / "barcode_photo_real_label.jpg").read_bytes()

    assert decode_barcode_photo(photo) == "7501055320639"


def test_returns_none_when_the_photo_has_no_barcode_in_it():
    blank = Image.new("RGB", (200, 200), "white")

    assert decode_barcode_photo(_png_bytes(blank)) is None


def test_returns_none_when_the_bytes_are_not_an_image():
    assert decode_barcode_photo(b"not an image") is None


def test_picks_the_widest_barcode_when_a_photo_catches_more_than_one():
    """A reasonable stand-in for "the one actually being photographed" —
    see the module's own docstring."""
    small = _barcode_image("590123412345", "ean13")
    big = _barcode_image("400123412342", "ean13")
    big = big.resize((big.width * 3, big.height * 3))

    canvas = Image.new("RGB", (max(small.width, big.width), small.height + big.height + 20), "white")
    canvas.paste(small, (0, 0))
    canvas.paste(big, (0, small.height + 20))

    result = decode_barcode_photo(_png_bytes(canvas))

    assert result == barcode.get_barcode_class("ean13")("400123412342").get_fullcode()
