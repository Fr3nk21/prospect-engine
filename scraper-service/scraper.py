"""
Google Maps → Google Sheets scraper — v2 (UnFocus Edition)
──────────────────────────────────────────────────────────
Upgrades over v1:
  • Fixed venue type categories (Restaurant, Fine Dining, Italian, etc.)
  • Instagram profile analysis (bio, name, post style)
  • AI-generated personalised DM and email for each venue via Ollama
  • Two new columns: DM Instagram / Email Bozza

Target location and venue types are configured via SEARCH_LOCATION and
VENUE_TYPES in your .env file.
"""

import json
import logging
import os
import random
import re
import time
import urllib.parse
import warnings
from datetime import datetime

import googlemaps
import gspread
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

# ──────────────────────────────────────────────────
# LOGGING
# ──────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ──────────────────────────────────────────────────
# ENVIRONMENT
# ──────────────────────────────────────────────────

load_dotenv()

MAPS_API_KEY         = os.getenv("MAPS_API_KEY", "")
SPREADSHEET_NAME     = os.getenv("SPREADSHEET_NAME", "Melbourne Venues")
SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "service_account.json")
SEARCH_LOCATION      = os.getenv("SEARCH_LOCATION", "").strip()
OLLAMA_URL           = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL         = os.getenv("OLLAMA_MODEL", "qwen-longctx")

if not MAPS_API_KEY:
    raise EnvironmentError("MAPS_API_KEY is not set. Add it to your .env file.")
if not SEARCH_LOCATION:
    raise EnvironmentError("SEARCH_LOCATION is not set. Add it to your .env file.")

# ──────────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────────

SUBURB         = SEARCH_LOCATION
WORKSHEET_NAME = SEARCH_LOCATION.split(",")[0].strip()

# Fixed venue categories for UnFocus
SEARCH_QUERIES = [
    "restaurant",
    "fine dining restaurant",
    "italian restaurant",
    "mediterranean restaurant",
    "pizza restaurant",
    "cafe",
    "coffee shop",
    "cocktail bar",
    "wine bar",
    "bakery",
]

PAGINATION_DELAY   = 2
WEBSITE_DELAY_MIN  = 2
WEBSITE_DELAY_MAX  = 5
WEBSITE_TIMEOUT    = 12

# ──────────────────────────────────────────────────
# SHEET SCHEMA — two new columns added
# ──────────────────────────────────────────────────

SHEET_HEADERS = [
    "Venue",              # 0
    "Indirizzo",          # 1
    "Area",               # 2
    "Telefono",           # 3
    "Sito Web",           # 4
    "Email",              # 5
    "Instagram",          # 6
    "Qualità Instagram",  # 7  ← manual dropdown (filled by user)
    "Rating",             # 8
    "N° Recensioni",      # 9
    "Tipo Attività",      # 10
    "Categoria",          # 11
    "DM Instagram",       # 12
    "Email Bozza",        # 13
    "Stato Contatto",     # 14
    "Data Contatto",      # 15
    "Aggiornato",         # 16
]

QUALITA_INSTAGRAM_OPTIONS = [
    "⭐ Top",
    "✅ Buono",
    "👀 Da valutare",
    "❌ Scarso",
]

STATO_OPTIONS = [
    "Contattato",
    "Contattato ma non risposto",
    "Contattato e non interessato",
]

STATO_COLORS = {
    "Contattato":                   "#B7E1CD",
    "Contattato ma non risposto":   "#FCE8B2",
    "Contattato e non interessato": "#F4C7C3",
}

CATEGORIA_COLORS = {
    "Alta":  {"bg": "#1E8449", "fg": "#FFFFFF"},
    "Media": {"bg": "#F39C12", "fg": "#FFFFFF"},
    "Bassa": {"bg": "#E74C3C", "fg": "#FFFFFF"},
}

PLACES_DETAIL_FIELDS = [
    "place_id",
    "name",
    "formatted_address",
    "formatted_phone_number",
    "website",
    "rating",
    "user_ratings_total",
    "url",
]

# ──────────────────────────────────────────────────
# WEBSITE CRAWLER CONSTANTS
# ──────────────────────────────────────────────────

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

# ──────────────────────────────────────────────────
# VENUE CATEGORISATION
# ──────────────────────────────────────────────────

