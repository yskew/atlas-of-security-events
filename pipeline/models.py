"""Pydantic schemas for events.

`ExtractedEvent` is the structured shape every source (ctftime, Gemini
extraction, future scrapers) must produce. Grounding rule: every populated
field should trace to fetched text + a source URL, and any unknown field stays
None rather than being invented.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date

from pydantic import BaseModel, Field, field_validator

from .config import CITIES, EVENT_TYPES, is_blocked_or_academic

_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _norm(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace — for fingerprinting."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()


class ExtractedEvent(BaseModel):
    """One discovered opportunity. Mirrors the LLM extraction schema."""

    name: str
    event_type: str = Field(description=f"one of {EVENT_TYPES}")
    subtype: str | None = Field(
        default=None,
        description="e.g. CFP: 'academic-paper'|'call-for-speakers'|'workshop'; "
        "CTF: 'jeopardy'|'attack-defense'|'onsite'|'online'|'beginner'",
    )

    country: str | None = None
    city: str | None = None
    venue: str | None = None
    is_online: bool = False

    # Graded relevance, not binary — Devcon-style adjacent events are kept but flagged.
    dedicated_security: bool = Field(
        default=True,
        description="True for pure-security events; False for security-adjacent "
        "(e.g. a blockchain conf with a security track).",
    )

    # Audience gate: we want working-professional / industry events, not academic
    # research conferences or student/youth programs.
    audience: str | None = Field(
        default=None,
        description="'professional' (industry practitioners), 'academic' "
        "(university research / paper-presentation conference), 'student' "
        "(student/youth focused), or 'mixed'.",
    )

    # Quality gate: is this a recognised / well-known event worth surfacing?
    notable: bool = Field(
        default=True,
        description="True if run by a recognised org or part of an established "
        "series/community (e.g. Black Hat, DEF CON, RSA, OWASP, BSides, BlueHat, "
        "c0c0n, nullcon, a known CTF). False for obscure one-offs, brand-new "
        "unproven events, tiny local gatherings, or low-signal listings.",
    )

    # Dates. An event is a container of opportunities, so several may be set.
    event_start: date | None = None
    event_end: date | None = None
    cfp_opens: date | None = None
    cfp_closes: date | None = None
    cfp_notify: date | None = None

    description: str = Field(
        default="",
        description="Plain-English: what this is, who it's for, can you apply. 1-3 sentences.",
    )
    topics: list[str] = Field(default_factory=list)

    primary_url: str = Field(description="canonical event URL — required for trust")
    registration_url: str | None = None

    confidence: float = Field(default=0.7, ge=0.0, le=1.0)
    source: str = Field(default="unknown", description="ctftime|gemini|seed|...")

    @field_validator("event_type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        v = (v or "").strip().lower()
        return v if v in EVENT_TYPES else "conference"

    # --- lenient coercion: LLMs return loose types; salvage rather than reject ---
    @field_validator(
        "event_start", "event_end", "cfp_opens", "cfp_closes", "cfp_notify",
        mode="before",
    )
    @classmethod
    def _coerce_date(cls, v):
        """Accept 'YYYY-MM-DD' (possibly embedded); anything else -> None."""
        if v is None or isinstance(v, date):
            return v
        m = _DATE_RE.search(str(v))
        return m.group(0) if m else None

    @field_validator("is_online", mode="before")
    @classmethod
    def _coerce_online(cls, v):
        if isinstance(v, bool):
            return v
        if v is None:
            return False
        return str(v).strip().lower() in {"true", "1", "yes", "online", "virtual"}

    @field_validator("dedicated_security", "notable", mode="before")
    @classmethod
    def _coerce_dedicated(cls, v):
        if isinstance(v, bool):
            return v
        if v is None:
            return True  # assume dedicated/notable unless explicitly told otherwise
        return str(v).strip().lower() not in {"false", "0", "no"}

    @field_validator("topics", mode="before")
    @classmethod
    def _coerce_topics(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            return [t.strip() for t in re.split(r"[;,]", v) if t.strip()]
        if isinstance(v, list):
            return [str(t).strip() for t in v if str(t).strip()]
        return []

    @field_validator(
        "subtype", "city", "country", "venue", "registration_url", "audience",
        mode="before",
    )
    @classmethod
    def _coerce_optstr(cls, v):
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    @field_validator("description", "name", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return "" if v is None else str(v).strip()

    # --- derived helpers ----------------------------------------------------
    def actionable_deadline(self) -> date | None:
        """The date after which a user can no longer act, used for expiry.

        CFP-type → the submission close date. Everything else → when the event
        itself ends (or starts, if no end is known).
        """
        if self.event_type == "cfp":
            return self.cfp_closes or self.cfp_notify or self.event_end or self.event_start
        return self.event_end or self.event_start or self.cfp_closes

    def from_reputable_source(self) -> bool:
        """False if the event's own URL is a predatory aggregator or academic site."""
        return not is_blocked_or_academic(self.primary_url)

    def is_professional(self) -> bool:
        """Keep professional/mixed/unknown; drop academic and student events.

        CTFs are competitions, not academic conferences, so they pass regardless
        of audience labelling (the user explicitly wants CTFs)."""
        if self.event_type == "ctf":
            return True
        aud = (self.audience or "").strip().lower()
        return aud not in {"academic", "student"}

    def fingerprint(self) -> str:
        """Stable dedup key: normalized name + city + start-month bucket."""
        anchor = self.event_start or self.cfp_closes
        bucket = anchor.strftime("%Y-%m") if anchor else "nodate"
        city = _norm(self.city or "")
        raw = f"{_norm(self.name)}|{city}|{bucket}"
        return hashlib.sha1(raw.encode()).hexdigest()

    def _match_city(self):
        """Return the configured City this event's location maps to, or None."""
        hay = " ".join(
            _norm(x) for x in (self.city or "", self.country or "", self.venue or "")
        )
        if not hay.strip():
            return None
        for c in CITIES:
            needles = (_norm(c.name), *(_norm(a) for a in c.aliases))
            if any(n and n in hay for n in needles):
                return c
        return None

    def matches_target_geo(self) -> bool:
        """True if the event's location maps to a configured city/country."""
        return self._match_city() is not None

    def resolve_geo(self) -> "ExtractedEvent":
        """Backfill canonical city + country from the matched config city.

        ctftime and search hits give messy free-text locations ("Bengaluru,
        India"); this normalizes them so the DB/UI can group cleanly.
        """
        c = self._match_city()
        if c is not None:
            self.city = c.name
            self.country = c.country
        return self
