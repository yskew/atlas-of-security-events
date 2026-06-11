"""Daily pipeline orchestrator.

    python -m pipeline.run            # full run: discover -> dedup -> upsert -> expire
    python -m pipeline.run --list     # print currently-active events and exit

Runs end-to-end with NO API keys (ctftime only). Setting GEMINI_API_KEY adds
web-search discovery (DuckDuckGo) + Gemini structured extraction of each page.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import CITIES_ORDERED, SEED_EVENT_URLS, SETTINGS
from .db import (
    CURSOR_KEY,
    Event,
    enqueue_urls,
    get_engine,
    get_state,
    init_db,
    mark_url,
    select_to_process,
    set_state,
    upsert_event,
)
from .expire import expire_past, hard_purge, purge_disreputable
from .models import ExtractedEvent
from .sources import ctftime

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("pipeline")


def _safe(name: str, fn, default, summary: dict):
    """Run a source/step in isolation; log + record any failure and return
    `default` so one broken source never kills the whole unattended run."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 - deliberately broad for resilience
        log.exception("source %r failed: %s", name, exc)
        summary["errors"].append(f"{name}: {type(exc).__name__}")
        return default


def _run_deadline() -> float | None:
    """Monotonic timestamp at which this run must stop, or None for no cap.

    Driven by SETTINGS.run_max_minutes: 0 / unset => None (local mode, run until a
    full city sweep finishes). GitHub Actions sets the minutes so the job stops
    cleanly under the 6h runner limit, saving the bookmark for the next run."""
    minutes = SETTINGS.run_max_minutes
    if minutes and minutes > 0:
        return time.monotonic() + minutes * 60.0
    return None


def _time_up(deadline: float | None) -> bool:
    """True once the wall-clock budget is spent (always False when uncapped)."""
    return deadline is not None and time.monotonic() >= deadline


def _relevant(ev: ExtractedEvent) -> bool:
    """Keep only on-site, target-geo, reputable, professional, well-known
    cybersecurity events with a future actionable date.

    CTFs (from ctftime) are trusted sources, so they bypass the notable gate."""
    if ev.is_online or not ev.matches_target_geo():
        return False
    if not ev.from_reputable_source() or not ev.is_professional():
        return False
    if ev.event_type != "ctf":
        # Well-known + genuinely cybersecurity (drops niche/new/adjacent).
        if not ev.notable or not ev.dedicated_security:
            return False
    deadline = ev.actionable_deadline()
    return deadline is not None and deadline >= date.today()


def _store_event(session: Session, ev: ExtractedEvent) -> int | None:
    """Resolve geo, apply the relevance filter, and upsert ONE event (dedup runs
    against the live DB inside upsert_event). Returns 1=new, 0=merged, None=filtered.
    Caller commits."""
    ev = ev.resolve_geo()
    if not _relevant(ev):
        return None
    _, was_created = upsert_event(session, ev)
    return 1 if was_created else 0


def _store_events(engine, events: list[ExtractedEvent]) -> tuple[int, int]:
    """Store a batch of already-extracted events (e.g. ctftime), committing each
    one individually so it lands in the DB immediately."""
    created = updated = 0
    if not events:
        return 0, 0
    with Session(engine) as session:
        for ev in events:
            r = _store_event(session, ev)
            if r is None:
                continue
            created += r
            updated += 1 - r
            session.commit()  # per-event commit -> visible to the UI right away
    return created, updated


