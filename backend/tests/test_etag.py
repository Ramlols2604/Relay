"""ETag / 304 caching for catalog and residents list endpoints."""


def test_catalog_etag_and_304(client):
    first = client.get("/api/catalog")
    assert first.status_code == 200
    etag = first.headers.get("etag")
    assert etag
    assert first.headers.get("cache-control") == "max-age=60, must-revalidate"

    cached = client.get("/api/catalog", headers={"If-None-Match": etag})
    assert cached.status_code == 304
    assert cached.headers.get("etag") == etag
    assert cached.headers.get("cache-control") == "max-age=60, must-revalidate"
    assert cached.content == b""


def test_residents_etag_and_304(client):
    first = client.get("/api/residents")
    assert first.status_code == 200
    etag = first.headers.get("etag")
    assert etag
    assert first.headers.get("cache-control") == "max-age=60, must-revalidate"

    cached = client.get("/api/residents", headers={"If-None-Match": etag})
    assert cached.status_code == 304
    assert cached.headers.get("etag") == etag


def test_catalog_edit_changes_etag(client):
    before = client.get("/api/catalog")
    assert before.status_code == 200
    etag_before = before.headers.get("etag")
    assert etag_before

    patched = client.patch("/api/admin/catalog/drill", json={"demo_price_cents": 7500})
    assert patched.status_code == 200

    after = client.get("/api/catalog")
    assert after.status_code == 200
    etag_after = after.headers.get("etag")
    assert etag_after
    assert etag_after != etag_before

    stale = client.get("/api/catalog", headers={"If-None-Match": etag_before})
    assert stale.status_code == 200
    assert stale.headers.get("etag") == etag_after

    fresh = client.get("/api/catalog", headers={"If-None-Match": etag_after})
    assert fresh.status_code == 304
