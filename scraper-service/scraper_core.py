"""
Scrape logic: Google Maps search -> website enrichment -> categorization.

Website crawler (email/Instagram/summary extraction) reused as-is from the
old CLI scraper.py. Dropped: gspread/Sheets, Ollama DM/email generation,
Instagram profile scraping — none of that belongs in Module 2.

Places search uses Places API (New) directly via httpx (Text Search +
Place Details), not the legacy `googlemaps` client — the legacy API isn't
enabled on the GCP project (only "Places API (New)" was, per Module 0), and
the New API lets us keep costs down with a field mask: Text Search asks for
place IDs only (cheapest tier), Place Details asks for the full field mask
only for candidates that survive the dedup/blocklist check.
"""
from __future__ import annotations

import logging
import random
import re
import time
import urllib.parse
import warnings

import httpx
import requests
from bs4 import BeautifulSoup

log = logging.getLogger("scraper_core")

PAGINATION_DELAY = 2
WEBSITE_DELAY_MIN = 2
WEBSITE_DELAY_MAX = 5
WEBSITE_TIMEOUT = 12

PLACES_API_BASE = "https://places.googleapis.com/v1"

# IDs only for search — cheapest Places API (New) SKU. Full details are
# fetched per-candidate only after dedup/blocklist filtering (see main.py).
SEARCH_FIELD_MASK = "places.id"

DETAILS_FIELD_MASK = (
    "id,displayName,formattedAddress,internationalPhoneNumber,"
    "websiteUri,rating,userRatingCount,businessStatus"
)

CONTACT_PAGE_PATHS = [
    "/contact", "/contact-us", "/contact_us", "/contactus",
    "/about", "/about-us", "/about_us",
    "/get-in-touch", "/reach-us", "/enquire",
]

CONTACT_LINK_HINTS = ("contact", "about", "reach", "get in touch", "enquir", "connect")

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

EMAIL_BLOCKLIST = re.compile(
    r"(noreply|no-reply|donotreply|example|sentry|wixpress|"
    r"squarespace|shopify|wordpress|@\d)",
    re.IGNORECASE,
)

INSTAGRAM_RE = re.compile(
    r"instagram\.com/(?!p/|reel/|stories/|explore/|tv/|ar/|accounts/|_/)"
    r"([a-zA-Z0-9._]{1,30})/?",
    re.IGNORECASE,
)

SCRAPER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
}


# ---------- Google Places API (New) ----------

def text_search(api_key: str, query: str) -> list[str]:
    """Returns matching place IDs. Uses the IDs-only field mask (cheapest)."""
    place_ids: list[str] = []
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    }
    body: dict = {"textQuery": query, "regionCode": "AU"}

    with httpx.Client(timeout=WEBSITE_TIMEOUT) as client:
        while True:
            try:
                resp = client.post(f"{PLACES_API_BASE}/places:searchText", json=body, headers=headers)
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                log.error("Places Text Search failed for '%s': %s — %s", query, exc, exc.response.text)
                break
            except httpx.HTTPError as exc:
                log.error("Places Text Search failed for '%s': %s", query, exc)
                break

            data = resp.json()
            place_ids.extend(p["id"] for p in data.get("places", []) if p.get("id"))

            token = data.get("nextPageToken")
            if not token:
                break
            time.sleep(PAGINATION_DELAY)
            body = {"textQuery": query, "regionCode": "AU", "pageToken": token}

    return place_ids


