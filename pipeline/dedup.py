"""In-run deduplication of extracted events before they hit the DB.

Cross-run dedup is handled by the unique fingerprint in db.upsert_event. This
module collapses duplicates *within* a single run's candidate list (the same
event often arrives from ctftime + a search hit). The cheap fingerprint catches
exact matches; when two candidates share a fingerprint we keep the
higher-confidence, more-complete one and merge missing fields from the other.

(pgvector embedding similarity + LLM adjudication for fuzzy near-duplicates is
the planned next rung; the fingerprint pass covers the common case.)
"""
from __future__ import annotations

import logging

from .models import ExtractedEvent

log = logging.getLogger(__name__)

_DATE_FIELDS = (
    "event_start",
    "event_end",
    "cfp_opens",
    "cfp_closes",
    "cfp_notify",
)


def _completeness(ev: ExtractedEvent) -> int:
    score = sum(getattr(ev, f) is not None for f in _DATE_FIELDS)
    score += 1 if ev.registration_url else 0
    score += 1 if ev.subtype else 0
    return score


def _merge(keep: ExtractedEvent, other: ExtractedEvent) -> ExtractedEvent:
    """Fill keep's empty fields from other; keep is the preferred record."""
    for f in _DATE_FIELDS:
        if getattr(keep, f) is None and getattr(other, f) is not None:
            setattr(keep, f, getattr(other, f))
    keep.registration_url = keep.registration_url or other.registration_url
    keep.subtype = keep.subtype or other.subtype
    if len(other.description) > len(keep.description):
        keep.description = other.description
    keep.topics = sorted(set(keep.topics) | set(other.topics))
    return keep


def dedupe(events: list[ExtractedEvent]) -> list[ExtractedEvent]:
    best: dict[str, ExtractedEvent] = {}
    for ev in events:
        fp = ev.fingerprint()
        cur = best.get(fp)
        if cur is None:
            best[fp] = ev
            continue
        # Prefer higher confidence, then more complete.
        winner, loser = (
            (ev, cur)
            if (ev.confidence, _completeness(ev)) > (cur.confidence, _completeness(cur))
            else (cur, ev)
        )
        best[fp] = _merge(winner, loser)

    deduped = list(best.values())
    if len(deduped) != len(events):
        log.info("dedup: %d candidates -> %d unique", len(events), len(deduped))
    return deduped
