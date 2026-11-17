import json

import httpx
import pytest

from app.extract import extract_message
from app.models import CatalogItem


def _catalog():
    return [
        CatalogItem(id="drill", name="Drill", aliases="drill,cordless drill", category="tool", demo_price_cents=6000, default_loan_hours=4),
        CatalogItem(id="saw", name="Saw", aliases="saw", category="tool", demo_price_cents=3000, default_loan_hours=4),
    ]


GOOD = {"intent": "need", "items": [{"name": "drill", "quantity": 2}], "window_start": None, "window_end": None, "area": None}


@pytest.fixture
def ollama_on(monkeypatch):
    monkeypatch.setenv("OLLAMA_HOST", "localhost:11434/")
    monkeypatch.setenv("OLLAMA_MODEL", "tiny-model")
    # Make the other providers unavailable so only Ollama or the fallback can answer.
    monkeypatch.setattr("app.extract._from_gemini", lambda *_a, **_k: pytest.fail("Gemini should not be asked"))
    monkeypatch.setattr("app.extract._from_backboard", lambda *_a, **_k: pytest.fail("Backboard should not be asked"))


def _serve(monkeypatch, handler):
    real = httpx.post
    calls = []

    def post(url, **kwargs):
        calls.append((url, kwargs))
        transport = httpx.MockTransport(lambda request: handler(request))
        with httpx.Client(transport=transport) as client:
            return client.post(url, json=kwargs.get("json"), timeout=kwargs.get("timeout"))

    monkeypatch.setattr(httpx, "post", post)
    return calls, real


def test_ollama_answer_is_used_and_request_is_well_formed(ollama_on, monkeypatch):
    calls, _ = _serve(monkeypatch, lambda req: httpx.Response(200, json={"message": {"role": "assistant", "content": json.dumps(GOOD)}}))
    result = extract_message("I need two drills", _catalog())
    assert (result.intent, result.item_ids, result.quantity) == ("need", ["drill"], 2)
    url, kwargs = calls[0]
    assert url == "http://localhost:11434/api/chat"  # scheme added, trailing slash removed
    body = kwargs["json"]
    assert body["model"] == "tiny-model"
    assert body["stream"] is False
    assert body["format"]["required"] == ["intent", "items", "window_start", "window_end", "area"]
    assert body["options"] == {"temperature": 0}


@pytest.mark.parametrize(
    "handler",
    [
        lambda req: httpx.Response(500, text="boom"),
        lambda req: httpx.Response(200, json={"message": {"content": "not json at all"}}),
        lambda req: httpx.Response(200, json={"message": {"content": json.dumps({"intent": "need"})}}),
        lambda req: httpx.Response(200, json={"unexpected": True}),
        lambda req: (_ for _ in ()).throw(httpx.ConnectError("refused")),
    ],
    ids=["server-error", "not-json", "schema-mismatch", "wrong-shape", "unreachable"],
)
def test_bad_ollama_replies_fall_back_to_the_built_in_parser(ollama_on, monkeypatch, handler):
    # Gemini/Backboard are not asked in this fixture, so reaching the parser proves the fallback ran.
    monkeypatch.setattr("app.extract._from_gemini", lambda *_a, **_k: None)
    monkeypatch.setattr("app.extract._from_backboard", lambda *_a, **_k: None)
    _serve(monkeypatch, handler)
    result = extract_message("I need a drill", _catalog())
    assert result.intent == "need"
    assert result.item_ids == ["drill"]


def test_nothing_is_called_when_ollama_is_not_configured(monkeypatch):
    monkeypatch.setenv("OLLAMA_HOST", "")
    monkeypatch.setattr("app.extract._from_gemini", lambda *_a, **_k: None)
    monkeypatch.setattr("app.extract._from_backboard", lambda *_a, **_k: None)
    monkeypatch.setattr(httpx, "post", lambda *_a, **_k: pytest.fail("no HTTP call expected"))
    assert extract_message("I need a drill", _catalog()).item_ids == ["drill"]


def test_yes_and_no_never_reach_the_model(ollama_on, monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *_a, **_k: pytest.fail("no HTTP call expected"))
    assert extract_message("yes", _catalog()).intent == "confirm_yes"
    assert extract_message("No", _catalog()).intent == "confirm_no"


def test_admin_overview_reports_ollama_without_leaking_the_host(client, monkeypatch):
    monkeypatch.setenv("OLLAMA_HOST", "http://10.0.0.5:11434")
    monkeypatch.setenv("OLLAMA_MODEL", "mistral")
    data = client.get("/api/admin/overview").json()
    assert data["integrations"]["ollama"] == {"configured": True, "model": "mistral"}
    assert "10.0.0.5" not in json.dumps(data)
    monkeypatch.setenv("OLLAMA_HOST", "")
    assert client.get("/api/admin/overview").json()["integrations"]["ollama"] == {"configured": False, "model": None}
