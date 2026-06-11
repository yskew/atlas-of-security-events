"""Central configuration: target geography, event taxonomy, and runtime settings.

Adding a city or an event type is intentionally a one-line change here.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()


# --- Target geography -------------------------------------------------------
# Each city carries aliases so we can match messy location strings from sources
# (e.g. ctftime free-text "Bengaluru, India" or "Greater London, UK").
@dataclass(frozen=True)
class City:
    name: str
    country: str
    aliases: tuple[str, ...] = ()
    lat: float = 0.0
    lng: float = 0.0


# Add a city here (with its lat/lng) and the whole stack picks it up — the
# pipeline stores those coords on each event and the UI plots/zooms from the
# data, so NO frontend changes are ever needed for a new city or country.
CITIES: tuple[City, ...] = (
    # --- North America ---
    City("Las Vegas", "United States", (), 36.1699, -115.1398),
    City("San Francisco", "United States", (), 37.7749, -122.4194),
    City("San Jose", "United States", (), 37.3382, -121.8863),
    City("Santa Clara", "United States", (), 37.3541, -121.9552),
    City("Los Angeles", "United States", (), 34.0522, -118.2437),
    City("San Diego", "United States", (), 32.7157, -117.1611),
    City("Seattle", "United States", (), 47.6062, -122.3321),
    City("Portland", "United States", (), 45.5152, -122.6784),
    City("Denver", "United States", (), 39.7392, -104.9903),
    City("Phoenix", "United States", (), 33.4484, -112.0740),
    City("Salt Lake City", "United States", (), 40.7608, -111.8910),
    City("Austin", "United States", (), 30.2672, -97.7431),
    City("Dallas", "United States", (), 32.7767, -96.7970),
    City("Houston", "United States", (), 29.7604, -95.3698),
    City("Chicago", "United States", (), 41.8781, -87.6298),
    City("Washington DC", "United States", ("washington",), 38.9072, -77.0369),
    City("New York City", "United States", ("new york", "nyc"), 40.7128, -74.0060),
    City("Boston", "United States", (), 42.3601, -71.0589),
    City("Toronto", "Canada", (), 43.6532, -79.3832),
    City("Ottawa", "Canada", (), 45.4215, -75.6972),
    City("Montreal", "Canada", (), 45.5019, -73.5674),
    City("Vancouver", "Canada", (), 49.2827, -123.1207),
    # --- Europe ---
    City("London", "United Kingdom", ("greater london",), 51.5074, -0.1278),
    City("Edinburgh", "United Kingdom", (), 55.9533, -3.1883),
    City("Glasgow", "United Kingdom", (), 55.8642, -4.2518),
    City("Manchester", "United Kingdom", (), 53.4808, -2.2426),
    City("Birmingham", "United Kingdom", (), 52.4862, -1.8904),
    City("Bristol", "United Kingdom", (), 51.4545, -2.5879),
    City("Cambridge", "United Kingdom", (), 52.2053, 0.1218),
    City("Dublin", "Ireland", (), 53.3498, -6.2603),
    City("Berlin", "Germany", (), 52.5200, 13.4050),
    City("Munich", "Germany", (), 48.1351, 11.5820),
    City("Frankfurt", "Germany", (), 50.1109, 8.6821),
    City("Paris", "France", (), 48.8566, 2.3522),
    City("Amsterdam", "Netherlands", (), 52.3676, 4.9041),
    City("Brussels", "Belgium", (), 50.8503, 4.3517),
    City("Luxembourg City", "Luxembourg", ("luxembourg",), 49.6116, 6.1319),
    City("Zurich", "Switzerland", (), 47.3769, 8.5417),
    City("Geneva", "Switzerland", (), 46.2044, 6.1432),
    City("Vienna", "Austria", (), 48.2082, 16.3738),
    City("Madrid", "Spain", (), 40.4168, -3.7038),
    City("Barcelona", "Spain", (), 41.3851, 2.1734),
    City("Lisbon", "Portugal", (), 38.7223, -9.1393),
    City("Milan", "Italy", (), 45.4642, 9.1900),
    City("Rome", "Italy", (), 41.9028, 12.4964),
    City("Stockholm", "Sweden", (), 59.3293, 18.0686),
    City("Oslo", "Norway", (), 59.9139, 10.7522),
    City("Copenhagen", "Denmark", (), 55.6761, 12.5683),
    City("Warsaw", "Poland", (), 52.2297, 21.0122),
    City("Prague", "Czech Republic", (), 50.0755, 14.4378),
    City("Budapest", "Hungary", (), 47.4979, 19.0402),
    City("Athens", "Greece", (), 37.9838, 23.7275),
    # --- Asia / Middle East ---
    City("Bangalore", "India", ("bengaluru",), 12.9716, 77.5946),
    City("Mumbai", "India", ("bombay",), 19.0760, 72.8777),
    City("Delhi", "India", ("new delhi", "gurugram", "noida"), 28.6139, 77.2090),
    City("Chennai", "India", ("madras",), 13.0827, 80.2707),
    City("Hyderabad", "India", (), 17.3850, 78.4867),
    City("Pune", "India", (), 18.5204, 73.8567),
    City("Kolkata", "India", ("calcutta",), 22.5726, 88.3639),
    City("Kochi", "India", ("cochin", "kerala"), 9.9312, 76.2673),
    City("Goa", "India", ("panaji",), 15.2993, 74.1240),
    City("Ahmedabad", "India", (), 23.0225, 72.5714),
    City("Jaipur", "India", (), 26.9124, 75.7873),
    City("Chandigarh", "India", (), 30.7333, 76.7794),
    City("Singapore", "Singapore", (), 1.3521, 103.8198),
    City("Tokyo", "Japan", (), 35.6762, 139.6503),
    City("Osaka", "Japan", (), 34.6937, 135.5023),
    City("Kyoto", "Japan", (), 35.0116, 135.7681),
    City("Seoul", "South Korea", (), 37.5665, 126.9780),
    City("Beijing", "China", (), 39.9042, 116.4074),
    City("Shanghai", "China", (), 31.2304, 121.4737),
    City("Hong Kong", "Hong Kong", (), 22.3193, 114.1694),
    City("Bangkok", "Thailand", (), 13.7563, 100.5018),
    City("Dubai", "United Arab Emirates", (), 25.2048, 55.2708),
    City("Abu Dhabi", "United Arab Emirates", (), 24.4539, 54.3773),
    City("Riyadh", "Saudi Arabia", (), 24.7136, 46.6753),
    City("Doha", "Qatar", (), 25.2854, 51.5310),
    City("Manama", "Bahrain", (), 26.2285, 50.5860),
    City("Tel Aviv", "Israel", ("tel-aviv",), 32.0853, 34.7818),
    City("Jerusalem", "Israel", (), 31.7683, 35.2137),
)

# Derived from CITIES so new countries appear automatically.
COUNTRIES: tuple[str, ...] = tuple(dict.fromkeys(c.country for c in CITIES))

# Order the pipeline walks cities (sequential, one city fully done before next):
# India → United States → United Kingdom → Singapore → Europe → everywhere else.
_EUROPE: frozenset[str] = frozenset(
    {
        "Ireland", "Germany", "France", "Netherlands", "Belgium", "Luxembourg",
        "Switzerland", "Austria", "Spain", "Portugal", "Italy", "Sweden",
        "Norway", "Denmark", "Poland", "Czech Republic", "Hungary", "Greece",
    }
)
_COUNTRY_PRIORITY: dict[str, int] = {
    "India": 0,
    "United States": 1,
    "United Kingdom": 2,
    "Singapore": 3,
}


def _country_rank(country: str) -> int:
    if country in _COUNTRY_PRIORITY:
        return _COUNTRY_PRIORITY[country]
    return 4 if country in _EUROPE else 5


# Stable sort keeps each country's cities in their CITIES order.
CITIES_ORDERED: tuple[City, ...] = tuple(
    sorted(CITIES, key=lambda c: (_country_rank(c.country), c.country))
)

# name -> (lat, lng), used to stamp coordinates onto stored events.
CITY_LATLNG: dict[str, tuple[float, float]] = {
    c.name: (c.lat, c.lng) for c in CITIES
}


# --- Event taxonomy ---------------------------------------------------------
# Primary tags the UI filters on. Subtypes are free-form strings the LLM fills.
EVENT_TYPES: tuple[str, ...] = (
    "ctf",          # Capture the Flag
    "cfp",          # Call for Papers / Call for Speakers
    "conference",   # security conference
    "training",     # paid/free hands-on training
    "village",      # conference village / hands-on area
    "bugbounty",    # live bug bounty event
    "meetup",       # local chapter meetup (null, OWASP, DC groups)
    "workshop",
)


# --- Seed domains & query templates for discovery ---------------------------
# High-signal sources worth seeding directly. ctftime has a real API (handled
# in sources/ctftime.py); the rest are crawled/searched.
SEED_DOMAINS: tuple[str, ...] = (
    "ctftime.org",
    "c0c0n.org",
    "nullcon.net",
    "seasides.net",
    "bsides.org",
    "blackhat.com",
    "blackhat-india.com",
    "msrc.microsoft.com",
    "44con.com",
    "owasp.org",
    "null.community",
    "infosec-conferences.com",
    "wikicfp.com",
    "papercall.io",
    "sessionize.com",
)

# Query templates expanded over {type} x {city} x {year} for web search.
QUERY_TEMPLATES: tuple[str, ...] = (
    "{type} {city} {year}",
)

# Focused subset of types to web-search (CTFs already come from ctftime's API).
SEARCH_TYPES: tuple[str, ...] = ("conference", "cfp", "meetup")

# Extra per-city queries that name the well-known meetup brands / series and
# alternative phrasings directly — so notable meetups & events surface even when
# generic search ranking buries them. Formatted with {city} and {year}.
EXTRA_QUERY_TEMPLATES: tuple[str, ...] = (
    "OWASP {city}",
    "BSides {city} {year}",
    "DEF CON group {city}",
    "infosec conference {city} {year}",
    "cybersecurity summit {city} {year}",
    "hacking conference {city} {year}",
)

# High-value event/CFP pages always checked directly (fetch -> extract), so the
# big regional cons are covered even if search ranking buries them.
SEED_EVENT_URLS: tuple[str, ...] = (
    # Well-known global orgs / series (recognised conferences, meetups, CTFs).
    "https://www.blackhat.com/upcoming.html",
    "https://defcon.org/",
    "https://www.rsaconference.com/usa",
    "https://owasp.org/events/",
    "https://bsides.org/w/page/12194156/FrontPage",
    "https://msrc.microsoft.com/bluehat",
    "https://www.first.org/conference/",
    "https://www.sans.org/cyber-security-training-events/",
    "https://ctftime.org/event/list/upcoming",
    # Strong regional cons (India / UK / EU).
    "https://c0c0n.org/cfp",
    "https://c0c0n.org/",
    "https://www.blackhat-india.com/call-for-papers",
    "https://nullcon.net/",
    "https://seasides.net/",
    "https://44con.com/",
    "https://www.bsidesldn.uk/",
    "https://troopers.de/",
    "https://def.camp/",
)

# Domains that are never the canonical event page — skip search hits here.
# Social media + low-quality "conference alert" aggregator/spam farms that
# burn extraction quota on out-of-geo or fake listings.
JUNK_DOMAINS: frozenset[str] = frozenset(
    {
        "instagram.com",
        "www.instagram.com",
        "facebook.com",
        "www.facebook.com",
        "twitter.com",
        "x.com",
        "youtube.com",
        "www.youtube.com",
        "linkedin.com",
        "www.linkedin.com",
        "reddit.com",
        "www.reddit.com",
        "t.me",
        "allconferencealert.net",
        "allconferencealert.com",
        "www.allconferencealert.com",
        "conferencealerts.co.in",
        "conferencealerts.com",
        "www.conferencealerts.com",
        "10times.com",
        "www.10times.com",
        "eventbrite.com",  # often resold/duplicate listings; keep canonical sites
    }
)

# Predatory / low-quality academic conference aggregators and paper-mill sites.
# We want working-professional, reputable security events — not university
# research conferences, student-paper venues, or "international conference on..."
# aggregators. These domains are never reputable for our purposes.
BLOCKED_DOMAINS: frozenset[str] = frozenset(
    {
        "iraj.in",
        "www.iraj.in",
        "waset.org",
        "www.waset.org",
        "allinternationalconference.com",
        "www.allinternationalconference.com",
        "conferencealerts.in",
        "www.conferencealerts.in",
        "iemicdc.org",
        "www.iemicdc.org",
        "itresearch.org.in",
        "www.itresearch.org.in",
        "ciaconference.com",
        "www.ciaconference.com",
        "isbtindia.com",
        "wikicfp.com",  # academic CFP aggregator
        "www.wikicfp.com",
    }
)

# Host substrings that indicate an academic / educational institution — events
# hosted on a university/college's own domain are skipped (research conferences,
# student symposia). NOTE: this matches the EVENT's own domain only; a CTF whose
# venue happens to be a campus but lives on its own domain is unaffected.
ACADEMIC_HOST_MARKERS: tuple[str, ...] = (
    ".edu",
    ".edu.in",
    ".edu.au",
    ".ac.in",
    ".ac.uk",
    ".ac.",
    ".university",
)


def is_blocked_or_academic(url: str) -> bool:
    """True if the URL's host is a blocked aggregator or an academic institution."""
    if not url:
        return True
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        return True
    if not host:
        return True
    if host in BLOCKED_DOMAINS or host in JUNK_DOMAINS:
        return True
    return any(m in host for m in ACADEMIC_HOST_MARKERS)

