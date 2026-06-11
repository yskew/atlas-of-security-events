"""Fetch ladder. Direct HTTP is unreliable for these sites (anti-bot 403s,
JS single-page apps), so we fall back through progressively heavier methods.

  1. Direct fetch (httpx)            — cheap, works for plain HTML
  2. Jina Reader (r.jina.ai, free)   — renders JS pages to clean markdown, no key

Playwright is a planned 3rd rung for the hardest SPAs; omitted from the MVP to
keep dependencies light. Gemini-with-search-grounding (in extract.py) is the
other path that sidesteps blocked sites entirely via Google's index.
"""
from __future__ import annotations

import logging

import httpx

from .config import USER_AGENT

log = logging.getLogger(__name__)

# A page is "too thin" if the body has almost no text — usually a JS shell.
_MIN_USEFUL_CHARS = 500


def _looks_thin(text: str) -> bool:
    return len(text.strip()) < _MIN_USEFUL_CHARS


def _direct(url: str, timeout: float) -> str | None:
    try:
        resp = httpx.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"},
            timeout=timeout,
            follow_redirects=True,
        )
        if resp.status_code == 200 and not _looks_thin(resp.text):
            return resp.text
        log.debug("direct fetch unusable (%s) for %s", resp.status_code, url)
    except Exception as exc:
        log.debug("direct fetch error for %s: %s", url, exc)
    return None


def _jina(url: str, timeout: float) -> str | None:
    """Free reader proxy that renders JS and returns markdown. No API key."""
    try:
        resp = httpx.get(
            f"https://r.jina.ai/{url}",
            headers={"User-Agent": USER_AGENT},
            timeout=timeout,
            follow_redirects=True,
        )
        if resp.status_code == 200 and not _looks_thin(resp.text):
            return resp.text
        log.debug("jina fetch unusable (%s) for %s", resp.status_code, url)
    except Exception as exc:
        log.debug("jina fetch error for %s: %s", url, exc)
    return None


def fetch(url: str, timeout: float = 30.0) -> str | None:
    """Return usable page content via the first ladder rung that works."""
    return _direct(url, timeout) or _jina(url, timeout)
