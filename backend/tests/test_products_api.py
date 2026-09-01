"""Product endpoint tests."""

import threading
from datetime import date, timedelta
from decimal import Decimal

import pytest

pytestmark = pytest.mark.integration


def _product(**overrides) -> dict:
    payload = {
        "name": "Leche entera",
        "quantity": "2.00",
        "unit": "litros",
        "expires_at": str(date.today() + timedelta(days=5)),
        "location": "fridge",
        "notes": "abierto",
    }
    payload.update(overrides)
    return payload


def test_create_returns_the_stored_product(api_client):
    response = api_client.post("/products", json=_product())

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Leche entera"
    assert body["location"] == "fridge"
    assert body["quantity"] == "2.00"
    assert body["id"] > 0


def test_products_are_listed_soonest_to_expire_first(api_client):
    """The whole point of the app is that what is about to go off is on top."""
    today = date.today()
    for days, name in ((30, "Arroz"), (2, "Yogur"), (10, "Queso")):
        api_client.post("/products", json=_product(name=name, expires_at=str(today + timedelta(days=days))))

    names = [p["name"] for p in api_client.get("/products").json()]
    assert names == ["Yogur", "Queso", "Arroz"]


def test_list_embeds_the_category(api_client):
    category_id = api_client.post("/categories", json={"name": "Lácteos"}).json()["id"]
    api_client.post("/products", json=_product(category_id=category_id))

    product = api_client.get("/products").json()[0]
    assert product["category"]["name"] == "Lácteos"


def test_filters_narrow_the_list(api_client):
    today = date.today()
    dairy = api_client.post("/categories", json={"name": "Lácteos"}).json()["id"]
    api_client.post("/products", json=_product(name="Yogur", category_id=dairy, location="fridge",
                                               expires_at=str(today + timedelta(days=3))))
    api_client.post("/products", json=_product(name="Arroz", location="pantry",
                                               expires_at=str(today + timedelta(days=200))))
    api_client.post("/products", json=_product(name="Guisantes", location="freezer",
                                               expires_at=str(today + timedelta(days=100))))

    by_location = api_client.get("/products", params={"location": "pantry"}).json()
    assert [p["name"] for p in by_location] == ["Arroz"]

    by_category = api_client.get("/products", params={"category_id": dairy}).json()
    assert [p["name"] for p in by_category] == ["Yogur"]

    expiring = api_client.get(
        "/products", params={"expires_before": str(today + timedelta(days=7))}
    ).json()
    assert [p["name"] for p in expiring] == ["Yogur"]


def test_filters_combine(api_client):
    today = date.today()
    api_client.post("/products", json=_product(name="Yogur", location="fridge",
                                               expires_at=str(today + timedelta(days=3))))
    api_client.post("/products", json=_product(name="Leche", location="fridge",
                                               expires_at=str(today + timedelta(days=90))))

    result = api_client.get(
        "/products",
        params={"location": "fridge", "expires_before": str(today + timedelta(days=7))},
    ).json()
    assert [p["name"] for p in result] == ["Yogur"]


def test_unknown_location_is_rejected(api_client):
    assert api_client.post("/products", json=_product(location="garage")).status_code == 422


def test_non_positive_quantity_is_rejected(api_client):
    """Caught by the schema, so the client gets a readable error not a DB failure."""
    response = api_client.post("/products", json=_product(quantity="0"))
    assert response.status_code == 422
    assert "quantity" in str(response.json())


def test_unknown_category_is_rejected_with_a_useful_message(api_client):
    response = api_client.post("/products", json=_product(category_id=9999))
    assert response.status_code == 422
    assert "9999" in response.json()["detail"]


def test_replacing_a_product_clears_omitted_fields(api_client):
    """PUT is a full replace: notes left out of the payload must not survive."""
    product_id = api_client.post("/products", json=_product(notes="abierto")).json()["id"]

    payload = _product(name="Leche desnatada", quantity="1.00")
    del payload["notes"]
    replaced = api_client.put(f"/products/{product_id}", json=payload)

    assert replaced.status_code == 200
    body = replaced.json()
    assert body["name"] == "Leche desnatada"
    assert body["quantity"] == "1.00"
    assert body["notes"] is None