def _process_urls(
    session, urls: list[str], state: dict, label: str, deadline: float | None
) -> bool:
    """Fetch + extract + store each URL, committing per URL (live UI, crash-safe).
    Mutates `state` (created/updated/processed/transient). Returns True if the run
    should STOP — the time budget elapsed, the optional extract budget is reached,
    or all LLM providers are exhausted. Unprocessed URLs stay queued for the next
    run; the caller leaves the city bookmark put so we resume here."""
    from .extract import TransientExtractionError, extract_from_page
    from .fetch import fetch

    budget = SETTINGS.max_extract_per_run  # 0 => unlimited (time/sweep governs)
    throttle = SETTINGS.extract_throttle_seconds
    new_here = 0
    for url in urls:
        if _time_up(deadline):
            log.info("[%s] time budget reached — remaining stays queued", label)
            return True
        if budget and state["processed"] >= budget:
            log.info("hit extract budget (%d) — remaining stays queued", budget)
            return True
        content = fetch(url)
        if not content:
            mark_url(session, url, "error")  # dead after the full fetch ladder
            session.commit()
            continue
        try:
            events = extract_from_page(url, content)
        except TransientExtractionError as exc:
            log.info("transient on %s (%s); stays pending", url, str(exc)[:70])
            mark_url(session, url, "retry")
            session.commit()
            state["transient"] += 1
            if state["transient"] >= 3:
                log.info("all LLM providers exhausted — stopping; rest stays queued")
                return True
            time.sleep(throttle)
            continue
        state["transient"] = 0
        for ev in events:  # 0, 1, or many (listing pages yield several)
            r = _store_event(session, ev)
            if r is not None:
                state["created"] += r
                state["updated"] += 1 - r
                new_here += r
                log.info("  + %s: %s", "new" if r else "merged", (ev.name or "")[:50])
        mark_url(session, url, "done")
        session.commit()  # event + queue outcome persisted together, per URL
        state["processed"] += 1
        time.sleep(throttle)
    log.info("[%s] +%d new this run", label, new_here)
    return False


def _cursor_start_index(ordered: list, cursor_name: str | None) -> int:
    """Resolve the saved bookmark (a city name) to its index in the ordered list.
    Falls back to 0 — the start of a fresh sweep — if it's unset or the name no
    longer exists (e.g. the city list was edited)."""
    if cursor_name:
        for idx, city in enumerate(ordered):
            if city.name == cursor_name:
                return idx
    return 0


def _city_by_city(engine, summary: dict, deadline: float | None) -> tuple[int, int]:
    """Sweep cities in priority order (India → US → UK → Singapore → Europe →
    rest), RESUMING from the saved bookmark and finishing each city before moving
    on. Well-known global seed pages are processed first.

    The bookmark (CURSOR_KEY, a city name in the shared DB) advances after each
    completed city and RESETS to the first city once the last one finishes — so the
    next run, local or scheduled, begins a fresh sweep. A run ends when the time
    budget elapses, the LLM quota is exhausted, or a full sweep completes; in the
    first two cases the bookmark stays on the unfinished city so we resume there."""
    from .sources import websearch

    state = {"created": 0, "updated": 0, "processed": 0, "transient": 0}
    ordered = list(CITIES_ORDERED)
    n = len(ordered)
    if n == 0:
        return 0, 0

    with Session(engine) as session:
        # 1. Well-known global org pages (Black Hat, DEF CON, OWASP, RSA, …),
        #    every run — cheap once they're 'done' (dedup skips them).
        if SEED_EVENT_URLS:
            enqueue_urls(session, list(SEED_EVENT_URLS))
            session.commit()
            todo = select_to_process(
                session, list(SEED_EVENT_URLS), SETTINGS.reverify_after_days
            )
            log.info("[seeds] %d to process", len(todo))
            if _process_urls(session, todo, state, "seeds", deadline):
                return state["created"], state["updated"]

        # 2. Resume the city sweep from the saved bookmark.
        start = _cursor_start_index(ordered, get_state(session, CURSOR_KEY))
        log.info("sweep: starting at city %d/%d (%s)", start + 1, n, ordered[start].name)

        i = start
        while i < n:
            if _time_up(deadline):
                set_state(session, CURSOR_KEY, ordered[i].name)
                session.commit()
                log.info("time budget reached — bookmark left at %s", ordered[i].name)
                return state["created"], state["updated"]

            city = ordered[i]
            urls = _safe(
                f"search:{city.name}",
                lambda c=city: websearch.search_city(c.name),
                default=[],
                summary=summary,
            )
            if urls:
                enqueue_urls(session, urls)
                session.commit()
                # Walk DOWN the ranked pool, skipping already-done/dead URLs, and
                # keep the top `target_fresh_per_city` fresh ones (fewer if the pool
                # runs dry — that's fine). select_to_process preserves rank order.
                fresh = select_to_process(session, urls, SETTINGS.reverify_after_days)
                todo = fresh[: SETTINGS.target_fresh_per_city]
                log.info(
                    "[%s / %s] %d searched, %d fresh -> processing %d (target %d)",
                    city.name, city.country, len(urls), len(fresh),
                    len(todo), SETTINGS.target_fresh_per_city,
                )
                if _process_urls(session, todo, state, city.name, deadline):
                    # Stopped mid-city (time/quota) — leave the bookmark on THIS
                    # city so the next run resumes it (URL dedup skips what's done).
                    set_state(session, CURSOR_KEY, city.name)
                    session.commit()
                    log.info("stopping — bookmark left at %s", city.name)
                    return state["created"], state["updated"]

            # City finished -> advance the bookmark, wrapping back to the first
            # city once the last one is done (a full sweep just completed).
            i += 1
            next_name = ordered[i].name if i < n else ordered[0].name
            set_state(session, CURSOR_KEY, next_name)
            session.commit()

        log.info("full sweep complete — bookmark reset to %s", ordered[0].name)
    return state["created"], state["updated"]


