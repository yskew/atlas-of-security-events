"""Gemini-powered structured extraction. Optional: returns None when
GEMINI_API_KEY is unset, so the pipeline still runs on ctftime alone.

extract_from_page(url, content) turns one fetched page into a list of
ExtractedEvents (0, 1, or many — listing pages can yield several), grounded
strictly in the page text (unknown fields stay null, never invented).

Note: discovery does NOT use Gemini's Google-Search grounding — that 429s on the
free tier. Candidate URLs come from sources/websearch.py (DuckDuckGo, keyless).
"""
from __future__ import annotations

import json
import logging
import time

from .config import EVENT_TYPES, SETTINGS
from .models import ExtractedEvent

log = logging.getLogger(__name__)

# Transient API conditions worth retrying (server overload / rate limits).
_TRANSIENT_CODES = (429, 500, 502, 503, 504)
_TRANSIENT_MARKERS = ("UNAVAILABLE", "RESOURCE_EXHAUSTED", "high demand", "overloaded")


class TransientExtractionError(Exception):
    """Raised when extraction fails for a retryable reason (overload/quota).
    The caller should NOT blacklist the URL — it's worth trying again later."""


_clients: dict[str, object] = {}        # api_key -> genai.Client
_exhausted: set[tuple[str, str]] = set()  # (model, api_key) hit 429 this process


def _client_for(api_key: str):
    """Lazily build (and cache) a Gemini client for a given key."""
    if api_key not in _clients:
        from google import genai

        _clients[api_key] = genai.Client(api_key=api_key)
    return _clients[api_key]


def _is_quota(exc: Exception) -> bool:
    return getattr(exc, "code", None) == 429 or "RESOURCE_EXHAUSTED" in str(exc)


def reset_quota_state() -> None:
    """Clear the per-process exhausted-combo memory (used by tests)."""
    _exhausted.clear()


def _strip_json(text: str) -> str:
    """Pull a JSON array/object out of a model response (handles ```json fences)."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        if t.startswith("json"):
            t = t[4:]
    start = min(
        (i for i in (t.find("["), t.find("{")) if i != -1),
        default=-1,
    )
    end = max(t.rfind("]"), t.rfind("}"))
    return t[start : end + 1] if start != -1 and end != -1 else t


_EXTRACT_PROMPT = """Extract structured event data from the web page below.
Ground every field in the page text. Never invent dates or URLs; use null for
anything not stated. Write `description` in plain English (what it is, who it's
for, whether/how to apply).

Set `audience` accurately — this is important:
  - "professional": industry/practitioner security event (conferences like
    Black Hat, BSides, c0c0n; CTFs; vendor/community events).
  - "academic": a university research / paper-presentation conference, often
    named "International Conference on ...", organised by a college/institute
    for scholars and researchers.
  - "student": student- or youth-focused programs.
  - "mixed": clearly both.

Set `notable` carefully — only well-known, relevant events should pass:
  - true: run by a recognised organisation or part of an established series /
    community — e.g. Black Hat, DEF CON (& DC groups), RSA, OWASP (chapters/
    events), BSides, Microsoft BlueHat, c0c0n, nullcon, Def Camp, Troopers, or a
    recognised CTF. Must be clearly a CYBERSECURITY event.
  - false: an obscure one-off, a brand-new unproven event, a tiny local/private
    gathering, a vendor webinar/marketing page, a generic listing/aggregator, or
    anything only loosely related to cybersecurity.

Return ONLY JSON. For a SINGLE event, return one object with the keys below. If
the page lists SEVERAL distinct events (an index / listing page), return a JSON
ARRAY of such objects — one per event. If the page has no real event, return [].
Keys: name, event_type (one of {types}), subtype, city, country, venue, is_online,
dedicated_security, audience, notable, event_start, event_end, cfp_opens,
cfp_closes, cfp_notify, description, topics, primary_url, registration_url.
Dates as YYYY-MM-DD. Set primary_url to each event's own page when one is shown.

SOURCE URL: {url}