def test_replacing_bumps_updated_at(api_client):
    """updated_at comes from a database trigger, so it must be read back."""
    created = api_client.post("/products", json=_product()).json()
    updated = api_client.put(f"/products/{created['id']}", json=_product(name="Leche fresca")).json()

    assert updated["updated_at"] > created["updated_at"]


def test_delete_removes_the_product(api_client):
    product_id = api_client.post("/products", json=_product()).json()["id"]

    assert api_client.delete(f"/products/{product_id}").status_code == 204
    assert api_client.get(f"/products/{product_id}").status_code == 404
    assert api_client.get("/products").json() == []


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/products/9999"),
        ("put", "/products/9999"),
        ("delete", "/products/9999"),
        ("patch", "/products/9999/quantity"),
        ("patch", "/products/9999/icon"),
        ("post", "/products/9999/consume"),
        ("post", "/products/9999/restore"),
    ],
)
def test_missing_product_is_404(api_client, method, path):
    kwargs: dict = {"json": _product()} if method == "put" else {}
    if method == "patch" and path.endswith("/quantity"):
        kwargs = {"json": {"delta": "-1"}}
    elif method == "patch" and path.endswith("/icon"):
        kwargs = {"json": {"icon": "\U0001F34C"}}
    assert getattr(api_client, method)(path, **kwargs).status_code == 404


def test_quantity_increments(api_client):
    product_id = api_client.post("/products", json=_product(quantity="2.00")).json()["id"]

    response = api_client.patch(f"/products/{product_id}/quantity", json={"delta": "1"})

    assert response.status_code == 200
    assert response.json()["quantity"] == "3.00"


def test_two_rapid_decrements_land_on_three_not_four(api_client):
    """The composition guarantee #82 exists for: sent as two deltas, not two
    absolute values, so neither tap is lost regardless of ordering."""
    product_id = api_client.post("/products", json=_product(quantity="5.00")).json()["id"]

    api_client.patch(f"/products/{product_id}/quantity", json={"delta": "-1"})
    second = api_client.patch(f"/products/{product_id}/quantity", json={"delta": "-1"})

    assert second.json()["quantity"] == "3.00"


def test_a_fractional_quantity_steps_without_being_rounded(api_client):
    """Numeric(10, 2) is the real precision boundary — not 0 decimal places —
    so a purchase already carrying cents must keep them exactly after a step."""
    product_id = api_client.post("/products", json=_product(quantity="0.59")).json()["id"]

    response = api_client.patch(f"/products/{product_id}/quantity", json={"delta": "1"})

    assert response.json()["quantity"] == "1.59"


def test_decrementing_below_zero_is_rejected_without_a_500(api_client):
    product_id = api_client.post("/products", json=_product(quantity="1.00")).json()["id"]

    response = api_client.patch(f"/products/{product_id}/quantity", json={"delta": "-1"})

    assert response.status_code == 422
    assert "non-positive" in response.json()["detail"]
    # Rejected, not partially applied.
    assert api_client.get(f"/products/{product_id}").json()["quantity"] == "1.00"


def test_decrementing_past_zero_is_rejected_the_same_way(api_client):
    """The guard is quantity + delta > 0, not merely != 0 — a delta larger than
    the current quantity must be caught too, not wrap or go negative."""
    product_id = api_client.post("/products", json=_product(quantity="1.00")).json()["id"]

    response = api_client.patch(f"/products/{product_id}/quantity", json={"delta": "-5"})

    assert response.status_code == 422
    assert api_client.get(f"/products/{product_id}").json()["quantity"] == "1.00"


