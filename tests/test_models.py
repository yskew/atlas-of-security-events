"""Unit tests for ExtractedEvent: lenient coercion, geo, deadlines, gating."""
from datetime import date

from pipeline.models import ExtractedEvent


def mk(**kw) -> ExtractedEvent:
    base = dict(
        name="X", event_type="conference", description="d",
        primary_url="https://example.com/x",
    )
    base.update(kw)
    return ExtractedEvent(**base)


# --- lenient coercion (LLMs return loose types) -----------------------------
def test_date_coercion():
    assert mk(cfp_closes="2026-05-10").cfp_closes == date(2026, 5, 10)
    assert mk(cfp_closes="closes 2026-05-10 midnight").cfp_closes == date(2026, 5, 10)
    assert mk(cfp_closes="TBD").cfp_closes is None
    assert mk(cfp_closes="2026").cfp_closes is None
    assert mk(cfp_closes=None).cfp_closes is None


def test_bool_coercion():
    assert mk(is_online="yes").is_online is True
    assert mk(is_online="virtual").is_online is True
    assert mk(is_online=None).is_online is False
    # dedicated_security: null means "assume dedicated"
    assert mk(dedicated_security=None).dedicated_security is True
    assert mk(dedicated_security="false").dedicated_security is False


def test_topics_coercion():
    assert mk(topics=None).topics == []
    assert mk(topics="ctf, web, pwn").topics == ["ctf", "web", "pwn"]
    assert mk(topics=["a", " b "]).topics == ["a", "b"]


def test_event_type_normalization():
    assert mk(event_type="totally-unknown").event_type == "conference"
    assert mk(event_type="CTF").event_type == "ctf"


# --- geography --------------------------------------------------------------
def test_geo_match_and_resolve():
    e = mk(city="Bengaluru", country="India").resolve_geo()
    assert e.matches_target_geo()
    assert e.city == "Bangalore" and e.country == "India"  # canonicalised
    assert not mk(city="Paris", country="France").matches_target_geo()


# --- deadlines --------------------------------------------------------------
def test_actionable_deadline():
    cfp = mk(event_type="cfp", cfp_closes=date(2026, 5, 1), event_end=date(2026, 10, 1))
    assert cfp.actionable_deadline() == date(2026, 5, 1)        # CFP -> close date
    conf = mk(event_type="conference", event_end=date(2026, 10, 1))
    assert conf.actionable_deadline() == date(2026, 10, 1)      # else -> event end


# --- reputability / audience gates ------------------------------------------
def test_is_professional():
    assert mk(audience="professional").is_professional()
    assert mk(audience=None).is_professional()                  # unknown -> keep
    assert not mk(audience="academic").is_professional()
    assert not mk(audience="student").is_professional()
    # CTFs are exempt even if labelled academic (campus-hosted competitions)
    assert mk(event_type="ctf", audience="academic").is_professional()


def test_from_reputable_source():
    assert mk(primary_url="https://c0c0n.org/").from_reputable_source()
    assert not mk(primary_url="https://iraj.in/Conference/1/X/").from_reputable_source()
    assert not mk(primary_url="https://x.msit.edu.in/").from_reputable_source()
    assert not mk(primary_url="https://y.ac.uk/cfp").from_reputable_source()


def test_fingerprint_stability():
    a = mk(name="BSides London 2026", city="London", event_start=date(2026, 3, 1))
    b = mk(name="BSides London 2026", city="London", event_start=date(2026, 3, 15))
    assert a.fingerprint() == b.fingerprint()  # same name+city+month bucket