# Human-readable query phrasing per type (used in grounded search prompts).
TYPE_QUERY_TERMS: dict[str, str] = {
    "ctf": "capture the flag CTF",
    "cfp": "security conference call for papers",
    "conference": "cybersecurity conference",
    "training": "security training",
    "village": "security village",
    "bugbounty": "live bug bounty event",
    "meetup": "security meetup",
    "workshop": "security workshop",
}


# --- Runtime settings -------------------------------------------------------
@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.getenv("DATABASE_URL", "sqlite:///securityevents.db")
    )
    # One or more keys (comma-separated GEMINI_API_KEYS, or single GEMINI_API_KEY).
    # Multiple keys multiply free quota via rotation.
    gemini_api_keys: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            k.strip()
            for k in (
                os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_API_KEY") or ""
            ).split(",")
            if k.strip()
        )
    )
    # Ordered model fallback chain. Each model has a SEPARATE free daily quota,
    # so trying cheaper ones first then falling back multiplies coverage.
    gemini_models: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            m.strip()
            for m in os.getenv(
                "GEMINI_MODELS",
                "gemini-2.5-flash-lite,gemini-2.5-flash,gemini-flash-latest",
            ).split(",")
            if m.strip()
        )
    )
    # OpenRouter (OpenAI-compatible). Free models extend daily extraction
    # capacity; tried after Gemini's quota is spent. The LLM only extracts
    # page->JSON; web search is DuckDuckGo (no LLM web search needed).
    openrouter_api_key: str | None = field(
        default_factory=lambda: os.getenv("OPENROUTER_API_KEY") or None
    )
    openrouter_models: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            m.strip()
            for m in os.getenv(
                "OPENROUTER_MODELS",
                # Current free instruct models (verified via the models API).
                "meta-llama/llama-3.3-70b-instruct:free,"
                "qwen/qwen3-next-80b-a3b-instruct:free,"
                "openai/gpt-oss-120b:free,"
                "z-ai/glm-4.5-air:free",
            ).split(",")
            if m.strip()
        )
    )
    lookahead_days: int = field(
        default_factory=lambda: int(os.getenv("LOOKAHEAD_DAYS", "365"))
    )
    hard_purge_after_days: int = field(
        default_factory=lambda: int(os.getenv("HARD_PURGE_AFTER_DAYS", "90"))
    )
    # Discovery / extraction budget (protects the Gemini free-tier RPM/day quota).
    max_search_results: int = field(
        default_factory=lambda: int(os.getenv("MAX_SEARCH_RESULTS", "20"))
    )
    # Safety bound on the candidate POOL per city: the ranked, interleaved
    # top-of-each-query-angle (OWASP / BSides / conference / CFP …) URLs we dig
    # through. Set high enough to hold the FULL DDG result set (~9 queries ×
    # max_search_results), so "dig until target_fresh_per_city survive dedup, or
    # the pool is exhausted" really exhausts everything — not an arbitrary slice.
    max_urls_per_city: int = field(
        default_factory=lambda: int(os.getenv("MAX_URLS_PER_CITY", "200"))
    )
    # Per city, fetch+extract this many FRESH (never-seen / pending / stale)
    # URLs. If the pool above is exhausted before reaching it, we process fewer
    # and move on (dedup-skips are cheap, so digging deeper is fine).
    target_fresh_per_city: int = field(
        default_factory=lambda: int(os.getenv("TARGET_FRESH_PER_CITY", "15"))
    )
    max_search_queries: int = field(
        default_factory=lambda: int(os.getenv("MAX_SEARCH_QUERIES", "60"))
    )
    # Optional hard ceiling on LLM extractions per run. 0 = unlimited (the run is
    # governed by run_max_minutes and/or a full city sweep instead). Kept as a
    # safety valve you can set if you ever want a strict per-run extraction count.
    max_extract_per_run: int = field(
        default_factory=lambda: int(os.getenv("MAX_EXTRACT_PER_RUN", "0"))
    )
    # Wall-clock budget for one run, in minutes. 0 / unset = NO cap — run until a
    # full city sweep completes (local default). GitHub Actions sets this (e.g.
    # 300 = 5h) so the job stops cleanly well under the 6h runner kill limit; the
    # city bookmark is saved so the next scheduled run resumes where it left off.
    run_max_minutes: float = field(
        default_factory=lambda: float(os.getenv("RUN_MAX_MINUTES", "0") or 0)
    )
    extract_throttle_seconds: float = field(
        default_factory=lambda: float(os.getenv("EXTRACT_THROTTLE_SECONDS", "4"))
    )
    # Re-verify an already-processed ('done') URL only after this many days, to
    # refresh dates/deadlines — but only once the never-seen backlog is drained.
    reverify_after_days: int = field(
        default_factory=lambda: int(os.getenv("REVERIFY_AFTER_DAYS", "7"))
    )

    @property
    def gemini_api_key(self) -> str | None:
        """First key — used for standalone probes / back-compat."""
        return self.gemini_api_keys[0] if self.gemini_api_keys else None

    @property
    def gemini_model(self) -> str:
        """First model in the fallback chain — back-compat for probes."""
        return self.gemini_models[0] if self.gemini_models else "gemini-2.5-flash-lite"

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_keys)

    @property
    def openrouter_enabled(self) -> bool:
        return bool(self.openrouter_api_key)

    @property
    def llm_enabled(self) -> bool:
        """Any extraction LLM available (Gemini and/or OpenRouter)."""
        return self.gemini_enabled or self.openrouter_enabled


SETTINGS = Settings()

# HTTP User-Agent — ctftime and others block default/blank agents.
USER_AGENT = (
    "SecurityEventsBot/0.1 (+https://github.com/; daily security-event aggregator)"
)
