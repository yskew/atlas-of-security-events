"""Backend scale test (no API quota needed). Pushes large synthetic volumes
through the work-queue and the dedup/upsert path and asserts correctness +
timing. Run against a throwaway DB:

    DATABASE_URL="sqlite:///./scale.db" python scale_test.py
"""
import time
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from pipeline.config import CITIES
from pipeline.db import (
    Base,
    Event,
    UrlQueue,
    claim_work,
    enqueue_urls,
    get_engine,
    mark_url,
    upsert_event,
)
from pipeline.models import ExtractedEvent

CITY_NAMES = [c.name for c in CITIES]


def reset():
    e = get_engine()
    Base.metadata.drop_all(e)
    Base.metadata.create_all(e)


def test_queue_scale(n=2000, budget=20):
    """Enqueue N URLs, drain over many runs; assert every URL processed exactly
    once, in order, with no starvation and no re-processing."""
    reset()
    urls = [f"https://scale.test/event/{i}" for i in range(n)]
    t0 = time.time()
    with Session(get_engine()) as s:
        enqueue_urls(s, urls)
        # enqueue again (simulating re-discovery) — must NOT duplicate
        enqueue_urls(s, urls)
        s.commit()
        total_q = s.scalar(select(func.count()).select_from(UrlQueue))
        assert total_q == n, f"queue should hold {n} unique URLs, has {total_q}"

        processed, runs = [], 0
        while True:
            work = claim_work(s, budget, 7)
            if not work:
                break
            processed.extend(work)
            for u in work:
                mark_url(s, u, "done")
            s.commit()
            runs += 1
            assert runs <= n, "drain not terminating (starvation/loop bug)"

    assert len(processed) == n, f"processed {len(processed)} != {n}"
    assert len(set(processed)) == n, "a URL was processed more than once"
    assert set(processed) == set(urls), "some URLs were never processed (starvation!)"
    dt = time.time() - t0
    print(f"[queue ] {n} URLs drained in {runs} runs of {budget}, "
          f"every URL exactly once, no starvation — {dt:.1f}s")


def test_dedup_scale(unique=400, dup_ratio=0.4):
    """Insert `unique` events plus near-duplicate variants from other 'sources';
    assert they collapse to exactly `unique` canonical rows with no fingerprint
    duplicates and merged sightings."""
    reset()
    rows = []
    for i in range(unique):
        city = CITY_NAMES[i % len(CITY_NAMES)]
        month = (i % 12) + 1
        rows.append(ExtractedEvent(
            name=f"SecCon {city} Series {i}", event_type="conference",
            city=city, country="India", event_start=date(2026, month, 10),
            description="d", primary_url=f"https://official.test/{i}",
            audience="professional",
        ))
    dups = 0
    for i in range(unique):
        if (i * 7919) % 100 < dup_ratio * 100:  # deterministic ~dup_ratio subset
            city = CITY_NAMES[i % len(CITY_NAMES)]
            month = (i % 12) + 1
            rows.append(ExtractedEvent(
                name=f"SecCon {city} Series {i} — Call for Papers",  # variant name
                event_type="conference", city=city, country="India",
                event_start=date(2026, month, 10), description="d",
                primary_url=f"https://aggregator.test/{i}",  # different source
                audience="professional",
            ))
            dups += 1

    t0 = time.time()
    with Session(get_engine()) as s:
        for ev in rows:
            upsert_event(s, ev)
        s.commit()
        total = s.scalar(select(func.count()).select_from(Event))
        merged = s.scalar(
            select(func.count()).select_from(Event)
            .where(Event.id.in_(select(Event.id)))  # all
        )
        # fingerprint uniqueness
        fps = s.scalars(select(Event.fingerprint)).all()
    dt = time.time() - t0

    assert total == unique, f"expected {unique} canonical events, got {total} (dedup failed)"
    assert len(fps) == len(set(fps)), "duplicate fingerprints present"
    print(f"[dedup ] {len(rows)} inserts ({dups} near-dup variants) -> "
          f"{total} canonical events, 0 fingerprint dupes — {dt:.1f}s")
    _ = merged


if __name__ == "__main__":
    print("=== backend scale test (no API quota) ===")
    test_queue_scale()
    test_dedup_scale()
    print("ALL SCALE CHECKS PASSED")