def get_place_details(api_key: str, place_id: str) -> dict:
    headers = {"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": DETAILS_FIELD_MASK}
    try:
        resp = httpx.get(f"{PLACES_API_BASE}/places/{place_id}", headers=headers, timeout=WEBSITE_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        log.warning("Place Details failed for %s: %s — %s", place_id, exc, exc.response.text)
        return {}
    except httpx.HTTPError as exc:
        log.warning("Place Details failed for %s: %s", place_id, exc)
        return {}


# ---------- Categorization (v2 — see CLAUDE.md Domain rules) ----------

def categorize(rating: float | None, review_count: int | None) -> tuple[str, bool]:
    """Returns (category, is_new_venue). Website is NOT a factor."""
    rating = rating or 0.0
    review_count = review_count or 0

    if rating >= 4.5 and review_count > 200:
        category = "High"
    elif (4.0 <= rating < 4.5) or (100 <= review_count <= 200):
        category = "Medium"
    else:
        category = "Low"

    is_new_venue = rating >= 4.5 and 10 <= review_count <= 100
    return category, is_new_venue


# ---------- Website crawler ----------

def fetch_page(url: str, session: requests.Session) -> BeautifulSoup | None:
    try:
        resp = session.get(url, timeout=WEBSITE_TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
        if "text/html" not in resp.headers.get("Content-Type", ""):
            return None
        return BeautifulSoup(resp.text, "html.parser")
    except requests.exceptions.SSLError:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                resp = session.get(url, timeout=WEBSITE_TIMEOUT, allow_redirects=True, verify=False)
                resp.raise_for_status()
                return BeautifulSoup(resp.text, "html.parser")
        except Exception:
            return None
    except Exception:
        return None


def extract_emails(soup: BeautifulSoup) -> list[str]:
    found, seen = [], set()
    for tag in soup.find_all("a", href=True):
        href = tag["href"]
        if href.lower().startswith("mailto:"):
            addr = href[7:].split("?")[0].strip().lower()
            if addr and addr not in seen and not EMAIL_BLOCKLIST.search(addr):
                found.append(addr)
                seen.add(addr)
    for addr in EMAIL_RE.findall(soup.get_text(" ")):
        addr = addr.lower()
        if addr not in seen and not EMAIL_BLOCKLIST.search(addr):
            found.append(addr)
            seen.add(addr)
    return found


def extract_instagram(soup: BeautifulSoup) -> str:
    for tag in soup.find_all("a", href=True):
        m = INSTAGRAM_RE.search(tag["href"])
        if m and m.group(1).lower() not in ("instagram", "www"):
            return f"https://www.instagram.com/{m.group(1)}/"
    m = INSTAGRAM_RE.search(soup.get_text(" "))
    if m and m.group(1).lower() not in ("instagram", "www"):
        return f"https://www.instagram.com/{m.group(1)}/"
    return ""


def extract_website_summary(soup: BeautifulSoup) -> str:
    for attr in [{"name": "description"}, {"property": "og:description"}]:
        tag = soup.find("meta", attr)
        if tag and tag.get("content"):
            return tag["content"].strip()[:300]
    for p in soup.find_all("p"):
        text = p.get_text(" ").strip()
        if len(text) > 50:
            return text[:300]
    return ""


def find_contact_links(soup: BeautifulSoup, base_url: str) -> list[str]:
    candidates, seen = [], set()
    base_netloc = urllib.parse.urlparse(base_url).netloc
    for tag in soup.find_all("a", href=True):
        combined = (tag["href"] + " " + tag.get_text(" ")).lower()
        if any(hint in combined for hint in CONTACT_LINK_HINTS):
            abs_url = urllib.parse.urljoin(base_url, tag["href"].strip())
            parsed = urllib.parse.urlparse(abs_url)
            if (
                parsed.scheme in ("http", "https")
                and parsed.netloc == base_netloc
                and abs_url not in seen
            ):
                candidates.append(abs_url)
                seen.add(abs_url)
    return candidates


def scrape_website(website_url: str, session: requests.Session) -> tuple[str, str, str]:
    """Returns (email, instagram_url, website_summary)."""
    if not website_url.startswith(("http://", "https://")):
        website_url = "https://" + website_url

    soup = fetch_page(website_url, session)
    if soup is None:
        return "", "", ""

    email = next(iter(extract_emails(soup)), "")
    instagram = extract_instagram(soup)
    summary = extract_website_summary(soup)

    if email and instagram:
        return email, instagram, summary

    for link in find_contact_links(soup, website_url)[:3]:
        time.sleep(random.uniform(WEBSITE_DELAY_MIN, WEBSITE_DELAY_MAX))
        page = fetch_page(link, session)
        if page is None:
            continue
        if not email:
            email = next(iter(extract_emails(page)), "")
        if not instagram:
            instagram = extract_instagram(page)
        if email and instagram:
            return email, instagram, summary

    parsed = urllib.parse.urlparse(website_url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    for path in CONTACT_PAGE_PATHS:
        if email and instagram:
            break
        time.sleep(random.uniform(WEBSITE_DELAY_MIN, WEBSITE_DELAY_MAX))
        page = fetch_page(base + path, session)
        if page is None:
            continue
        if not email:
            email = next(iter(extract_emails(page)), "")
        if not instagram:
            instagram = extract_instagram(page)

    return email, instagram, summary
