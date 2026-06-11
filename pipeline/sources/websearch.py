"""Free keyless web search (DuckDuckGo) to discover candidate event pages.

Replaces Gemini's Google-Search grounding, which 429s on the free tier. This
module only produces candidate URLs; fetching + structured extraction happen in
the orchestrator via the fetch ladder + Gemini.
"""
from __future__ import annotations

import logging
from datetime import date

from ..config import (
    CITIES,
    EXTRA_QUERY_TEMPLATES,
    QUERY_TEMPLATES,
    SEARCH_TYPES,
    SETTINGS,
    TYPE_QUERY_TERMS,
    is_blocked_or_academic,
)

log = logging.getLogger(__name__)


def build_queries() -> list[str]:
    """City-major queries, rotated daily so the cap still covers EVERY city over
    successive runs (a different window leads each day). With many cities the
    per-run cap can't reach them all at once, so we rotate the start offset by
    the day-of-year; the queue + Gemini quota drain the backlog over time."""
    year = date.today().year
    cities = list(CITIES)
    if cities:
        offset = date.today().toordinal() % len(cities)
        cities = cities[offset:] + cities[:offset]
    queries: list[str] = []
    seen: set[str] = set()
    for city in cities:
        for t in SEARCH_TYPES:
            term = TYPE_QUERY_TERMS.get(t, t)
            for tmpl in QUERY_TEMPLATES:
                q = tmpl.format(type=term, city=city.name, year=year)
                if q not in seen:
                    seen.add(q)
                    queries.append(q)
        # brand/series + alternate-phrasing queries (OWASP, BSides, DEF CON …)
        for tmpl in EXTRA_QUERY_TEMPLATES:
            q = tmpl.format(city=city.name, year=year)
            if q not in seen:
                seen.add(q)
                queries.append(q)
    return queries[: SETTINGS.max_search_queries]


def queries_for_city(city_name: str) -> list[str]:
    """All search queries for ONE city (type matrix + brand/series queries)."""
    year = date.today().year
    qs: list[str] = []
    seen: set[str] = set()
    for t in SEARCH_TYPES:
        term = TYPE_QUERY_TERMS.get(t, t)
        for tmpl in QUERY_TEMPLATES:
            q = tmpl.format(type=term, city=city_name, year=year)
            if q not in seen:
                seen.add(q)
                qs.append(q)
    for tmpl in EXTRA_QUERY_TEMPLATES:
        q = tmpl.format(city=city_name, year=year)
        if q not in seen:
            seen.add(q)
            qs.append(q)
    return qs


def search_city(city_name: str) -> list[str]:
    """Search every query for one city; return the top ~N unique candidate URLs.

    DuckDuckGo ranks each query's hits by relevance, so rather than keep all
    ~140 results we INTERLEAVE the top of every query angle (OWASP, BSides,
    conference, CFP, meetup …): rank-1 of each query first, then rank-2, … —
    capped at ``max_urls_per_city``. This keeps breadth across event types while
    dropping the long tail (where the SEO-spam / off-topic pages live)."""
    try:
        from ddgs import DDGS
    except Exception as exc:
        log.warning("ddgs not available (%s) — skipping web search", exc)
        return []

    per_query: list[list[str]] = []  # one ranked, de-junked list per query
    seen: set[str] = set()
    with DDGS() as ddg:
        for q in queries_for_city(city_name):
            try:
                hits = ddg.text(q, max_results=SETTINGS.max_search_results)
            except Exception as exc:
                log.debug("search failed for %r: %s", q, exc)
                continue
            ranked: list[str] = []
            for h in hits:
                url = (h.get("href") or "").strip()
                if url and not _is_junk(url):
                    ranked.append(url)
            per_query.append(ranked)

    cap = SETTINGS.max_urls_per_city
    urls: list[str] = []
    depth = 0
    while len(urls) < cap:
        progressed = False
        for ranked in per_query:
            if depth >= len(ranked):
                continue
            progressed = True
            url = ranked[depth]
            if url not in seen:
                seen.add(url)
                urls.append(url)
                if len(urls) >= cap:
                    break
        if not progressed:  # every query exhausted before reaching the cap
            break
        depth += 1
    return urls


# Real event pages have short, clean URLs. Anything past this is almost always an
# ad / tracking redirect (e.g. a bing.com/aclick blob) — junk we don't want, and
# long enough to overflow the url_queue.url column. Drop it before it gets in.
_MAX_URL_LEN = 500


def _is_junk(url: str) -> bool:
    # Drops over-long redirect/tracking URLs, social media, predatory
    # aggregators, and academic/edu domains — before fetching, so we never spend
    # Gemini quota on them.
    return len(url) > _MAX_URL_LEN or is_blocked_or_academic(url)


def search_candidate_urls(max_total: int = 200) -> list[str]:
    """Run the query matrix through DuckDuckGo; return unique candidate URLs."""
    try:
        from ddgs import DDGS
    except Exception as exc:
        log.warning("ddgs not available (%s) — skipping web search", exc)
        return []

    urls: list[str] = []
    seen: set[str] = set()
    queries = build_queries()
    log.info("web search: %d queries", len(queries))

    with DDGS() as ddg:
        for q in queries:
            if len(urls) >= max_total:
                break
            try:
                hits = ddg.text(q, max_results=SETTINGS.max_search_results)
            except Exception as exc:
                log.debug("search failed for %r: %s", q, exc)
                continue
            for h in hits:
                url = (h.get("href") or "").strip()
                if not url or url in seen or _is_junk(url):
                    continue
                seen.add(url)
                urls.append(url)

    log.info("web search: %d unique candidate URLs", len(urls))
    return urls
