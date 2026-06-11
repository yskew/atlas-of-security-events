"""Quality-check the stored events. Prints active events + flags data problems."""
from collections import Counter
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from pipeline.config import CITIES
from pipeline.db import Event, Sighting, UrlQueue, get_engine, init_db

VALID_CITIES = {c.name for c in CITIES}
VALID_COUNTRIES = {c.country for c in CITIES}


def main() -> None:
    init_db()
    with Session(get_engine()) as s:
        active = s.scalars(
            select(Event).where(Event.status == "active").order_by(Event.deadline)
        ).all()
        total = s.scalar(select(func.count()).select_from(Event))
        expired = s.scalar(select(func.count()).where(Event.status == "expired"))
        sightings = s.scalar(select(func.count()).select_from(Sighting))
        q = dict(
            s.execute(select(UrlQueue.status, func.count()).group_by(UrlQueue.status)).all()
        )

        print(f"\nDB totals: {total} events ({len(active)} active, {expired} expired), "
              f"{sightings} sightings | queue pending={q.get('pending',0)} "
              f"done={q.get('done',0)} error={q.get('error',0)}")
        print(f"by type: {dict(Counter(e.event_type for e in active))}")
        print(f"by source-domain: {dict(Counter((e.primary_url.split('/')[2] if '://' in e.primary_url else '?') for e in active))}")

        print("\n--- ACTIVE EVENTS ---")
        for e in active:
            print(f"\n[{e.event_type}/{e.subtype or '-'}] {e.name}")
            print(f"  geo: {e.city} / {e.country} | online={e.is_online} | dedicated_sec={e.dedicated_security}")
            print(f"  event: {e.event_start}..{e.event_end} | cfp_closes: {e.cfp_closes} | DEADLINE: {e.deadline}")
            print(f"  {(e.description or '')[:140]}")
            print(f"  url: {e.primary_url}")

        # --- data-quality flags ---
        problems = []
        fps = [e.fingerprint for e in s.scalars(select(Event)).all()]
        dupes = [fp for fp, n in Counter(fps).items() if n > 1]
        if dupes:
            problems.append(f"DUPLICATE fingerprints: {dupes}")
        for e in active:
            if not e.primary_url or "://" not in e.primary_url:
                problems.append(f"missing/bad URL: {e.name!r}")
            if e.is_online:
                problems.append(f"online event leaked into active: {e.name!r}")
            if e.deadline and e.deadline < date.today():
                problems.append(f"past-deadline still ACTIVE: {e.name!r} ({e.deadline})")
            if e.city not in VALID_CITIES and e.country not in VALID_COUNTRIES:
                problems.append(f"out-of-geo: {e.name!r} ({e.city}/{e.country})")

        print("\n--- QUALITY CHECK ---")
        if problems:
            for p in problems:
                print("  PROBLEM:", p)
        else:
            print("  OK: no duplicates, all have URLs, none online, none past-deadline-active, all in-geo")


if __name__ == "__main__":
    main()
