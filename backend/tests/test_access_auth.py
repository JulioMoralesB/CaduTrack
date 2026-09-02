"""Auth middleware tests for mutating requests — see #114.

Exercises the real cryptographic verification path end to end: a genuine
RSA keypair, a genuine signed JWT, and PyJWT's own signature/audience/
expiry checks. The one thing that has to be mocked is Cloudflare's own
JWKS endpoint — not something a test should call over the network — so
PyJWKClient.fetch_data is patched to return a JWKS built from the same
keypair the token was signed with.
"""

import json
import time
from datetime import date, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt import PyJWKClient
from jwt.algorithms import RSAAlgorithm

from app.config import settings

pytestmark = pytest.mark.integration

_TEAM_DOMAIN = "test-team"
_AUD = "test-audience"
_KID = "test-kid"


def _product(**overrides) -> dict:
    payload = {
        "name": "Leche entera",
        "quantity": "2.00",
        "unit": "litros",
        "expires_at": str(date.today() + timedelta(days=5)),
        "location": "fridge",
        "notes": None,
    }
    payload.update(overrides)
    return payload


@pytest.fixture(scope="module")
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


@pytest.fixture
def jwks(rsa_keypair, monkeypatch):
    """Makes the real PyJWKClient network fetch return this keypair's own
    public key, as Cloudflare's own endpoint would — see the module
    docstring for why this is the only mocked piece."""
    _private, public_key = rsa_keypair
    jwk_json = json.loads(RSAAlgorithm.to_jwk(public_key))
    jwk_json.update(kid=_KID, alg="RS256", use="sig")
    monkeypatch.setattr(PyJWKClient, "fetch_data", lambda self: {"keys": [jwk_json]})


def _sign(rsa_keypair, **claim_overrides) -> str:
    private_key, _public = rsa_keypair
    claims = {"aud": _AUD, "exp": int(time.time()) + 3600, "email": "julio@example.com"}
    claims.update(claim_overrides)
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": _KID})


@pytest.fixture
def access_configured(monkeypatch):
    monkeypatch.setattr(settings, "cf_access_team_domain", _TEAM_DOMAIN)
    monkeypatch.setattr(settings, "cf_access_aud", _AUD)


@pytest.fixture
def api_key_configured(monkeypatch):
    monkeypatch.setattr(settings, "api_key", "test-shared-secret")


def test_a_mutation_is_allowed_when_neither_mechanism_is_configured(api_client):
    """Matches api_key's own documented default — see #114's own reasoning
    for why this must not lock an unconfigured deployment out of itself."""
    response = api_client.post("/products", json=_product())

    assert response.status_code == 201


def test_reads_are_never_checked_even_when_both_mechanisms_are_configured(
    api_client, access_configured, api_key_configured
):
    response = api_client.get("/products")

    assert response.status_code == 200


class TestApiKey:
    def test_rejects_a_mutation_with_no_key(self, api_client, api_key_configured):
        response = api_client.post("/products", json=_product())

        assert response.status_code == 401

    def test_rejects_the_wrong_key(self, api_client, api_key_configured):
        response = api_client.post("/products", json=_product(), headers={"X-API-Key": "not-it"})

        assert response.status_code == 401

    def test_accepts_the_configured_key(self, api_client, api_key_configured):
        response = api_client.post(
            "/products", json=_product(), headers={"X-API-Key": "test-shared-secret"}
        )

        assert response.status_code == 201

    def test_a_401_still_carries_cors_headers(self, api_client, api_key_configured):
        """Regression guard: this middleware has to run before
        CORSMiddleware wraps it (see main.py's own comment on the add_
        middleware ordering) — added the other way around once, verified
        directly that a rejected request loses Access-Control-Allow-Origin
        entirely, which a browser reports as an opaque network error
        instead of a readable 401."""
        # Must be an origin settings.cors_origin_list actually allows
        # (the default, http://localhost:5173) — CORSMiddleware correctly
        # omits the header for one that isn't, which would look identical
        # to this exact regression and give a false pass.
        response = api_client.post("/products", json=_product(), headers={"Origin": "http://localhost:5173"})

        assert response.status_code == 401
        assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


class TestCloudflareAccess:
    def test_rejects_a_mutation_with_no_jwt(self, api_client, access_configured):
        response = api_client.post("/products", json=_product())

        assert response.status_code == 401

    def test_accepts_a_validly_signed_token(self, api_client, access_configured, jwks, rsa_keypair):
        token = _sign(rsa_keypair)

        response = api_client.post("/products", json=_product(), headers={"Cf-Access-Jwt-Assertion": token})

        assert response.status_code == 201

    def test_rejects_a_token_signed_by_a_different_key(self, api_client, access_configured, jwks):
        other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        forged = jwt.encode(
            {"aud": _AUD, "exp": int(time.time()) + 3600}, other_key, algorithm="RS256", headers={"kid": _KID}
        )

        response = api_client.post("/products", json=_product(), headers={"Cf-Access-Jwt-Assertion": forged})

        assert response.status_code == 401

    def test_rejects_a_token_for_a_different_audience(self, api_client, access_configured, jwks, rsa_keypair):
        """A JWT that is validly signed by Cloudflare, but issued for a
        different Access Application, must not pass here — checking only
        the signature and not the audience would let any of Julio's other
        Access-protected apps into this one."""
        token = _sign(rsa_keypair, aud="someone-elses-application")

        response = api_client.post("/products", json=_product(), headers={"Cf-Access-Jwt-Assertion": token})

        assert response.status_code == 401

    def test_rejects_an_expired_token(self, api_client, access_configured, jwks, rsa_keypair):
        token = _sign(rsa_keypair, exp=int(time.time()) - 60)

        response = api_client.post("/products", json=_product(), headers={"Cf-Access-Jwt-Assertion": token})

        assert response.status_code == 401

    def test_rejects_garbage_that_is_not_a_jwt_at_all(self, api_client, access_configured):
        response = api_client.post(
            "/products", json=_product(), headers={"Cf-Access-Jwt-Assertion": "not-a-real-token"}
        )

        assert response.status_code == 401

    def test_a_jwks_fetch_failure_is_rejected_not_a_500(self, api_client, access_configured, monkeypatch):
        """Cloudflare being briefly unreachable must read as "not
        authenticated", not as a crash that could hide an auth bypass
        behind an unrelated-looking error."""
        monkeypatch.setattr(
            PyJWKClient, "fetch_data", lambda self: (_ for _ in ()).throw(ConnectionError("unreachable"))
        )

        response = api_client.post(
            "/products", json=_product(), headers={"Cf-Access-Jwt-Assertion": "irrelevant.irrelevant.irrelevant"}
        )

        assert response.status_code == 401


class TestEitherMechanism:
    def test_the_api_key_still_works_when_access_is_also_configured(
        self, api_client, access_configured, api_key_configured
    ):
        response = api_client.post(
            "/products", json=_product(), headers={"X-API-Key": "test-shared-secret"}
        )

        assert response.status_code == 201

    def test_a_valid_token_still_works_when_the_api_key_is_also_configured(
        self, api_client, access_configured, api_key_configured, jwks, rsa_keypair
    ):
        token = _sign(rsa_keypair)

        response = api_client.post("/products", json=_product(), headers={"Cf-Access-Jwt-Assertion": token})

        assert response.status_code == 201

    def test_rejects_when_both_are_configured_and_neither_is_satisfied(
        self, api_client, access_configured, api_key_configured
    ):
        response = api_client.post("/products", json=_product())

        assert response.status_code == 401
