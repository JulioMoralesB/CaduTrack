"""Open Food Facts client tests. No network — every case is a mocked
httpx call."""

import httpx
import pytest

from app.off_client import lookup_product_name

_REQUEST = httpx.Request("GET", "https://world.openfoodfacts.org/api/v2/product/123.json")


def _response(**body) -> httpx.Response:
    return httpx.Response(status_code=200, json=body, request=_REQUEST)


def test_returns_the_spanish_name_when_present(mocker):
    mocker.patch(
        "app.off_client.httpx.get",
        return_value=_response(status=1, product={"product_name": "Coca-Cola", "product_name_es": "Coca-Cola"}),
    )

    assert lookup_product_name("5449000000996") == "Coca-Cola"


def test_falls_back_to_the_generic_name_when_no_spanish_name(mocker):
    mocker.patch(
        "app.off_client.httpx.get",
        return_value=_response(status=1, product={"product_name": "Chobani Yogurt", "product_name_es": ""}),
    )

    assert lookup_product_name("123") == "Chobani Yogurt"


def test_returns_none_when_the_product_is_not_found(mocker):
    mocker.patch(
        "app.off_client.httpx.get",
        return_value=_response(status=0, status_verbose="product not found"),
    )

    assert lookup_product_name("123") is None


def test_returns_none_when_neither_name_field_is_usable(mocker):
    mocker.patch(
        "app.off_client.httpx.get",
        return_value=_response(status=1, product={"product_name": "", "product_name_es": None}),
    )

    assert lookup_product_name("123") is None


def test_sends_a_user_agent(mocker):
    get = mocker.patch("app.off_client.httpx.get", return_value=_response(status=0))

    lookup_product_name("123")

    _, kwargs = get.call_args
    assert "User-Agent" in kwargs["headers"]


def test_escapes_a_code_with_characters_that_are_not_safe_in_a_url_path(mocker):
    """BarcodeScanPayload places no charset restriction on the raw scanned
    code, so a garbled scan can land here with characters that would
    otherwise break the request's own path segment."""
    get = mocker.patch("app.off_client.httpx.get", return_value=_response(status=0))

    lookup_product_name("01/29045580000076")

    (url,), _ = get.call_args
    assert url == "https://world.openfoodfacts.org/api/v2/product/01%2F29045580000076.json"


def test_returns_none_on_a_connection_failure(mocker):
    mocker.patch("app.off_client.httpx.get", side_effect=httpx.ConnectError("refused"))

    assert lookup_product_name("123") is None


def test_returns_none_on_a_timeout(mocker):
    mocker.patch("app.off_client.httpx.get", side_effect=httpx.TimeoutException("slow"))

    assert lookup_product_name("123") is None


def test_returns_none_on_an_http_error_status(mocker):
    mocker.patch(
        "app.off_client.httpx.get",
        return_value=httpx.Response(status_code=500, text="boom", request=_REQUEST),
    )

    assert lookup_product_name("123") is None


@pytest.mark.parametrize("bad_body", ['not json', '{"status": 1}'])
def test_returns_none_when_the_response_is_unparsable(mocker, bad_body):
    mocker.patch(
        "app.off_client.httpx.get",
        return_value=httpx.Response(status_code=200, content=bad_body, request=_REQUEST),
    )

    assert lookup_product_name("123") is None