def categorize_venue(rating, has_instagram: bool, has_email: bool, has_website: bool) -> str:
    """
    Alta  — has Instagram AND has email AND has website AND rating >= 4.3
    Media — has Instagram AND has website (email not required)
    Bassa — does not have Instagram OR does not have website
    """
    try:
        rating = float(rating)
    except (TypeError, ValueError):
        rating = 0.0
    if has_instagram and has_email and has_website and rating >= 4.3:
        return "Alta"
    if has_instagram and has_website:
        return "Media"
    return "Bassa"

# ──────────────────────────────────────────────────
# OLLAMA — AI TEXT GENERATION
# ──────────────────────────────────────────────────

def call_ollama(prompt: str, max_tokens: int = 400) -> str:
    """
    Call local Ollama model and return the generated text.
    Returns empty string on any error.
    """
    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model":  OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": max_tokens, "temperature": 0.7},
            },
            timeout=120,
        )
        response.raise_for_status()
        return response.json().get("response", "").strip()
    except Exception as exc:
        log.warning("Ollama call failed: %s", exc)
        return ""


def generate_dm(
    venue_name: str,
    venue_type: str,
    instagram_handle: str,
    instagram_bio: str,
    website_summary: str,
    rating: float,
    area: str,
) -> str:
    """Generate a short, human, conversation-opening Instagram DM."""
    context_parts = []
    if instagram_bio:
        context_parts.append(f"Instagram bio: {instagram_bio}")
    if website_summary:
        context_parts.append(f"What their website says: {website_summary}")
    context = "\n".join(context_parts) if context_parts else "No additional info available."

    prompt = f"""You are Francesco, a Melbourne-based videographer. You shoot content for hospitality venues — short films, social media videos, atmosphere reels. You're reaching out to places you genuinely find interesting, not mass-spamming.

Write a SHORT Instagram DM to this venue. The goal is to start a real conversation, not to pitch.

VENUE INFO:
- Name: {venue_name}
- Type: {venue_type}
- Area: {area}, Melbourne
- Instagram: @{instagram_handle if instagram_handle else "unknown"}
- Context: {context}

STRICT RULES:
- Maximum 4 sentences. No exceptions.
- First sentence: one genuine, specific observation about this place. Not "I love your content" — something real based on what you know about them.
- Middle: one natural, low-pressure sentence about what you do. Don't use the word "services".
- Last sentence: an open question that invites a response. Not "would you be interested?" — something more curious and human.
- No bullet points, no formatting, no subject line.
- No exclamation marks. No emojis.
- Do NOT mention prices, packages, or ROI.
- Write as if you're a real person, not a marketing email.
- Output only the DM text. Nothing else."""

    return call_ollama(prompt, max_tokens=150)


def generate_email(
    venue_name: str,
    venue_type: str,
    email_address: str,
    instagram_handle: str,
    instagram_bio: str,
    website_summary: str,
    rating: float,
    area: str,
) -> str:
    """Generate a short, human outreach email that opens a conversation."""
    context_parts = []
    if instagram_bio:
        context_parts.append(f"Instagram bio: {instagram_bio}")
    if website_summary:
        context_parts.append(f"Website description: {website_summary}")
    context = "\n".join(context_parts) if context_parts else "No additional info available."

    prompt = f"""You are Francesco, a Melbourne-based videographer who shoots for hospitality venues. You're writing a cold email to a place you've genuinely noticed and want to work with.

Write a SHORT, human outreach email. The goal is to feel like it was written by a real person who actually looked at their place — not a template blast.

VENUE INFO:
- Name: {venue_name}
- Type: {venue_type}
- Area: {area}, Melbourne
- Instagram: @{instagram_handle if instagram_handle else "unknown"}
- Context: {context}

STRICT RULES:
- Subject line first, format: "Subject: ..."
- Body: maximum 5 sentences total.
- Sentence 1: specific, genuine opener about this venue. Show you actually looked at them.
- Sentence 2-3: naturally mention what you do and one concrete thing you could create for a place like this. No jargon, no list of services.
- Sentence 4: soft, human close — not "let me know if you're interested". Something like a natural next step.
- Signature: Francesco / unfocus.com.au
- No bullet points. No bold text. No formal language.
- No prices. No "I help businesses like yours". No "I came across your profile".
- Write like a real person who wants to work with this specific place.
- Output only the email. Nothing else."""

    return call_ollama(prompt, max_tokens=200)


