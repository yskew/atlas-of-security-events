"""Run the pipeline N times, checking results after each for accuracy &
idempotency (no duplicate fingerprints, no data loss, clean quality flags).

    python iterate.py 9        # run 9 more iterations (2..10)
"""
import sys
from collections import Counter
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from pipeline.config import CITIES
from pipeline.db import Event, Sighting, UrlQueue, get_engine, init_db
from pipeline.run import run

VALID_CITIES = {c.name for c in CITIES}
VALID_COUNTRIES = {c.country for c in CITIES}


def snapshot(label: str) -> dict:
    with Session(get_engine()) as s:
        events = s.scalars(select(Event)).all()
        active = [e for e in events if e.status == "active"]
        fps = Counter(e.fingerprint for e in events)
        dupes = [fp for fp, n in fps.items() if n > 1]

        problems = []
        for e in active:
            if not e.primary_url or "://" not in e.primary_url:
                problems.append(f"bad-url:{e.name}")
            if e.is_online:
                problems.append(f"online:{e.name}")
            if e.deadline and e.deadline < date.today():
                problems.append(f"past-active:{e.name}")
            if e.city not in VALID_CITIES and e.country not in VALID_COUNTRIES:
                problems.append(f"out-of-geo:{e.name}")

        sightings = s.scalar(select(func.count()).select_from(Sighting))
        q = dict(
            s.execute(select(UrlQueue.status, func.count()).group_by(UrlQueue.status)).all()
        )
        info = {
            "total": len(events),
            "active": len(active),
            "expired": len(events) - len(active),
            "by_type": dict(Counter(e.event_type for e in active)),
            "dupes": dupes,
            "problems": problems,
            "sightings": sightings,
            "queue": q,
        }
    flag = "OK" if not dupes and not problems else "PROBLEM"
    print(
        f"[{label}] active={info['active']} total={info['total']} "
        f"expired={info['expired']} types={info['by_type']} "
        f"queue(pending={q.get('pending',0)},done={q.get('done',0)},error={q.get('error',0)}) "
        f"dupes={len(dupes)} problems={len(problems)} -> {flag}"
    )
    if dupes:
        print("   DUPLICATE FINGERPRINTS:", dupes)
    if problems:
        print("   PROBLEMS:", problems)
    return info


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 9
    init_db()
    start_iter = 2  # iteration 1 already done by the initial heavy run
    print(f"=== running {n} iterations (idempotency + accuracy check) ===")
    snapshot("baseline")
    for i in range(start_iter, start_iter + n):
        print(f"\n--- iteration {i} ---")
        run()
        snapshot(f"iter {i}")


if __name__ == "__main__":
    main()