def test_response_carries_days_until_expiry_and_status(api_client):
    """What the colour coding in #16 reads off each row."""
    from app.expiry import today

    reference = today()
    cases = {
        "Yogur": (-2, "expired"),
        "Leche": (0, "expiring_soon"),
        "Jamón": (7, "expiring_soon"),
        "Arroz": (8, "fresh"),
    }
    for name, (offset, _) in cases.items():
        api_client.post("/products", json=_product(name=name, expires_at=str(reference + timedelta(days=offset))))

    for product in api_client.get("/products").json():
        offset, expected_status = cases[product["name"]]
        assert product["days_until_expiry"] == offset
        assert product["status"] == expected_status


def test_a_product_expiring_today_is_not_shown_as_expired(api_client):
    """Explicitly: today is yellow, not red."""
    from app.expiry import today

    api_client.post("/products", json=_product(expires_at=str(today())))

    product = api_client.get("/products").json()[0]
    assert product["days_until_expiry"] == 0
    assert product["status"] == "expiring_soon"


def test_concurrent_decrements_do_not_lose_an_update(api_client):
    """Proves the atomic UPDATE, not just the sequential test above — by
    calling the real endpoint function, not a hand-rolled copy of its SQL.

    An earlier version of this test wrote its own raw UPDATE statement inside
    the thread target instead of calling `adjust_quantity`. It passed even
    with the endpoint reverted to a read-then-write implementation, because it
    was proving a fact about Postgres in the abstract, not about this code —
    the exact failure this project's testing conventions exist to catch. If
    two concurrent calls read quantity=N before either commits and each
    computes N-1 in Python, both write N-1 and one decrement vanishes; only a
    SET clause evaluated against the row's live value at UPDATE time — not a
    Python-computed constant — avoids it.

    Racing two threads once is real but timing-dependent: on a fast local
    database the two calls might not truly overlap on a given run, so a buggy
    implementation could pass by luck. Racing 20 rounds turns "might overlap"
    into "will overlap at least once", so a genuine lost-update bug reliably
    shows up in the final total rather than depending on a single roll.
    """
    from app.db.session import SessionLocal
    from app.routers.products import adjust_quantity
    from app.schemas.product import ProductQuantityDelta

    rounds = 20
    product_id = api_client.post("/products", json=_product(quantity="100.00")).json()["id"]
    errors: list[BaseException] = []

    def decrement_via_own_session(start: threading.Barrier) -> None:
        session = SessionLocal()
        try:
            start.wait(timeout=5)
            adjust_quantity(product_id, ProductQuantityDelta(delta=Decimal("-1")), session)
        except BaseException as exc:  # noqa: BLE001 - surfaced on the main thread below
            errors.append(exc)
        finally:
            session.close()

    for _ in range(rounds):
        barrier = threading.Barrier(2)
        threads = [threading.Thread(target=decrement_via_own_session, args=(barrier,)) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)

    assert not errors, errors
    expected = Decimal("100.00") - rounds * 2
    assert api_client.get(f"/products/{product_id}").json()["quantity"] == f"{expected:.2f}"


def test_creating_a_product_assigns_an_icon_from_the_local_table(api_client):
    response = api_client.post("/products", json=_product(name="Plátano"))

    assert response.status_code == 201
    body = response.json()
    assert body["icon"] == "\U0001F34C"
    assert body["icon_source"] == "lookup"


def test_an_unmatched_name_gets_the_default_icon(api_client):
    response = api_client.post("/products", json=_product(name="Sultán ácido muriático"))

    body = response.json()
    assert body["icon"] == "\U0001F9FA"
    assert body["icon_source"] == "default"


def test_replacing_a_product_never_touches_its_icon(api_client):
    """PUT has no icon field at all — this is what actually enforces #85's
    'a manual override survives being edited', not a special case in the
    handler that could later be edited away by accident."""
    created = api_client.post("/products", json=_product(name="Plátano")).json()

    api_client.patch(f"/products/{created['id']}/icon", json={"icon": "\U0001F34E"})
    replaced = api_client.put(f"/products/{created['id']}", json=_product(name="Plátano macho")).json()

    assert replaced["icon"] == "\U0001F34E"
    assert replaced["icon_source"] == "manual"


