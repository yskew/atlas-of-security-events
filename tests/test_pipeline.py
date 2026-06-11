"""DB-level tests: dedup (exact + fuzzy), lifecycle (expire/purge), work-queue."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from pipeline.config import is_blocked_or_academic
from pipeline.db import (
    Event,
    claim_work,
    enqueue_urls,
    mark_url,
    upsert_event,
)
from pipeline.dedup import dedupe
from pipeline.expire import expire_past, hard_purge, purge_disreputable
from pipeline.models import ExtractedEvent


def mk(**kw) -> ExtractedEvent:
    base = dict(
        name="X", event_type="conference", city="Bangalore", country="India",
        description="d", primary_url="https://example.com/x", audience="professional",
    )
    base.update(kw)
    return ExtractedEvent(**base)


def _count(session) -> int:
    return session.scalar(select(func.count()).select_from(Event))


# --- config gate ------------------------------------------------------------
def test_blocked_or_academic():
    assert is_blocked_or_academic("https://iraj.in/x")
    assert is_blocked_or_academic("https://a.ac.in/")
    assert is_blocked_or_academic("https://b.edu.in/")
    assert is_blocked_or_academic("https://waset.org/z")
    assert not is_blocked_or_academic("https://c0c0n.org/")
    assert not is_blocked_or_academic("https://2026.h7tex.com/")


# --- in-run exact dedup -----------------------------------------------------
def test_dedupe_in_run_merges_and_fills():
    a = mk(name="c0c0n 2026", event_start=date(2026, 10, 6), city="Kochi", confidence=0.6)
    b = mk(name="c0c0n 2026", event_start=date(2026, 10, 6), city="Kochi",
           cfp_closes=date(2026, 5, 10), registration_url="https://c0c0n.org/reg",
           confidence=0.9)
    out = dedupe([a, b])
    assert len(out) == 1
    assert out[0].cfp_closes == date(2026, 5, 10)        # filled from b
    assert out[0].registration_url == "https://c0c0n.org/reg"


# --- fuzzy cross-source dedup (the key production gap) ----------------------
def test_fuzzy_upsert_merges_same_event_across_sources(session):
    upsert_event(session, mk(name="BSides Bangalore 2026",
                             primary_url="https://bsidesbangalore.in/",
                             event_start=date(2026, 3, 1)))
    upsert_event(session, mk(name="BSides Bangalore 2026 - Call for Papers",
                             primary_url="https://aggregator.com/blr",
                             event_start=date(2026, 3, 1)))
    session.commit()
    assert _count(session) == 1                          # merged into one
    ev = session.scalars(select(Event)).first()
    assert len(ev.sightings) == 2                        # both source URLs kept


def test_fuzzy_keeps_different_editions_separate(session):
    upsert_event(session, mk(name="BSides Bangalore 2026",
                             primary_url="https://b.in/26", event_start=date(2026, 3, 1)))
    upsert_event(session, mk(name="BSides Bangalore 2027",
                             primary_url="https://b.in/27", event_start=date(2027, 3, 1)))
    session.commit()
    assert _count(session) == 2                          # different years -> distinct


# --- lifecycle: expire / purge ----------------------------------------------
def test_expire_past_deadline(session):
    upsert_event(session, mk(name="Past CFP", event_type="cfp",
                             cfp_closes=date.today() - timedelta(days=3),
                             primary_url="https://x.com/past"))
    upsert_event(session, mk(name="Future Conf",
                             event_end=date.today() + timedelta(days=30),
                             primary_url="https://x.com/future"))
    session.commit()
    assert expire_past(session) == 1
    session.commit()
    active = session.scalars(
        select(Event.name).where(Event.status == "active")
    ).all()
    assert active == ["Future Conf"]


def test_purge_disreputable(session):
    upsert_event(session, mk(name="Predatory", primary_url="https://iraj.in/c/1"))
    upsert_event(session, mk(name="Academic", audience="academic",
                             primary_url="https://good.com/a"))
    upsert_event(session, mk(name="Campus CTF", event_type="ctf", audience="academic",
                             primary_url="https://ctf.com/x"))   # CTF exempt
    upsert_event(session, mk(name="Pro Conf", primary_url="https://pro.com/c"))
    session.commit()
    removed = purge_disreputable(session)
    session.commit()
    assert removed == 2                                  # predatory domain + academic
    names = set(session.scalars(select(Event.name)).all())
    assert names == {"Campus CTF", "Pro Conf"}


def test_hard_purge_old_expired(session):
    ev, _ = upsert_event(session, mk(name="Old", primary_url="https://x.com/o"))
    ev.status = "expired"
    ev.expired_at = datetime.now(timezone.utc) - timedelta(days=100)  # > 90
    session.commit()
    assert hard_purge(session) == 1
    session.commit()
    assert _count(session) == 0


# --- work queue: priority + no starvation -----------------------------------
def test_queue_drains_backlog_without_starvation(session):
    def U(x):
        return f"https://q.test/{x}"

    enqueue_urls(session, [U("A"), U("B"), U("C"), U("D")])
    session.commit()

    w1 = claim_work(session, 2, 7)
    assert [u[-1] for u in w1] == ["A", "B"]              # oldest never-tried first
    for u in w1:
        mark_url(session, u, "done")
    session.commit()

    w2 = claim_work(session, 2, 7)
    assert [u[-1] for u in w2] == ["C", "D"]              # resumes, does NOT redo A,B


def test_queue_transient_stays_pending_behind_new(session):
    def U(x):
        return f"https://q.test/{x}"

    enqueue_urls(session, [U("A")])
    session.commit()
    mark_url(session, U("A"), "retry")                   # transient -> stays pending
    enqueue_urls(session, [U("B")])                      # newly discovered
    session.commit()
    w = claim_work(session, 1, 7)
    assert w[0][-1] == "B"                                # never-tried beats retried
    mark_url(session, U("B"), "done")
    session.commit()
    w2 = claim_work(session, 1, 7)
    assert w2[0][-1] == "A"                               # retried one eventually returns


def test_queue_reverify_after_interval(session):
    def U(x):
        return f"https://q.test/{x}"

    enqueue_urls(session, [U("A")])
    session.commit()
    mark_url(session, U("A"), "done")
    session.commit()
    assert claim_work(session, 5, 7) == []               # done & fresh -> not reclaimed
    # age it past the reverify window
    from pipeline.db import UrlQueue
    row = session.scalar(select(UrlQueue).where(UrlQueue.url == U("A")))
    row.done_at = datetime.now(timezone.utc) - timedelta(days=8)
    session.commit()
    assert claim_work(session, 5, 7) == [U("A")]         # stale -> reclaimed for refresh