# ──────────────────────────────────────────────────
# INSTAGRAM PROFILE SCRAPER
# ──────────────────────────────────────────────────

def scrape_instagram_profile(instagram_url: str, session: requests.Session) -> dict:
    """
    Visit an Instagram profile page and extract basic public info.
    Returns dict with keys: handle, bio, full_name
    Instagram heavily restricts scraping — we extract what's in the HTML meta tags.
    """
    result = {"handle": "", "bio": "", "full_name": ""}
    if not instagram_url:
        return result

    try:
        # Extract handle from URL
        m = INSTAGRAM_RE.search(instagram_url)
        if m:
            result["handle"] = m.group(1)

        resp = session.get(instagram_url, timeout=WEBSITE_TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # Instagram puts profile info in meta tags
        desc_tag = soup.find("meta", {"name": "description"})
        if desc_tag and desc_tag.get("content"):
            result["bio"] = desc_tag["content"][:300]

        title_tag = soup.find("meta", {"property": "og:title"})
        if title_tag and title_tag.get("content"):
            result["full_name"] = title_tag["content"][:100]

    except Exception as exc:
        log.debug("Instagram scrape failed for %s: %s", instagram_url, exc)

    return result


# ──────────────────────────────────────────────────
# WEBSITE SUMMARY EXTRACTOR
# ──────────────────────────────────────────────────

def extract_website_summary(soup: BeautifulSoup) -> str:
    """
    Extract a short summary of what a venue does from its website.
    Looks at meta description, og:description, and first visible paragraph.
    """
    if not soup:
        return ""

    # Try meta description first
    for attr in [{"name": "description"}, {"property": "og:description"}]:
        tag = soup.find("meta", attr)
        if tag and tag.get("content"):
            return tag["content"].strip()[:300]

    # Fall back to first non-trivial paragraph
    for p in soup.find_all("p"):
        text = p.get_text(" ").strip()
        if len(text) > 50:
            return text[:300]

    return ""


# ──────────────────────────────────────────────────
# GOOGLE MAPS HELPERS
# ──────────────────────────────────────────────────

def build_gmaps_client() -> googlemaps.Client:
    return googlemaps.Client(key=MAPS_API_KEY)


def text_search(gmaps: googlemaps.Client, query: str) -> list:
    results = []
    try:
        response = gmaps.places(query=query, region="au")
    except Exception as exc:
        log.error("Places Text Search failed for '%s': %s", query, exc)
        return results

    while True:
        batch = response.get("results", [])
        results.extend(batch)
        log.info("    %d results (running total: %d)", len(batch), len(results))

        token = response.get("next_page_token")
        if not token:
            break
        time.sleep(PAGINATION_DELAY)
        try:
            response = gmaps.places(query=query, region="au", page_token=token)
        except Exception as exc:
            log.warning("Pagination error for '%s': %s", query, exc)
            break

    return results


def get_place_details(gmaps: googlemaps.Client, place_id: str) -> dict:
    try:
        response = gmaps.place(place_id=place_id, fields=PLACES_DETAIL_FIELDS)
        return response.get("result", {})
    except Exception as exc:
        log.warning("Place Details failed for %s: %s", place_id, exc)
        return {}


# ──────────────────────────────────────────────────
# WEBSITE CRAWLER
# ──────────────────────────────────────────────────

def fetch_page(url: str, session: requests.Session):
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


def extract_emails(soup: BeautifulSoup) -> list:
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


def find_contact_links(soup: BeautifulSoup, base_url: str) -> list:
    candidates, seen = [], set()
    base_netloc = urllib.parse.urlparse(base_url).netloc
    for tag in soup.find_all("a", href=True):
        combined = (tag["href"] + " " + tag.get_text(" ")).lower()
        if any(hint in combined for hint in CONTACT_LINK_HINTS):
            abs_url = urllib.parse.urljoin(base_url, tag["href"].strip())
            parsed  = urllib.parse.urlparse(abs_url)
            if (
                parsed.scheme in ("http", "https")
                and parsed.netloc == base_netloc
                and abs_url not in seen
            ):
                candidates.append(abs_url)
                seen.add(abs_url)
    return candidates


def scrape_website(website_url: str, session: requests.Session) -> tuple:
    """
    Returns (email, instagram_url, website_summary).
    """
    if not website_url.startswith(("http://", "https://")):
        website_url = "https://" + website_url

    email, instagram, summary = "", "", ""

    soup = fetch_page(website_url, session)
    if soup is None:
        return "", "", ""

    emails = extract_emails(soup)
    if emails:
        email = emails[0]
    instagram = extract_instagram(soup)
    summary   = extract_website_summary(soup)

    if email and instagram:
        return email, instagram, summary

    for link in find_contact_links(soup, website_url)[:3]:
        time.sleep(random.uniform(WEBSITE_DELAY_MIN, WEBSITE_DELAY_MAX))
        page = fetch_page(link, session)
        if page is None:
            continue
        if not email:
            found = extract_emails(page)
            if found:
                email = found[0]
        if not instagram:
            instagram = extract_instagram(page)
        if email and instagram:
            return email, instagram, summary

    parsed = urllib.parse.urlparse(website_url)
    base   = f"{parsed.scheme}://{parsed.netloc}"
    for path in CONTACT_PAGE_PATHS:
        if email and instagram:
            break
        time.sleep(random.uniform(WEBSITE_DELAY_MIN, WEBSITE_DELAY_MAX))
        page = fetch_page(base + path, session)
        if page is None:
            continue
        if not email:
            found = extract_emails(page)
            if found:
                email = found[0]
        if not instagram:
            instagram = extract_instagram(page)

    return email, instagram, summary


# ──────────────────────────────────────────────────
# GOOGLE SHEETS HELPERS (unchanged from v1)
# ──────────────────────────────────────────────────

def connect_to_sheet(spreadsheet_name: str, worksheet_name: str):
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/script.projects",
    ]
    creds        = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    client       = gspread.authorize(creds)
    spreadsheet  = client.open(spreadsheet_name)
    try:
        ws = spreadsheet.worksheet(worksheet_name)
        log.info("Found existing worksheet '%s'.", worksheet_name)
    except gspread.exceptions.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=worksheet_name, rows=2000, cols=len(SHEET_HEADERS))
        log.info("Created new worksheet '%s'.", worksheet_name)
    return ws, creds