def run() -> dict:
    init_db()
    engine = get_engine()
    summary: dict = {"errors": []}
    created = updated = 0

    # ctftime (no LLM) — store each immediately.
    ctf = _safe("ctftime", ctftime.discover, default=[], summary=summary)
    c, u = _safe("ctftime-store", lambda: _store_events(engine, ctf), default=(0, 0), summary=summary)
    created += c
    updated += u

    # Web discovery: sequential, one city fully finished before the next, in
    # priority order, resuming from the saved bookmark. Each event is committed
    # the instant it's confirmed.
    if SETTINGS.llm_enabled:
        deadline = _run_deadline()
        if deadline is None:
            log.info("no run time budget — sweeping until a full pass completes")
        else:
            log.info("run time budget: %g min", SETTINGS.run_max_minutes)
        c, u = _safe(
            "city-by-city",
            lambda: _city_by_city(engine, summary, deadline),
            default=(0, 0),
            summary=summary,
        )
        created += c
        updated += u
    else:
        log.info("No LLM configured — ctftime only")

    log.info("stored this run: +%d new, %d merged", created, updated)

    # Cleanup once at the end (short tx).
    with Session(engine) as session:
        disreputable = purge_disreputable(session)
        expired = expire_past(session)
        purged = hard_purge(session)
        session.commit()

        total_active = session.scalar(
            select(func.count()).select_from(Event).where(Event.status == "active")
        )

    summary.update(
        created=created, updated=updated, disreputable=disreputable,
        expired=expired, purged=purged, active=total_active,
    )
    log.info(
        "done: +%d new, %d updated/merged, %d removed(academic), %d expired, "
        "%d purged | %d active | source errors: %s",
        created, updated, disreputable, expired, purged, total_active,
        summary["errors"] or "none",
    )
    return summary


def list_active() -> None:
    init_db()
    with Session(get_engine()) as session:
        rows = session.scalars(
            select(Event).where(Event.status == "active").order_by(Event.deadline)
        ).all()
        if not rows:
            print("No active events yet. Run `python -m pipeline.run` first.")
            return
        print(f"\n{len(rows)} active events:\n" + "=" * 70)
        for e in rows:
            loc = e.city or "?"
            when = e.event_start or e.cfp_closes or "TBD"
            print(f"\n[{e.event_type.upper()}] {e.name}")
            print(f"  where: {loc} ({e.country or '?'})   when: {when}   deadline: {e.deadline or 'TBD'}")
            print(f"  {e.description[:160]}")
            print(f"  source: {e.primary_url}")


def main() -> int:
    parser = argparse.ArgumentParser(description="SecurityEvents daily pipeline")
    parser.add_argument("--list", action="store_true", help="list active events and exit")
    args = parser.parse_args()
    if args.list:
        list_active()
    else:
        run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
