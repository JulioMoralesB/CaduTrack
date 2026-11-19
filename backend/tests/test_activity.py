"""Human activity and in-progress work on /health — see #215.

Same approach as test_access_auth.py: a genuine RSA keypair and genuinely
signed JWTs, with only Cloudflare's JWKS endpoint itself mocked.
"""

import json
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Request, Response
from jwt import PyJWKClient
from jwt.algorithms import RSAAlgorithm

from app import access_auth, activity, routers
from app.config import settings
from app.receipt_client import ReceiptExtraction, ReceiptItem

pytestmark = pytest.mark.integration

# Not test_access_auth.py's own domain: the JWKS client is shared and
# rebuilt only when the domain changes, and that module signs with a
# different keypair.
_TEAM_DOMAIN = "activity-test-team"
_AUD = "activity-test-audience"
_KID = "activity-test-kid"


@pytest.fixture(scope="module")
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


@pytest.fixture(autouse=True)
def fresh_activity():
    activity.reset()
    yield
    activity.reset()


@pytest.fixture
def access_configured(monkeypatch, rsa_keypair):
    # A fresh JWKS client, with nothing cached from an earlier test.
    monkeypatch.setattr(access_auth, "_jwks_client", None)
    monkeypatch.setattr(settings, "cf_access_team_domain", _TEAM_DOMAIN)
    monkeypatch.setattr(settings, "cf_access_aud", _AUD)
    _private, public_key = rsa_keypair
    jwk_json = json.loads(RSAAlgorithm.to_jwk(public_key))
    jwk_json.update(kid=_KID, alg="RS256", use="sig")
    monkeypatch.setattr(PyJWKClient, "fetch_data", lambda self: {"keys": [jwk_json]})


def _sign(private_key, **claims) -> str:
    payload = {"aud": _AUD, "exp": int(time.time()) + 3600}
    payload.update(claims)
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": _KID})


def _user_token(rsa_keypair) -> str:
    # A constructed address on a reserved domain — see CLAUDE.md.
    return _sign(rsa_keypair[0], email="someone@example.com", sub="test-user")


def _service_token(rsa_keypair) -> str:
    # What Cloudflare issues for a service token: no email, a common_name.
    return _sign(rsa_keypair[0], common_name="test-service-token.access", sub="")


def _get(api_client, path: str, token: str | None):
    headers = {"Cf-Access-Jwt-Assertion": token} if token else {}
    response = api_client.get(path, headers=headers)
    activity.wait_for_check()
    return response


def _health(api_client) -> dict:
    return api_client.get("/health").json()


def test_a_person_s_request_counts(api_client, access_configured, rsa_keypair):
    before = datetime.now(UTC)

    assert _get(api_client, "/products", _user_token(rsa_keypair)).status_code == 200

    recorded = datetime.fromisoformat(_health(api_client)["last_user_activity_at"])
    assert before <= recorded <= datetime.now(UTC)


def test_nobody_yet_is_null(api_client, access_configured):
    body = _health(api_client)

    assert body["last_user_activity_at"] is None
    assert datetime.fromisoformat(body["started_at"]) <= datetime.now(UTC)


def test_a_service_token_does_not_count(api_client, access_configured, rsa_keypair):
    """Signed by the same Access app, but a machine: no email claim."""
    assert _get(api_client, "/products", _service_token(rsa_keypair)).status_code == 200

    assert _health(api_client)["last_user_activity_at"] is None


def test_a_request_with_no_token_does_not_count(api_client, access_configured):
    """The LAN-only proxy hostname, which skips Access — the known gap."""
    assert _get(api_client, "/products", None).status_code == 200

    assert _health(api_client)["last_user_activity_at"] is None


@pytest.mark.parametrize("path", ["/health", "/summary"])
def test_the_polled_routes_do_not_count(api_client, access_configured, rsa_keypair, path):
    _get(api_client, path, _user_token(rsa_keypair))

    assert _health(api_client)["last_user_activity_at"] is None