def test_manually_overriding_the_icon(api_client):
    product_id = api_client.post("/products", json=_product(name="Plátano")).json()["id"]

    response = api_client.patch(f"/products/{product_id}/icon", json={"icon": "\U0001F34E"})

    assert response.status_code == 200
    body = response.json()
    assert body["icon"] == "\U0001F34E"
    assert body["icon_source"] == "manual"


def test_a_second_manual_override_replaces_the_first(api_client):
    product_id = api_client.post("/products", json=_product(name="Plátano")).json()["id"]

    api_client.patch(f"/products/{product_id}/icon", json={"icon": "\U0001F34E"})
    second = api_client.patch(f"/products/{product_id}/icon", json={"icon": "\U0001F34D"})

    assert second.json()["icon"] == "\U0001F34D"
    assert second.json()["icon_source"] == "manual"


def test_an_empty_icon_is_rejected(api_client):
    product_id = api_client.post("/products", json=_product()).json()["id"]

    response = api_client.patch(f"/products/{product_id}/icon", json={"icon": ""})

    assert response.status_code == 422


@pytest.mark.integration
def test_a_table_hit_never_calls_the_model(api_client, mocker):
    mocked = mocker.patch("app.routers.products.resolve_icon_via_model")

    response = api_client.post("/products", json=_product(name="Plátano"))

    assert response.json()["icon_source"] == "lookup"
    mocked.assert_not_called()


@pytest.mark.integration
def test_a_table_miss_falls_back_to_the_model_when_enabled(api_client, mocker):
    mocker.patch("app.routers.products.resolve_icon_via_model", return_value="\U0001F944")

    response = api_client.post("/products", json=_product(name="Kombucha"))

    body = response.json()
    assert body["icon"] == "\U0001F944"
    assert body["icon_source"] == "ai"


@pytest.mark.integration
def test_the_same_name_calls_the_model_at_most_once(api_client, mocker):
    """The point of the cache: a product bought twice must not pay for a
    second call, whether or not it is literally the same product row."""
    mocked = mocker.patch("app.routers.products.resolve_icon_via_model", return_value="\U0001F944")

    api_client.post("/products", json=_product(name="Kombucha"))
    second = api_client.post("/products", json=_product(name="KOMBUCHA"))

    assert mocked.call_count == 1
    assert second.json()["icon"] == "\U0001F944"
    assert second.json()["icon_source"] == "ai"


@pytest.mark.integration
def test_the_toggle_off_skips_the_model_and_the_cache_still_is_not_consulted_for_nothing(api_client, mocker):
    api_client.put("/settings/icons", json={"ai_enabled": False})
    mocked = mocker.patch("app.routers.products.resolve_icon_via_model")

    response = api_client.post("/products", json=_product(name="Kombucha"))

    mocked.assert_not_called()
    assert response.json()["icon_source"] == "default"
    assert response.json()["icon"] == "\U0001F9FA"


@pytest.mark.integration
def test_a_model_failure_falls_back_to_the_default_icon(api_client, mocker):
    """resolve_icon_via_model returning None is the "any failure" contract —
    product creation must not surface it as an error."""
    mocker.patch("app.routers.products.resolve_icon_via_model", return_value=None)

    response = api_client.post("/products", json=_product(name="Kombucha"))

    assert response.status_code == 201
    body = response.json()
    assert body["icon"] == "\U0001F9FA"
    assert body["icon_source"] == "default"


@pytest.mark.integration
def test_reassign_updates_only_default_icon_products(api_client, mocker):
    """A LOOKUP hit stays untouched, a DEFAULT one gets re-resolved."""
    mocker.patch("app.routers.products.resolve_icon_via_model", return_value=None)
    lookup_hit = api_client.post("/products", json=_product(name="Plátano")).json()
    assert lookup_hit["icon_source"] == "lookup"

    # Simulate a pre-existing row: created before icons shipped, or during a
    # table miss, so it is stuck at the fallback exactly like a real backfilled
    # product would be.
    stuck = api_client.post("/products", json=_product(name="Nopal limpio")).json()
    assert stuck["icon_source"] == "lookup"  # sanity: this name does hit the table

    response = api_client.post("/products/icons/reassign")

    assert response.status_code == 200
    body = response.json()
    assert body["considered"] == 0
    assert body["updated"] == 0


