import json
import logging
import re

import httpx
import pytest

import app.extract as extract_module
from app.extract import (
    PROVIDER_NAMES,
    Extraction,
    _prompt,
    _provider_time_budgets,
    active_llm_order,
    extract_message,
    provider_stats,
)
from app.models import CatalogItem


@pytest.fixture(autouse=True)
def _reset_provider_stats(monkeypatch):
    """Provider success/fail counters are process-global; give each test a clean slate."""
    monkeypatch.setattr(extract_module, "_PROVIDER_STATS", {name: {"success": 0, "fail": 0} for name in PROVIDER_NAMES})


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


def _configure_all_providers(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("OLLAMA_HOST", "localhost:11434")
    monkeypatch.setenv("BACKBOARD_API_KEY", "backboard-key")


def test_default_llm_order_is_gemini_then_ollama_then_backboard(monkeypatch):
    monkeypatch.delenv("RELAY_LLM_ORDER", raising=False)
    _configure_all_providers(monkeypatch)
    assert active_llm_order() == ["gemini", "ollama", "backboard"]


def test_llm_order_skips_providers_that_are_not_configured(monkeypatch):
    monkeypatch.delenv("RELAY_LLM_ORDER", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("OLLAMA_HOST", "")
    monkeypatch.setenv("BACKBOARD_API_KEY", "backboard-key")
    assert active_llm_order() == ["backboard"]


def test_custom_llm_order_from_env_is_respected(monkeypatch):
    _configure_all_providers(monkeypatch)
    monkeypatch.setenv("RELAY_LLM_ORDER", "backboard,ollama")
    # Gemini is configured but not named, so it is left out entirely.
    assert active_llm_order() == ["backboard", "ollama"]


def test_unknown_provider_name_is_ignored_with_a_warning(monkeypatch, caplog):
    _configure_all_providers(monkeypatch)
    monkeypatch.setenv("RELAY_LLM_ORDER", "gemini,carrier-pigeon,ollama")
    with caplog.at_level(logging.WARNING, logger="app.extract"):
        order = active_llm_order()
    assert order == ["gemini", "ollama"]
    assert any("carrier-pigeon" in record.message for record in caplog.records)


def test_duplicate_provider_names_only_count_once(monkeypatch):
    _configure_all_providers(monkeypatch)
    monkeypatch.setenv("RELAY_LLM_ORDER", "gemini,gemini,ollama")
    assert active_llm_order() == ["gemini", "ollama"]


def test_all_providers_failing_falls_back_to_the_built_in_parser(monkeypatch):
    _configure_all_providers(monkeypatch)
    monkeypatch.delenv("RELAY_LLM_ORDER", raising=False)
    monkeypatch.setattr("app.extract._from_gemini", lambda *_a, **_k: None)
    monkeypatch.setattr("app.extract._from_ollama", lambda *_a, **_k: None)
    monkeypatch.setattr("app.extract._from_backboard", lambda *_a, **_k: None)
    result = extract_message("I need a drill", _catalog())
    assert result.intent == "need"
    assert result.item_ids == ["drill"]
    assert provider_stats() == {
        "gemini": {"success": 0, "fail": 1},
        "ollama": {"success": 0, "fail": 1},
        "backboard": {"success": 0, "fail": 1},
    }


def test_provider_stats_count_a_success(monkeypatch):
    monkeypatch.delenv("RELAY_LLM_ORDER", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("BACKBOARD_API_KEY", "")
    monkeypatch.setenv("OLLAMA_HOST", "localhost:11434")
    monkeypatch.setattr("app.extract._from_ollama", lambda *_a, **_k: Extraction("need", ["drill"], 1, None, None, None))
    result = extract_message("I need a drill", _catalog())
    assert result.item_ids == ["drill"]
    assert provider_stats()["ollama"] == {"success": 1, "fail": 0}


def test_provider_time_budget_caps_the_first_provider_at_sixty_percent():
    assert _provider_time_budgets(8.0, 0) == []
    assert _provider_time_budgets(8.0, 1) == [8.0]
    budgets = _provider_time_budgets(8.0, 3)
    assert budgets[0] == pytest.approx(4.8)
    assert budgets[1] == pytest.approx(1.6)
    assert budgets[2] == pytest.approx(1.6)
    assert sum(budgets) == pytest.approx(8.0)
    # The first provider never gets more than 60% of the total, no matter how many
    # providers are behind it.
    two = _provider_time_budgets(10.0, 2)
    assert two[0] == pytest.approx(6.0)
    assert two[1] == pytest.approx(4.0)


def test_prompt_never_includes_private_resident_fields():
    """The LLM prompt is built from the user's message and catalog names only."""
    catalog = _catalog()
    text = "I need two drills this weekend"
    prompt = _prompt(text, catalog)

    private_values = ["avery@example.com", "555-867-5309", "14 Willow Court"]
    for value in private_values:
        assert value not in prompt

    assert re.search(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", prompt, re.IGNORECASE) is None
    assert re.search(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b", prompt) is None
    for word in ("email", "phone", "address", "street"):
        assert word not in prompt.lower()
