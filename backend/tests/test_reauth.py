"""Reauth landing page tests."""


def test_serves_a_page_that_sends_the_browser_back_to_the_app(client):
    response = client.get("/reauth")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'http-equiv="refresh" content="2;url=/"' in response.text
    assert 'href="/"' in response.text


def test_is_excluded_from_the_openapi_schema(client):
    """Not a resource endpoint — see the module docstring — so it has no
    business appearing next to /products and /categories in the API docs."""
    schema = client.get("/openapi.json").json()

    assert "/reauth" not in schema["paths"]