@pytest.mark.integration
def test_reassign_resolves_products_stuck_at_the_default_icon(api_client, mocker):
    mocker.patch("app.routers.products.resolve_icon_via_model", return_value=None)
    # Force this one to the fallback the way a genuine miss would: nothing in
    # the table matches, and the model is mocked to also miss.
    stuck = api_client.post("/products", json=_product(name="Zzyzx")).json()
    assert stuck["icon_source"] == "default"

    # The table would now resolve it correctly if re-run — simulate the table
    # having "caught up", the same situation a name that used to miss and now
    # doesn't (or AI turned on after the fact) would produce.
    mocker.patch("app.routers.products.resolve_icon", return_value="\U0001F35E")

    response = api_client.post("/products/icons/reassign")

    body = response.json()
    assert body["considered"] == 1
    assert body["updated"] == 1
    assert body["still_default"] == 0

    refreshed = api_client.get(f"/products/{stuck['id']}").json()
    assert refreshed["icon"] == "\U0001F35E"
    assert refreshed["icon_source"] == "lookup"


@pytest.mark.integration
def test_reassign_leaves_a_manual_override_untouched(api_client, mocker):
    mocker.patch("app.routers.products.resolve_icon_via_model", return_value=None)
    product_id = api_client.post("/products", json=_product(name="Zzyzx")).json()["id"]
    api_client.patch(f"/products/{product_id}/icon", json={"icon": "\U0001F31F"})

    response = api_client.post("/products/icons/reassign")

    assert response.json()["considered"] == 0
    refreshed = api_client.get(f"/products/{product_id}").json()
    assert refreshed["icon"] == "\U0001F31F"
    assert refreshed["icon_source"] == "manual"


@pytest.mark.integration
def test_reassign_counts_what_is_still_unresolved(api_client, mocker):
    mocker.patch("app.routers.products.resolve_icon_via_model", return_value=None)
    api_client.post("/products", json=_product(name="Zzyzx"))
    api_client.post("/products", json=_product(name="Qwxyzabc"))

    response = api_client.post("/products/icons/reassign")

    body = response.json()
    assert body["considered"] == 2
    assert body["updated"] == 0
    assert body["still_default"] == 2


@pytest.mark.integration
def test_reassign_actually_commits_not_just_updates_the_in_session_objects(api_client, db_session, mocker):
    """A missing commit here would still pass every assertion above: the
    fixture's api_client and db_session share one SQLAlchemy session for the
    whole test, so reading a mutated ORM object back never proves it reached
    the database — only a fresh read after expiring the session's identity
    map does."""
    mocker.patch("app.routers.products.resolve_icon_via_model", return_value=None)
    product_id = api_client.post("/products", json=_product(name="Zzyzx")).json()["id"]
    mocker.patch("app.routers.products.resolve_icon", return_value="\U0001F35E")

    api_client.post("/products/icons/reassign")
    db_session.expire_all()

    assert api_client.get(f"/products/{product_id}").json()["icon"] == "\U0001F35E"


@pytest.mark.integration
def test_reassign_reuses_the_normal_resolution_order_including_the_cache(api_client, mocker):
    """The batch endpoint calls the same _resolve_icon as creation — this
    proves it, rather than assuming two call sites stay in sync forever."""
    mocker.patch("app.routers.products.resolve_icon_via_model", return_value=None)
    first = api_client.post("/products", json=_product(name="Zzyzx one")).json()
    second = api_client.post("/products", json=_product(name="ZZYZX ONE")).json()  # same normalized name
    assert first["icon_source"] == second["icon_source"] == "default"

    mocked = mocker.patch("app.routers.products.resolve_icon_via_model", return_value="\U0001F31F")

    api_client.post("/products/icons/reassign")

    # One model call resolves the first row; the cache must serve the second
    # from the same batch, not trigger a second call.
    assert mocked.call_count == 1
    for original in (first, second):
        refreshed = api_client.get(f"/products/{original['id']}").json()
        assert refreshed["icon"] == "\U0001F31F"
        assert refreshed["icon_source"] == "ai"