def apply_stato_dropdown(worksheet) -> None:
    col = SHEET_HEADERS.index("Stato Contatto")
    worksheet.spreadsheet.batch_update({"requests": [{"setDataValidation": {
        "range": {"sheetId": worksheet.id, "startRowIndex": 1, "endRowIndex": 2001,
                  "startColumnIndex": col, "endColumnIndex": col + 1},
        "rule": {"condition": {"type": "ONE_OF_LIST",
                               "values": [{"userEnteredValue": opt} for opt in STATO_OPTIONS]},
                 "showCustomUi": True, "strict": False}
    }}]})


def apply_qualita_instagram_dropdown(worksheet) -> None:
    col = SHEET_HEADERS.index("Qualità Instagram")
    worksheet.spreadsheet.batch_update({"requests": [{"setDataValidation": {
        "range": {"sheetId": worksheet.id, "startRowIndex": 1, "endRowIndex": 2001,
                  "startColumnIndex": col, "endColumnIndex": col + 1},
        "rule": {"condition": {"type": "ONE_OF_LIST",
                               "values": [{"userEnteredValue": opt} for opt in QUALITA_INSTAGRAM_OPTIONS]},
                 "showCustomUi": True, "strict": False}
    }}]})


def apply_data_contatto_format(worksheet) -> None:
    col        = SHEET_HEADERS.index("Data Contatto")
    cell_range = {"sheetId": worksheet.id, "startRowIndex": 1, "endRowIndex": 2001,
                  "startColumnIndex": col, "endColumnIndex": col + 1}
    worksheet.spreadsheet.batch_update({"requests": [
        {"repeatCell": {"range": cell_range,
                        "cell": {"userEnteredFormat": {"numberFormat": {"type": "DATE", "pattern": "DD/MM/YYYY"}}},
                        "fields": "userEnteredFormat.numberFormat"}},
        {"setDataValidation": {"range": cell_range,
                               "rule": {"condition": {"type": "DATE_IS_VALID"},
                                        "inputMessage": "Inserisci una data in formato DD/MM/YYYY",
                                        "showCustomUi": False, "strict": False}}}
    ]})


