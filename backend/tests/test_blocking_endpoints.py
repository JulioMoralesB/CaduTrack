"""Slow work must not freeze the rest of the API — see #162.

The API is one uvicorn process, so anything blocking on its event loop
holds up every other request. These run the real app on one event loop,
the way uvicorn does: the fake slow call only returns early if the loop
is still free to tell it to, which it isn't when the call is blocking it.
"""

import asyncio
import threading

import httpx
import pytest

from app.main import app
from app.receipt_client import ReceiptExtraction, ReceiptItem

_IMAGE = {"image": ("photo.jpg", b"photo", "image/jpeg")}


@pytest.mark.parametrize(
    "path,target",
    [
        ("/vision/label", "app.routers.vision.extract_label"),
        ("/trips/receipt", "app.routers.trips.extract_receipt"),
        ("/barcodes/scan-photo", "app.routers.barcodes.decode_barcode_photo"),
    ],
)
def test_a_slow_read_leaves_the_event_loop_free(mocker, path, target):
    started = threading.Event()
    release = threading.Event()
    released_in_time: list[bool] = []

    def slow_call(*_args):
        started.set()
        released_in_time.append(release.wait(timeout=2))
        # What each of these returns when it can't read anything.
        return None

    mocker.patch(target, side_effect=slow_call)

    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            request = asyncio.create_task(client.post(path, files=_IMAGE))
            await asyncio.to_thread(started.wait, 5)
            release.set()
            await request

    asyncio.run(scenario())

    assert released_in_time == [True]


@pytest.mark.integration
def test_no_database_connection_is_held_while_expanding_names(api_client, db_session, mocker):
    """expand_names can take 30 seconds, after the cache lookups have already
    opened a transaction."""
    mocker.patch(
        "app.routers.trips.extract_receipt",
        return_value=ReceiptExtraction(
            items=[ReceiptItem(raw_name="Nopal limpio", quantity=1, is_food=True)],
            stated_item_count=None,
        ),
    )
    in_transaction: list[bool] = []

    def expand(_names):
        in_transaction.append(db_session.in_transaction())
        return {}

    mocker.patch("app.routers.trips.expand_names", side_effect=expand)

    response = api_client.post("/trips/receipt", files=_IMAGE)

    assert response.status_code == 201
    assert in_transaction == [False]