def test_the_polled_routes_do_not_count_behind_the_api_prefix():
    """In the container uvicorn runs with root_path=/api (see __main__.py)
    and puts the prefix into the scope's path itself: nginx's /health
    arrives as "/api/health". TestClient doesn't, so this builds the scope
    the way uvicorn does — checked against a real uvicorn server."""
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/health",
        "root_path": "/api",
        "query_string": b"",
        "headers": [],
        "server": ("testserver", 80),
        "scheme": "http",
    }

    assert activity._route_path(Request(scope)) == "/health"


@pytest.mark.parametrize(
    "token",
    [
        pytest.param("not-a-jwt", id="garbage"),
        pytest.param("expired", id="expired"),
        pytest.param("wrong-audience", id="wrong-audience"),
        pytest.param("wrong-key", id="wrong-key"),
    ],
)
def test_an_invalid_token_does_not_count(api_client, access_configured, rsa_keypair, token):
    private_key = rsa_keypair[0]
    tokens = {
        "not-a-jwt": "not-a-jwt",
        "expired": _sign(private_key, email="someone@example.com", exp=int(time.time()) - 60),
        "wrong-audience": _sign(private_key, email="someone@example.com", aud="another-app"),
        "wrong-key": _sign(rsa.generate_private_key(public_exponent=65537, key_size=2048), email="someone@example.com"),
    }

    assert _get(api_client, "/products", tokens[token]).status_code == 200

    assert _health(api_client)["last_user_activity_at"] is None


def test_an_unreachable_jwks_neither_fails_nor_slows_the_request(
    api_client, access_configured, rsa_keypair, monkeypatch
):
    def hang_then_fail(self):
        time.sleep(1.5)
        raise OSError("Cloudflare unreachable")

    monkeypatch.setattr(PyJWKClient, "fetch_data", hang_then_fail)

    started = time.monotonic()
    response = api_client.get("/products", headers={"Cf-Access-Jwt-Assertion": _user_token(rsa_keypair)})
    elapsed = time.monotonic() - started

    assert response.status_code == 200
    assert elapsed < 1.0
    activity.wait_for_check()
    assert activity.last_user_activity_at() is None


def test_nothing_counts_without_access_configured(api_client, monkeypatch, rsa_keypair):
    monkeypatch.setattr(settings, "cf_access_team_domain", "")
    monkeypatch.setattr(settings, "cf_access_aud", "")

    _get(api_client, "/products", _user_token(rsa_keypair))

    assert _health(api_client)["last_user_activity_at"] is None


def test_the_time_never_moves_backwards():
    later = datetime.now(UTC)
    activity._record(later)
    activity._record(later - timedelta(seconds=30))

    assert activity.last_user_activity_at() == later


class TestBusy:
    def test_idle(self, api_client):
        assert _health(api_client)["busy"] is False

    def test_a_label_photo_waiting_to_be_read(self, api_client, mocker):
        mocker.patch("app.routers.label_scans.process_pending")
        scan_id = api_client.post("/label-scans", files={"image": ("label.jpg", b"photo", "image/jpeg")}).json()["id"]

        assert _health(api_client)["busy"] is True

        api_client.post(f"/label-scans/{scan_id}/drop")
        assert _health(api_client)["busy"] is False

    def test_a_receipt_being_read(self, api_client, mocker):
        seen_during_read: list[bool] = []

        def read_receipt(_contents):
            seen_during_read.append(routers.health.health(Response())["busy"])
            return ReceiptExtraction(
                items=[ReceiptItem(raw_name="LECHE", quantity=Decimal("1"), is_food=True)], stated_item_count=None
            )

        mocker.patch("app.routers.trips.extract_receipt", side_effect=read_receipt)
        mocker.patch("app.routers.trips.expand_names", return_value={})

        response = api_client.post("/trips/receipt", files={"image": ("r.jpg", b"photo", "image/jpeg")})

        assert response.status_code == 201
        assert seen_during_read == [True]
        assert _health(api_client)["busy"] is False

    def test_a_failed_receipt_read_is_not_left_busy(self, api_client, mocker):
        mocker.patch("app.routers.trips.extract_receipt", return_value=None)

        response = api_client.post("/trips/receipt", files={"image": ("r.jpg", b"photo", "image/jpeg")})

        assert response.status_code == 503
        assert _health(api_client)["busy"] is False