def apply_conditional_formatting(worksheet) -> None:
    spreadsheet = worksheet.spreadsheet
    sheet_id    = worksheet.id
    stato_col   = SHEET_HEADERS.index("Stato Contatto")
    col_letter  = chr(ord("A") + stato_col)
    total_cols  = len(SHEET_HEADERS)

    for _ in range(50):
        try:
            spreadsheet.batch_update({"requests": [{"deleteConditionalFormatRule": {"sheetId": sheet_id, "index": 0}}]})
        except Exception:
            break

    def hex_to_rgb(h):
        h = h.lstrip("#")
        return {"red": round(int(h[0:2], 16)/255, 4), "green": round(int(h[2:4], 16)/255, 4), "blue": round(int(h[4:6], 16)/255, 4)}

    data_range = {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2001, "startColumnIndex": 0, "endColumnIndex": total_cols}
    spreadsheet.batch_update({"requests": [
        {"addConditionalFormatRule": {"index": 0, "rule": {"ranges": [data_range], "booleanRule": {
            "condition": {"type": "CUSTOM_FORMULA", "values": [{"userEnteredValue": f'=${col_letter}2="{label}"'}]},
            "format": {"backgroundColor": hex_to_rgb(color)}}}}}
        for label, color in STATO_COLORS.items()
    ]})


def apply_categoria_formatting(worksheet) -> None:
    spreadsheet = worksheet.spreadsheet
    sheet_id    = worksheet.id
    cat_col     = SHEET_HEADERS.index("Categoria")

    def hex_to_rgb(h):
        h = h.lstrip("#")
        return {"red": round(int(h[0:2], 16)/255, 4), "green": round(int(h[2:4], 16)/255, 4), "blue": round(int(h[4:6], 16)/255, 4)}

    col_range = {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2001, "startColumnIndex": cat_col, "endColumnIndex": cat_col + 1}
    spreadsheet.batch_update({"requests": [
        {"addConditionalFormatRule": {"index": 0, "rule": {"ranges": [col_range], "booleanRule": {
            "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": label}]},
            "format": {"backgroundColor": hex_to_rgb(colors["bg"]), "textFormat": {"foregroundColor": hex_to_rgb(colors["fg"]), "bold": True}}}}}}
        for label, colors in CATEGORIA_COLORS.items()
    ]})


def apply_header_formatting(worksheet) -> None:
    spreadsheet = worksheet.spreadsheet
    sheet_id    = worksheet.id
    total_cols  = len(SHEET_HEADERS)
    spreadsheet.batch_update({"requests": [{"repeatCell": {
        "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": total_cols},
        "cell": {"userEnteredFormat": {
            "backgroundColor": {"red": 0.102, "green": 0.102, "blue": 0.180},
            "textFormat": {"bold": True, "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0}},
            "horizontalAlignment": "CENTER"}},
        "fields": "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment"
    }}]})


def remove_empty_columns(worksheet) -> None:
    headers = worksheet.row_values(1)
    if not headers:
        return
    empty_indices = [i for i, h in enumerate(headers) if not h.strip()]
    for col_idx in reversed(empty_indices):
        worksheet.spreadsheet.batch_update({"requests": [{"deleteDimension": {
            "range": {"sheetId": worksheet.id, "dimension": "COLUMNS", "startIndex": col_idx, "endIndex": col_idx + 1}
        }}]})


def write_to_sheet(worksheet, rows: list) -> tuple:
    remove_empty_columns(worksheet)
    worksheet.update("A1", [SHEET_HEADERS], value_input_option="USER_ENTERED")

    existing_data = worksheet.get_all_values()
    if existing_data:
        existing_set = {(str(r[0]).strip().lower(), str(r[1]).strip().lower()) for r in existing_data[1:] if len(r) >= 2}
    else:
        existing_set = set()

    new_rows, skipped = [], 0
    for row in rows:
        key = (str(row[0]).strip().lower(), str(row[1]).strip().lower())
        if key in existing_set:
            skipped += 1
        else:
            new_rows.append(row)

    if new_rows:
        if not existing_data or len(existing_data) <= 1:
            worksheet.update("A2", new_rows, value_input_option="USER_ENTERED")
        else:
            worksheet.append_rows(new_rows, value_input_option="USER_ENTERED")

    apply_header_formatting(worksheet)
    apply_stato_dropdown(worksheet)
    apply_qualita_instagram_dropdown(worksheet)
    apply_data_contatto_format(worksheet)
    apply_conditional_formatting(worksheet)
    apply_categoria_formatting(worksheet)

    return len(new_rows), skipped