PAGE CONTENT:
{content}
"""


def _is_transient(exc: Exception) -> bool:
    code = getattr(exc, "code", None)
    if code in _TRANSIENT_CODES:
        return True
    return any(m in str(exc) for m in _TRANSIENT_MARKERS)


def _call_gemini(model: str, key: str, prompt: str) -> str:
    from google.genai import types

    client = _client_for(key)
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", temperature=0.0
        ),
    )
    return resp.text or ""


def _call_openrouter(model: str, prompt: str) -> str:
    import httpx

    r = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {SETTINGS.openrouter_api_key}",
            "X-Title": "SecurityEvents",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "temperature": 0,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=90.0,
    )
    if r.status_code != 200:
        err = Exception(f"openrouter {r.status_code}: {r.text[:140]}")
        err.code = r.status_code  # type: ignore[attr-defined]
        raise err
    return r.json()["choices"][0]["message"].get("content") or ""


def _generate(prompt: str) -> str:
    """Return JSON text from the first available provider/model. Order: every
    Gemini (model x key) combo, then each OpenRouter free model. A combo that
    hits 429/quota or a 4xx (auth/credit/missing) is marked exhausted for the
    process and skipped; 5xx/overload retries once. If nothing succeeds ->
    TransientExtractionError (URL stays queued for a later run, never dropped).
    """
    combos: list[tuple[str, str, str]] = [
        ("gemini", m, k)
        for m in SETTINGS.gemini_models
        for k in SETTINGS.gemini_api_keys
    ]
    if SETTINGS.openrouter_enabled:
        combos += [("openrouter", m, "") for m in SETTINGS.openrouter_models]

    last: Exception | None = None
    tried_any = False
    for provider, model, key in combos:
        ck = (provider, model, key)
        if ck in _exhausted:
            continue
        tried_any = True
        for attempt in range(2):
            try:
                if provider == "gemini":
                    return _call_gemini(model, key, prompt)
                return _call_openrouter(model, prompt)
            except Exception as exc:
                last = exc
                code = getattr(exc, "code", None)
                # 429/quota or any 4xx (bad key, no credit, model gone) -> dead.
                if _is_quota(exc) or (isinstance(code, int) and 400 <= code < 500):
                    _exhausted.add(ck)
                    break
                if _is_transient(exc) and attempt == 0:
                    time.sleep(3)
                    continue
                break
    if not tried_any:
        raise TransientExtractionError("all providers quota-exhausted")
    raise TransientExtractionError(str(last))


def extract_from_page(url: str, content: str) -> list[ExtractedEvent]:
    """Return every event found on the page (0, 1, or many).

    The model may return a single JSON object (one event), a JSON array (an
    index / listing page with several events), or [] / null (no event) — all are
    handled. Raises TransientExtractionError on retryable API failures; a parse
    failure or a single bad record is definitive (logged, then skipped)."""
    if not SETTINGS.llm_enabled:
        return []
    prompt = _EXTRACT_PROMPT.format(
        types=list(EVENT_TYPES), url=url, content=content[:20000]
    )
    text = _generate(prompt)  # may raise TransientExtractionError

    try:
        raw = json.loads(_strip_json(text or "[]"))
    except Exception as exc:  # not valid JSON at all — definitive, not transient
        log.warning("extraction of %s unparseable: %s", url, str(exc)[:160])
        return []

    # Normalise to a list of dict records (single object -> one-item list).
    if isinstance(raw, dict):
        records = [raw]
    elif isinstance(raw, list):
        records = [r for r in raw if isinstance(r, dict)]
    else:
        return []

    events: list[ExtractedEvent] = []
    for rec in records:
        # A null/blank event_type means "no real event here" — skip quietly.
        if not rec.get("event_type"):
            continue
        rec.setdefault("primary_url", url)
        rec.setdefault("source", "llm")
        try:
            events.append(ExtractedEvent(**rec))
        except Exception as exc:  # one bad record must not drop the others
            log.debug("skipping a record from %s: %s", url, str(exc)[:120])
    return events