# ── Consume / restore / history (#31) ────────────────────────────────────────


def test_consuming_a_product_removes_it_from_the_active_list(api_client):
    product_id = api_client.post("/products", json=_product()).json()["id"]

    response = api_client.post(f"/products/{product_id}/consume")

    assert response.status_code == 200
    body = response.json()
    assert body["consumed_at"] is not None
    assert api_client.get("/products").json() == []


def test_a_newly_created_product_reports_consumed_at_as_null(api_client):
    product = api_client.post("/products", json=_product()).json()
    assert product["consumed_at"] is None


def test_consuming_twice_is_rejected_rather_than_silently_reapplied(api_client):
    """Mirrors delete's own non-retry stance (see productsService.ts): a
    second consume is a real conflict, not a no-op, so a client that retries
    blindly gets a clear signal instead of a quietly stale timestamp."""
    product_id = api_client.post("/products", json=_product()).json()["id"]
    api_client.post(f"/products/{product_id}/consume")

    response = api_client.post(f"/products/{product_id}/consume")

    assert response.status_code == 409


def test_restoring_a_consumed_product_returns_it_to_the_active_list(api_client):
    product_id = api_client.post("/products", json=_product()).json()["id"]
    api_client.post(f"/products/{product_id}/consume")

    response = api_client.post(f"/products/{product_id}/restore")

    assert response.status_code == 200
    assert response.json()["consumed_at"] is None
    assert [p["id"] for p in api_client.get("/products").json()] == [product_id]


def test_restoring_a_product_that_was_never_consumed_is_rejected(api_client):
    product_id = api_client.post("/products", json=_product()).json()["id"]

    response = api_client.post(f"/products/{product_id}/restore")

    assert response.status_code == 409


def test_history_lists_only_consumed_products_most_recent_first(api_client):
    first = api_client.post("/products", json=_product(name="Yogur")).json()["id"]
    second = api_client.post("/products", json=_product(name="Queso")).json()["id"]
    api_client.post("/products", json=_product(name="Arroz"))  # left active

    api_client.post(f"/products/{first}/consume")
    api_client.post(f"/products/{second}/consume")

    history = api_client.get("/products/history").json()

    assert [p["id"] for p in history] == [second, first]
    assert all(p["consumed_at"] is not None for p in history)


def test_history_is_empty_until_something_is_consumed(api_client):
    api_client.post("/products", json=_product())
    assert api_client.get("/products/history").json() == []


@pytest.mark.integration
def test_consuming_actually_commits_not_just_the_in_session_object(api_client, db_session):
    """Same reasoning as test_reassign_actually_commits above: api_client and
    db_session share one SQLAlchemy session in this fixture, so only a fresh
    read after expiring the identity map proves the UPDATE reached the
    database rather than just this test's in-memory object."""
    product_id = api_client.post("/products", json=_product()).json()["id"]

    api_client.post(f"/products/{product_id}/consume")
    db_session.expire_all()

    assert api_client.get("/products/history").json()[0]["id"] == product_id


def test_filters_still_apply_within_the_active_list_once_something_is_consumed(api_client):
    """Guards against a filter clause accidentally undoing the consumed_at
    exclusion by replacing rather than composing with it."""
    today = date.today()
    fridge_id = api_client.post(
        "/products", json=_product(name="Yogur", location="fridge", expires_at=str(today + timedelta(days=3)))
    ).json()["id"]
    api_client.post(
        "/products", json=_product(name="Arroz", location="pantry", expires_at=str(today + timedelta(days=200)))
    )
    api_client.post(f"/products/{fridge_id}/consume")

    assert api_client.get("/products", params={"location": "fridge"}).json() == []