# ──────────────────────────────────────────────────
# APPS SCRIPT (unchanged from v1)
# ──────────────────────────────────────────────────

APPS_SCRIPT_ID_FILE = ".apps_script_id"

APPS_SCRIPT_SOURCE = """\
function onEdit(e) {
  if (!e) return;
  var range = e.range;
  // Column 15 = O (Stato Contatto); row > 1 skips the header.
  if (range.getColumn() !== 15 || range.getRow() <= 1) return;
  var today = new Date();
  var dd    = String(today.getDate()).padStart(2, '0');
  var mm    = String(today.getMonth() + 1).padStart(2, '0');
  var yyyy  = today.getFullYear();
  range.getSheet()
       .getRange(range.getRow(), 16)
       .setValue(dd + '/' + mm + '/' + yyyy);
}
"""

APPS_SCRIPT_MANIFEST = """\
{
  "timeZone": "Australia/Melbourne",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
"""


def install_apps_script(spreadsheet, creds) -> None:
    try:
        from googleapiclient.discovery import build
    except ImportError:
        log.warning("google-api-python-client not installed — Apps Script step skipped.")
        return
    try:
        script_service = build("script", "v1", credentials=creds)
    except Exception as exc:
        log.warning("Could not initialise Apps Script service: %s", exc)
        return

    spreadsheet_id = spreadsheet.id
    content_body = {"files": [
        {"name": "Code",       "type": "SERVER_JS", "source": APPS_SCRIPT_SOURCE},
        {"name": "appsscript", "type": "JSON",      "source": APPS_SCRIPT_MANIFEST},
    ]}

    registry: dict = {}
    if os.path.exists(APPS_SCRIPT_ID_FILE):
        try:
            with open(APPS_SCRIPT_ID_FILE) as fh:
                registry = json.load(fh)
        except Exception:
            registry = {}

    script_id = registry.get(spreadsheet_id)

    if script_id:
        try:
            script_service.projects().updateContent(scriptId=script_id, body={**content_body, "scriptId": script_id}).execute()
            log.info("Apps Script updated (ID: %s).", script_id)
            return
        except Exception:
            script_id = None

    try:
        project   = script_service.projects().create(body={"title": "Venue Scraper Auto-Date", "parentId": spreadsheet_id}).execute()
        script_id = project["scriptId"]
        script_service.projects().updateContent(scriptId=script_id, body={**content_body, "scriptId": script_id}).execute()
        registry[spreadsheet_id] = script_id
        with open(APPS_SCRIPT_ID_FILE, "w") as fh:
            json.dump(registry, fh, indent=2)
        log.info("Apps Script installed (ID: %s).", script_id)
    except Exception as exc:
        log.warning("Could not install Apps Script: %s", exc)


# ──────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────

def _fmt_elapsed(start: float) -> str:
    secs = int(time.time() - start)
    return f"{secs // 60}m {secs % 60}s"


