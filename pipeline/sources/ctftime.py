"""ctftime.org source — free public JSON API, no key required.

This is the guaranteed data source: the pipeline produces real events from it
even with zero API keys configured. We pull upcoming events and keep the ones
whose on-site location maps to a target city/country (online CTFs are dropped,
since this app is about geography-specific opportunities).

API: GET https://ctftime.org/api/v1/events/?limit=&start=&finish=  (unix secs)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

from ..config import SETTINGS, USER_AGENT
from ..models import ExtractedEvent

log = logging.getLogger(__name__)

API = "https://ctftime.org/api/v1/events/"


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _to_event(raw: dict) -> ExtractedEvent | None:
    start = _parse_dt(raw.get("start"))
    finish = _parse_dt(raw.get("finish"))
    onsite = bool(raw.get("onsite"))
    location = (raw.get("location") or "").strip()

    fmt = (raw.get("format") or "").lower()  # "Jeopardy" / "Attack-Defense"
    subtype_bits = [b for b in (fmt, "onsite" if onsite else "online") if b]

    return ExtractedEvent(
        name=raw.get("title", "").strip() or "Untitled CTF",
        event_type="ctf",
        subtype="/".join(subtype_bits) or None,
        country=None,  # ctftime gives a free-text location only; geo-match handles it
        city=location or None,
        venue=location or None,
        is_online=not onsite,
        dedicated_security=True,
        event_start=start.date() if start else None,
        event_end=finish.date() if finish else None,
        description=(raw.get("description") or "").strip()[:600]
        or f"A {fmt or 'CTF'} capture-the-flag competition.",
        topics=["ctf", fmt] if fmt else ["ctf"],
        primary_url=raw.get("url") or raw.get("ctftime_url") or "https://ctftime.org",
        registration_url=raw.get("ctftime_url"),
        confidence=0.9,
        source="ctftime",
    )


def discover() -> list[ExtractedEvent]:
    now = datetime.now(timezone.utc)
    params = {
        "limit": 200,
        "start": int(now.timestamp()),
        "finish": int((now + timedelta(days=SETTINGS.lookahead_days)).timestamp()),
    }
    try:
        resp = httpx.get(
            API, params=params, headers={"User-Agent": USER_AGENT}, timeout=30.0
        )
        resp.raise_for_status()
        rows = resp.json()
    except Exception as exc:  # network / API hiccup shouldn't kill the run
        log.warning("ctftime fetch failed: %s", exc)
        return []

    events: list[ExtractedEvent] = []
    for raw in rows:
        try:
            ev = _to_event(raw)
        except Exception as exc:
            log.debug("skipping malformed ctftime row: %s", exc)
            continue
        if ev is None:
            continue
        # Keep only on-site events in our target geography.
        if ev.is_online:
            continue
        if not ev.matches_target_geo():
            continue
        events.append(ev)

    log.info("ctftime: %d on-site events in target geography", len(events))
    return events
