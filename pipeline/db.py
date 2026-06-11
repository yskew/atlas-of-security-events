"""Database layer. Same code runs on SQLite (local) and Postgres/Neon (prod).

Model: one canonical `Event` row with many `Sighting` rows (the source URLs it
was seen at). Expiry is a soft-delete (status='expired') so the daily scrape
doesn't re-add dead events; a slower hard-purge removes long-archived rows.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    JSON,
    String,
    Text,
    create_engine,
    func,
    nulls_first,
    select,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
)

from .config import CITY_LATLNG, SETTINGS
from .models import ExtractedEvent, _norm

# Two events count as the same when their normalised names score at/above this
# (token-set ratio, 0-100) AND their geography + dates are compatible.
FUZZY_NAME_THRESHOLD = 88

# Filler words stripped before fuzzy name comparison so "c0c0n 2026 CFP" and
# "c0c0n 2026" (or "BSides London" vs "BSides London 2026 Call for Papers") match.
_NAME_FILLER = {
    "the", "cfp", "call", "for", "papers", "paper", "speakers", "briefings",
    "conference", "conf", "summit", "event", "edition", "annual", "ctf",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _name_key(name: str) -> str:
    """Normalise a name for fuzzy comparison: drop punctuation, 4-digit years,
    and filler words."""
    import re

    words = [
        w for w in _norm(name).split()
        if w not in _NAME_FILLER and not re.fullmatch(r"\d{4}", w)
    ]
    return " ".join(words) or _norm(name)


def _edition_nums(name: str) -> set[str]:
    """Non-year numeric tokens (edition/track numbers). 'DEF CON 31' -> {'31'};
    differing edition numbers mean different events, even with similar names."""
    return {
        w for w in _norm(name).split()
        if w.isdigit() and len(w) != 4
    }


class Base(DeclarativeBase):
    pass


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    name: Mapped[str] = mapped_column(String(500))
    event_type: Mapped[str] = mapped_column(String(32), index=True)
    subtype: Mapped[str | None] = mapped_column(String(64), nullable=True)

    country: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    venue: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    dedicated_security: Mapped[bool] = mapped_column(Boolean, default=True)
    audience: Mapped[str | None] = mapped_column(String(32), nullable=True)

    event_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    event_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    cfp_opens: Mapped[date | None] = mapped_column(Date, nullable=True)
    cfp_closes: Mapped[date | None] = mapped_column(Date, nullable=True)
    cfp_notify: Mapped[date | None] = mapped_column(Date, nullable=True)
    # The single date used for expiry (computed from the above on upsert).
    deadline: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)

    description: Mapped[str] = mapped_column(Text, default="")
    topics: Mapped[list] = mapped_column(JSON, default=list)
    primary_url: Mapped[str] = mapped_column(String(1000))
    registration_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    confidence: Mapped[float] = mapped_column(Float, default=0.7)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)

    first_seen: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    last_verified: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    expired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    sightings: Mapped[list["Sighting"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class Sighting(Base):
    __tablename__ = "sightings"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), index=True)
    url: Mapped[str] = mapped_column(String(1000))
    domain: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source: Mapped[str] = mapped_column(String(50), default="unknown")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    event: Mapped[Event] = relationship(back_populates="sightings")


class UrlQueue(Base):
    """Persistent discovery backlog. Every candidate URL ever seen lives here
    with a status, so a budget-capped run resumes exactly where it left off and
    never-processed URLs are always picked up first (no starvation).

      status: 'pending' (awaiting processing or transient-retry)
              'done'    (extracted an event, or read but definitively no event)
              'error'   (page dead after the full fetch ladder)
    """

    __tablename__ = "url_queue"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(1000), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(default=0)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PipelineState(Base):
    """Tiny key/value store for cross-run state that must survive ephemeral
    runners (GitHub Actions) and be shared between local and CI runs.

    Lives in the SAME database as everything else, so whoever runs next — local
    machine or a scheduled Action — reads the same value. Currently holds the
    city-sweep cursor (see CURSOR_KEY)."""

    __tablename__ = "pipeline_state"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(String(500), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow
    )


# Key under which the city-sweep bookmark is stored: the NAME of the next city to
# process. Stored as a name (not an index) so reordering the city list can never
# silently point the cursor at a different city.
CURSOR_KEY = "city_cursor"


_engine = None


def _normalize_url(url: str) -> str:
    """Use the installed psycopg (v3) driver for plain postgres URLs (Neon gives
    `postgresql://...`; SQLAlchemy would otherwise reach for psycopg2)."""
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    return url


def get_engine():
    global _engine
    if _engine is None:
        # pool_pre_ping revives connections Neon dropped during the long, DB-idle
        # extraction phase (its serverless compute auto-suspends); pool_recycle
        # discards connections older than 5 min so we never hand out a stale one.
        _engine = create_engine(
            _normalize_url(SETTINGS.database_url),
            future=True,
            pool_pre_ping=True,
            pool_recycle=300,
        )
    return _engine


# Matches the url_queue.url / sightings.url / events.primary_url column size.
# A URL longer than this can't be stored, so we never enqueue it (a single
# oversized ad-redirect URL would otherwise abort the whole batch insert).
URL_MAX_LEN = 1000


def enqueue_urls(session: Session, urls: list[str]) -> int:
    """Add any URLs not already in the queue as 'pending'. Never resets existing
    rows (so yesterday's progress/leftovers are preserved). Returns count added.
    Over-length URLs (tracking/ad redirects) are skipped — they can't fit the
    column and are never real event pages."""
    if not urls:
        return 0
    uniq = [u for u in dict.fromkeys(urls) if len(u) <= URL_MAX_LEN]
    known = set(
        session.scalars(select(UrlQueue.url).where(UrlQueue.url.in_(uniq))).all()
    )
    added = 0
    for u in uniq:
        if u not in known:
            session.add(UrlQueue(url=u, status="pending"))
            known.add(u)
            added += 1
    return added


def claim_work(session: Session, budget: int, reverify_days: int) -> list[str]:
    """Pick up to `budget` URLs to process this run, prioritising:
      1. pending, never-attempted (NULLs first) then oldest-discovered  <- backlog
      2. pending, transiently-failed (oldest retry first)
      3. done-but-stale (older than reverify_days), only if budget remains
    """
    if budget <= 0:
        return []
    pending = session.scalars(
        select(UrlQueue.url)
        .where(UrlQueue.status == "pending")
        .order_by(
            nulls_first(UrlQueue.last_attempt_at.asc()),
            UrlQueue.first_seen.asc(),
        )
        .limit(budget)
    ).all()
    work = list(pending)

    if len(work) < budget and reverify_days > 0:
        cutoff = _utcnow().replace(tzinfo=None) - timedelta(days=reverify_days)
        stale = session.scalars(
            select(UrlQueue.url)
            .where(UrlQueue.status == "done", UrlQueue.done_at < cutoff)
            .order_by(UrlQueue.done_at.asc())
            .limit(budget - len(work))
        ).all()
        work.extend(stale)
    return work


def select_to_process(
    session: Session, urls: list[str], reverify_days: int
) -> list[str]:
    """From a specific set of (just-searched) URLs, return those still worth
    processing: never-seen, pending, or done-but-stale. Skips URLs already done
    recently (within reverify_days) and dead 'error' URLs. Used by the
    city-by-city flow to avoid re-extracting a city's already-handled pages."""
    if not urls:
        return []
    # DB datetimes come back naive (timestamp WITHOUT time zone); compare naive-to-naive.
    cutoff = _utcnow().replace(tzinfo=None) - timedelta(days=reverify_days)
    rows = {
        r.url: r
        for r in session.scalars(select(UrlQueue).where(UrlQueue.url.in_(urls)))
    }
    out: list[str] = []
    for u in urls:
        r = rows.get(u)
        if r is None or r.status == "pending":
            out.append(u)
        elif r.status == "done" and r.done_at is not None:
            done_at = r.done_at.replace(tzinfo=None) if r.done_at.tzinfo else r.done_at
            if done_at < cutoff:
                out.append(u)
    return out


def mark_url(session: Session, url: str, outcome: str) -> None:
    """Record a processing outcome. outcome in {'done','error','retry'}.
    'retry' (transient/quota) keeps it pending and does NOT count as a hard
    attempt, so quota-starved days never push a good URL out of rotation."""
    row = session.scalar(select(UrlQueue).where(UrlQueue.url == url))
    if row is None:
        return
    row.last_attempt_at = _utcnow()
    if outcome == "done":
        row.status = "done"
        row.done_at = _utcnow()
        row.attempts += 1
    elif outcome == "error":
        row.status = "error"
        row.attempts += 1
    else:  # 'retry' — transient; stay pending, no penalty
        row.status = "pending"


def queue_stats(session: Session) -> dict[str, int]:
    rows = session.execute(
        select(UrlQueue.status, func.count()).group_by(UrlQueue.status)
    ).all()
    return {status: n for status, n in rows}


def init_db() -> None:
    Base.metadata.create_all(get_engine())


def get_state(session: Session, key: str, default: str | None = None) -> str | None:
    """Read a value from the cross-run key/value store (or `default` if unset)."""
    row = session.get(PipelineState, key)
    return row.value if row is not None else default


def set_state(session: Session, key: str, value: str | None) -> None:
    """Upsert a value into the cross-run key/value store. Caller commits."""
    row = session.get(PipelineState, key)
    if row is None:
        session.add(PipelineState(key=key, value=value))
    else:
        row.value = value


def _domain_of(url: str) -> str | None:
    try:
        from urllib.parse import urlparse

        return urlparse(url).netloc or None
    except Exception:
        return None


def _same_edition(ev: ExtractedEvent, row: Event) -> bool:
    """Date compatibility: if both have a start date, treat as the same event
    only when within ~75 days (same edition), so 2026 vs 2027 stay separate."""
    a, b = ev.event_start, row.event_start
    if a and b:
        return abs((a - b).days) <= 75
    return True  # missing dates -> rely on name + city


def find_fuzzy_match(session: Session, ev: ExtractedEvent) -> Event | None:
    """Find an existing event that is the SAME real-world event as `ev` but was
    stored under a slightly different name/source. Same city (or both unknown),
    compatible dates, and a high token-set name similarity."""
    from rapidfuzz import fuzz

    candidates = session.scalars(
        select(Event).where(
            Event.city == ev.city if ev.city else Event.city.is_(None)
        )
    ).all()
    target = _name_key(ev.name)
    tnums = _edition_nums(ev.name)
    best, best_score = None, 0.0
    for row in candidates:
        if not _same_edition(ev, row):
            continue
        # Different edition/track numbers => different events (e.g. "Track 1"/"2").
        cnums = _edition_nums(row.name)
        if tnums and cnums and tnums != cnums:
            continue
        score = fuzz.token_set_ratio(target, _name_key(row.name))
        if score >= FUZZY_NAME_THRESHOLD and score > best_score:
            best, best_score = row, score
    return best


def _trunc(value: str | None, limit: int) -> str | None:
    """Clamp a string to `limit` chars (keeps None as None)."""
    if value is None:
        return None
    return value[:limit]


def upsert_event(session: Session, ev: ExtractedEvent) -> tuple[Event, bool]:
    """Insert a new event or refresh an existing one.

    Matching is two-tier: exact fingerprint first (fast), then a fuzzy
    cross-source match (same event, different name/source) so we end up with one
    canonical record carrying many source sightings. Returns (event, created).
    """
    # LLM output can run longer than a column allows; clamp bounded String()
    # fields to their limits so one verbose value never aborts the whole insert
    # with a DataError. (description=Text and topics=JSON are unbounded.)
    ev.name = _trunc(ev.name, 500)
    ev.event_type = _trunc(ev.event_type, 32)
    ev.subtype = _trunc(ev.subtype, 64)
    ev.country = _trunc(ev.country, 100)
    ev.city = _trunc(ev.city, 100)
    ev.venue = _trunc(ev.venue, 300)
    ev.audience = _trunc(ev.audience, 32)
    ev.primary_url = _trunc(ev.primary_url, 1000)
    ev.registration_url = _trunc(ev.registration_url, 1000)

    fp = ev.fingerprint()
    existing = session.scalar(select(Event).where(Event.fingerprint == fp))
    if existing is None:
        existing = find_fuzzy_match(session, ev)
    deadline = ev.actionable_deadline()
    lat, lng = CITY_LATLNG.get(ev.city or "", (None, None))

    if existing is None:
        row = Event(
            fingerprint=fp,
            name=ev.name,
            event_type=ev.event_type,
            subtype=ev.subtype,
            country=ev.country,
            city=ev.city,
            latitude=lat,
            longitude=lng,
            venue=ev.venue,
            is_online=ev.is_online,
            dedicated_security=ev.dedicated_security,
            audience=ev.audience,
            event_start=ev.event_start,
            event_end=ev.event_end,
            cfp_opens=ev.cfp_opens,
            cfp_closes=ev.cfp_closes,
            cfp_notify=ev.cfp_notify,
            deadline=deadline,
            description=ev.description,
            topics=ev.topics,
            primary_url=ev.primary_url,
            registration_url=ev.registration_url,
            confidence=ev.confidence,
            status="active",
        )
        session.add(row)
        session.flush()  # assign id for the sighting FK
        _add_sighting(session, row, ev)
        return row, True

    # Update: refresh fields, prefer higher-confidence non-null values.
    existing.last_verified = _utcnow()
    if ev.confidence >= existing.confidence:
        existing.subtype = ev.subtype or existing.subtype
        existing.description = ev.description or existing.description
        existing.registration_url = ev.registration_url or existing.registration_url
        existing.confidence = ev.confidence
    for f in ("event_start", "event_end", "cfp_opens", "cfp_closes", "cfp_notify"):
        if getattr(ev, f) is not None:
            setattr(existing, f, getattr(ev, f))
    # Backfill geography / audience if newly resolved.
    existing.city = ev.city or existing.city
    existing.country = ev.country or existing.country
    existing.venue = ev.venue or existing.venue
    existing.audience = ev.audience or existing.audience
    if lat is not None and existing.latitude is None:
        existing.latitude = lat
        existing.longitude = lng
    if deadline is not None:
        existing.deadline = deadline
    # If a previously-expired event reappears with a future deadline, revive it.
    if existing.status == "expired" and deadline and deadline >= date.today():
        existing.status = "active"
        existing.expired_at = None

    if not any(s.url == ev.primary_url for s in existing.sightings):
        _add_sighting(session, existing, ev)
    return existing, False


def _add_sighting(session: Session, row: Event, ev: ExtractedEvent) -> None:
    session.add(
        Sighting(
            event_id=row.id,
            url=ev.primary_url,
            domain=_domain_of(ev.primary_url),
            source=ev.source,
        )
    )