def main() -> None:
    start_time = time.time()

    log.info("=" * 60)
    log.info("Google Maps Venue Scraper v2 — %s", SUBURB)
    log.info("Venue types: %s", ", ".join(SEARCH_QUERIES))
    log.info("=" * 60)

    gmaps = build_gmaps_client()

    # ── Phase 1: Collect unique place IDs ─────────────
    log.info("Phase 1: Searching Google Maps ...")
    seen_ids:     set  = set()
    category_map: dict = {}

    for query in SEARCH_QUERIES:
        full_query = f"{query} in {SUBURB}"
        log.info("  Query: '%s'", full_query)
        results = text_search(gmaps, full_query)
        for result in results:
            pid = result.get("place_id")
            if pid and pid not in seen_ids:
                seen_ids.add(pid)
                category_map[pid] = query

    total_found = len(seen_ids)
    log.info("%d unique venues found.  [%s]", total_found, _fmt_elapsed(start_time))

    # ── Phase 2: Fetch Place Details ───────────────────
    log.info("Phase 2: Fetching Place Details ...")
    venues: list = []

    for i, place_id in enumerate(seen_ids, start=1):
        log.info("  [%d/%d] %s", i, total_found, place_id)
        details = get_place_details(gmaps, place_id)
        if details:
            details["_category"] = category_map[place_id]
            venues.append(details)
        time.sleep(0.15)

    log.info("%d venue records fetched.  [%s]", len(venues), _fmt_elapsed(start_time))

    # ── Phase 3: Scrape venue websites ────────────────
    log.info("Phase 3: Crawling venue websites ...")

    with_sites    = [(v, v["website"]) for v in venues if v.get("website")]
    without_sites = [v for v in venues if not v.get("website")]

    log.info(
        "  %d have a website (will crawl) / %d have none (skipping)",
        len(with_sites), len(without_sites),
    )

    web_session = requests.Session()
    web_session.headers.update(SCRAPER_HEADERS)
    contact_data: dict = {}

    for i, (venue, website) in enumerate(with_sites, start=1):
        pid  = venue["place_id"]
        name = venue.get("name", "")
        log.info("  [%d/%d] %s", i, len(with_sites), name)

        email, instagram, summary = scrape_website(website, web_session)
        contact_data[pid] = (email, instagram, summary)

        log.info("         email=%s  instagram=%s", email or "—", instagram or "—")
        time.sleep(random.uniform(WEBSITE_DELAY_MIN, WEBSITE_DELAY_MAX))

    log.info("Website crawling done.  [%s]", _fmt_elapsed(start_time))

    # ── Phase 4: Scrape Instagram profiles ────────────
    log.info("Phase 4: Analysing Instagram profiles ...")
    instagram_data: dict = {}

    for i, venue in enumerate(venues, start=1):
        pid          = venue.get("place_id", "")
        _, instagram, _ = contact_data.get(pid, ("", "", ""))

        if instagram:
            log.info("  [%d/%d] %s — %s", i, len(venues), venue.get("name", ""), instagram)
            ig_info = scrape_instagram_profile(instagram, web_session)
            instagram_data[pid] = ig_info
            time.sleep(random.uniform(1, 3))
        else:
            instagram_data[pid] = {"handle": "", "bio": "", "full_name": ""}

    log.info("Instagram analysis done.  [%s]", _fmt_elapsed(start_time))

    # ── Phase 5: Generate DMs and Emails with AI ──────
    log.info("Phase 5: Generating personalised DMs and emails with AI ...")
    ai_content: dict = {}

    for i, venue in enumerate(venues, start=1):
        pid          = venue.get("place_id", "")
        name         = venue.get("name", "")
        venue_type   = venue.get("_category", "")
        rating       = venue.get("rating", "")
        address      = venue.get("formatted_address", "")
        parts        = [p.strip() for p in address.split(",")]
        area         = parts[1] if len(parts) >= 2 else SUBURB

        email, instagram, website_summary = contact_data.get(pid, ("", "", ""))
        ig_info = instagram_data.get(pid, {"handle": "", "bio": "", "full_name": ""})

        log.info("  [%d/%d] Generating content for %s ...", i, len(venues), name)

        # Only generate if we have some data to personalise with
        has_enough_info = bool(instagram or website_summary or email)

        if has_enough_info:
            dm = generate_dm(
                venue_name=name,
                venue_type=venue_type,
                instagram_handle=ig_info.get("handle", ""),
                instagram_bio=ig_info.get("bio", ""),
                website_summary=website_summary,
                rating=rating,
                area=area,
            )
            time.sleep(1)

            email_text = generate_email(
                venue_name=name,
                venue_type=venue_type,
                email_address=email,
                instagram_handle=ig_info.get("handle", ""),
                instagram_bio=ig_info.get("bio", ""),
                website_summary=website_summary,
                rating=rating,
                area=area,
            )
        else:
            dm         = ""
            email_text = ""

        ai_content[pid] = {"dm": dm, "email": email_text}

    log.info("AI content generation done.  [%s]", _fmt_elapsed(start_time))

    # ── Phase 6: Build rows ────────────────────────────
    log.info("Phase 6: Building export rows ...")
    run_timestamp = datetime.now().strftime("%d/%m/%Y %H:%M")
    rows = []

    for venue in venues:
        pid              = venue.get("place_id", "")
        email, instagram, _ = contact_data.get(pid, ("", "", ""))
        address          = venue.get("formatted_address", "")
        rating           = venue.get("rating", "")
        reviews          = venue.get("user_ratings_total", 0) or 0
        website          = venue.get("website", "")

        parts    = [p.strip() for p in address.split(",")]
        area     = parts[1] if len(parts) >= 2 else SUBURB
        categoria = categorize_venue(rating, bool(instagram), bool(email), bool(website))

        dm_text    = ai_content.get(pid, {}).get("dm", "")
        email_text = ai_content.get(pid, {}).get("email", "")

        rows.append([
            venue.get("name", ""),                   # 0  Venue
            address,                                 # 1  Indirizzo
            area,                                    # 2  Area
            venue.get("formatted_phone_number", ""), # 3  Telefono
            website,                                 # 4  Sito Web
            email,                                   # 5  Email
            instagram,                               # 6  Instagram
            "",                                      # 7  Qualità Instagram (manual)
            rating,                                  # 8  Rating
            reviews,                                 # 9  N° Recensioni
            venue.get("_category", ""),              # 10 Tipo Attività
            categoria,                               # 11 Categoria
            dm_text,                                 # 12 DM Instagram
            email_text,                              # 13 Email Bozza
            "",                                      # 14 Stato Contatto
            "",                                      # 15 Data Contatto
            run_timestamp,                           # 16 Aggiornato
        ])

    # ── Phase 7: Write to Google Sheets ───────────────
    log.info("Phase 7: Writing to Google Sheet '%s' ...", SPREADSHEET_NAME)
    worksheet, creds = connect_to_sheet(SPREADSHEET_NAME, WORKSHEET_NAME)
    new_added, skipped = write_to_sheet(worksheet, rows)
    install_apps_script(worksheet.spreadsheet, creds)

    # ── Statistics ─────────────────────────────────────
    n                = len(rows)
    emails_found     = sum(1 for r in rows if r[5])
    instagrams_found = sum(1 for r in rows if r[6])
    with_website     = sum(1 for r in rows if r[4])
    alta_eligible    = sum(1 for r in rows if r[6] and r[5] and r[4] and r[8] != "" and float(r[8]) >= 4.3)
    media_eligible   = sum(1 for r in rows if r[6] and r[4])
    dm_generated     = sum(1 for r in rows if r[12])
    email_generated  = sum(1 for r in rows if r[13])

    cat_counts: dict = {"Alta": 0, "Media": 0, "Bassa": 0}
    for r in rows:
        if r[11] in cat_counts:
            cat_counts[r[11]] += 1

    def pct(count: int, total: int) -> str:
        return f"{count / total * 100:.1f}%" if total else "—"

    log.info("=" * 60)
    log.info("SCRAPING COMPLETATO — %s  [%s]", SUBURB, _fmt_elapsed(start_time))
    log.info("")
    log.info("Venues trovati su Google Maps:  %d", total_found)
    log.info("Nuovi aggiunti al foglio:       %d", new_added)
    log.info("Duplicati saltati:              %d", skipped)
    log.info("")
    log.info("QUALITA DEI DATI")
    log.info("Con sito web:    %d (%s)", with_website,     pct(with_website,     n))
    log.info("Con email:       %d (%s)", emails_found,     pct(emails_found,     n))
    log.info("Con Instagram:   %d (%s)", instagrams_found, pct(instagrams_found, n))
    log.info("Alta eligible (Insta+Email+Web+4.3+):  %d (%s)", alta_eligible,  pct(alta_eligible,  n))
    log.info("Media eligible (Insta+Web):            %d (%s)", media_eligible, pct(media_eligible, n))
    log.info("")
    log.info("CONTENUTO AI GENERATO")
    log.info("DM Instagram:    %d (%s)", dm_generated,    pct(dm_generated,    n))
    log.info("Email bozza:     %d (%s)", email_generated, pct(email_generated, n))
    log.info("")
    log.info("CATEGORIE")
    log.info("Alta  (Insta+Email+Web, rating 4.3+):  %d", cat_counts["Alta"])
    log.info("Media (Insta+Web, email optional):     %d", cat_counts["Media"])
    log.info("Bassa (missing Insta or Web):          %d", cat_counts["Bassa"])
    log.info("=" * 60)


if __name__ == "__main__":
    main()