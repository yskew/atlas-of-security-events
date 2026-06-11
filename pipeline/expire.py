"""Lifecycle: soft-expire past-deadline events, then hard-purge long-archived ones.

Why soft-delete instead of hard-delete: if a past event were physically removed,
the next daily scrape would re-discover it (Google/ctftime still list it), not
recognize it as already-seen, and re-add it — churning forever. So we flag it
`expired` (the UI shows only `active`), keeping a tombstone for dedup, and only
hard-delete rows that have been expired for a long time.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import SETTINGS, is_blocked_or_academic
from .db import Event

log = logging.getLogger(__name__)


def expire_past(session: Session, today: date | None = None) -> int:
    """Mark active events whose actionable deadline has passed as expired."""
    today = today or date.today()
    rows = session.scalars(
        select(Event).where(Event.status == "active", Event.deadline.is_not(None))
    ).all()
    n = 0
    for row in rows:
        if row.deadline and row.deadline < today:
            row.status = "expired"
            row.expired_at = datetime.now(timezone.utc)
            n += 1
    if n:
        log.info("expired %d past-deadline events", n)
    return n


def purge_disreputable(session: Session) -> int:
    """Delete events that fail the reputability gate: predatory/academic source
    domains, or audience classified academic/student (CTFs are exempt). Runs
    every pipeline pass so previously-stored low-quality events are removed and
    new filtering rules apply retroactively."""
    rows = session.scalars(select(Event)).all()
    n = 0
    for row in rows:
        bad_source = is_blocked_or_academic(row.primary_url)
        bad_audience = (
            row.event_type != "ctf"
            and (row.audience or "").strip().lower() in {"academic", "student"}
        )
        if bad_source or bad_audience:
            session.delete(row)
            n += 1
    if n:
        log.info("purged %d disreputable events (academic/student/aggregator)", n)
    return n


def hard_purge(session: Session) -> int:
    """Delete rows that have been expired longer than HARD_PURGE_AFTER_DAYS."""
    days = SETTINGS.hard_purge_after_days
    if days <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = session.execute(
        delete(Event).where(
            Event.status == "expired", Event.expired_at.is_not(None), Event.expired_at < cutoff
        )
    )
    n = result.rowcount or 0
    if n:
        log.info("hard-purged %d events expired before %s", n, cutoff.date())
    return n
