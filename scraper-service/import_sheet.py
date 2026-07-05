"""
One-off import of the "Melbourne Venues" Google Sheet into Supabase `contacts`.

The spreadsheet has 7 tabs (one per suburb): Moonee Ponds, Malvern and Prahran
have a proper header row (read by column name); Richmond, Abbotsford, Hawthorn
and Northcote have no header row and are mapped positionally instead (see
POSITIONAL_WORKSHEETS below).

Usage:
    python import_sheet.py --dry-run
    python import_sheet.py

Requires scraper-service/.env (see .env.example) and the service account
JSON key referenced by SERVICE_ACCOUNT_FILE.
"""
from __future__ import annotations

import argparse
import os
from typing import Any

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from supabase import Client, create_client

load_dotenv()

SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "service_account.json")
SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

CATEGORY_MAP = {"Alta": "High", "Media": "Medium", "Bassa": "Low"}
STATUS_MAP = {
    "": "To contact",
    "Da contattare": "To contact",
    "Contattato": "Contacted",
    "Contattato ma non risposto": "No reply",
    "In conversazione": "In conversation",
    "Contattato e non interessato": "Not interested",
    # Free-text notes found in the Richmond tab (no headers, filled in ad hoc):
    "Qualcuno li segue": "To contact",
    "Email inesistente": "To contact",
    "Troppo Grande": "Not interested",
}

# Tabs with a proper header row — read via get_all_records().
NAMED_WORKSHEETS = ["Moonee Ponds", "Malvern", "Prahran"]

# Tabs with no header row — data starts at row 1, mapped positionally.
# Column order confirmed manually against the sheet on 2026-07-05.
POSITIONAL_WORKSHEETS: dict[str, list[str]] = {
    "Richmond": [
        "Venue", "Stato Contatto", "Categoria", "Instagram", "Indirizzo", "Area",
        "Telefono", "Sito Web", "Email", "Rating", "N° Recensioni", "Data Contatto",
        "Aggiornato",
    ],
    "Abbotsford": [
        "Venue", "Indirizzo", "Area", "Telefono", "Sito Web", "Email", "Instagram",
        "Rating", "N° Recensioni", "Categoria", "Stato Contatto", "Data Contatto",
        "Aggiornato",
    ],
    "Hawthorn": [
        "Venue", "Indirizzo", "Area", "Telefono", "Sito Web", "Email", "Instagram",
        "Rating", "N° Recensioni", "Categoria", "Stato Contatto", "Data Contatto",
        "Aggiornato",
    ],
    "Northcote": [
        "Venue", "Indirizzo", "Area", "Telefono", "Sito Web", "Email", "Instagram",
        "Rating", "N° Recensioni", "Categoria", "Stato Contatto", "Data Contatto",
        "Aggiornato",
    ],
}


def open_spreadsheet(spreadsheet_id: str) -> gspread.Spreadsheet:
    scopes = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)
    client = gspread.authorize(creds)
    return client.open_by_key(spreadsheet_id)


def read_named_worksheet(spreadsheet: gspread.Spreadsheet, title: str) -> list[dict[str, str]]:
    return spreadsheet.worksheet(title).get_all_records()


def read_positional_worksheet(
    spreadsheet: gspread.Spreadsheet, title: str, column_order: list[str]
) -> list[dict[str, str]]:
    values = spreadsheet.worksheet(title).get_all_values()
    rows = [v for v in values if any(cell.strip() for cell in v)]
    return [dict(zip(column_order, row)) for row in rows]


def as_str(value: Any) -> str:
    """gspread returns numeric cells as float/int from get_all_records(), but as
    str from get_all_values(); normalize both to a stripped string."""
    if value is None:
        return ""
    return str(value).strip()


def parse_numeric(value: str) -> float | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_int(value: str) -> int | None:
    parsed = parse_numeric(value)
    return int(parsed) if parsed is not None else None


def map_row(row: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Returns (contact_dict, discard_reason). Exactly one is None."""
    name = as_str(row.get("Venue"))
    if not name:
        return None, "missing Venue (name)"

    category_raw = as_str(row.get("Categoria"))
    category = CATEGORY_MAP.get(category_raw)
    if category is None:
        return None, f"unrecognized Categoria '{category_raw}'"

    status_raw = as_str(row.get("Stato Contatto"))
    if status_raw not in STATUS_MAP:
        return None, f"unrecognized Stato Contatto '{status_raw}'"
    status = STATUS_MAP[status_raw]

    rating_raw = as_str(row.get("Rating"))
    rating = parse_numeric(rating_raw)
    if rating_raw and rating is None:
        return None, f"non-numeric Rating '{rating_raw}'"

    review_count_raw = as_str(row.get("N° Recensioni"))
    review_count = parse_int(review_count_raw)
    if review_count_raw and review_count is None:
        return None, f"non-numeric N° Recensioni '{review_count_raw}'"

    last_contact_date = as_str(row.get("Data Contatto")) or None

    contact = {
        "place_id": None,
        "name": name,
        "address": as_str(row.get("Indirizzo")) or None,
        "suburb": as_str(row.get("Area")) or None,
        "phone": as_str(row.get("Telefono")) or None,
        "website": as_str(row.get("Sito Web")) or None,
        "email": as_str(row.get("Email")) or None,
        "instagram": as_str(row.get("Instagram")) or None,
        "business_type": as_str(row.get("Tipo Attività")) or None,
        "rating": rating,
        "review_count": review_count,
        "category": category,
        "status": status,
        "last_contact_date": last_contact_date,
        "source": "sheet_import",
    }
    return contact, None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Don't write to Supabase, just report.")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — check scraper-service/.env")
    if not SPREADSHEET_ID:
        raise SystemExit("SPREADSHEET_ID missing — check scraper-service/.env")

    print(f"Reading sheet id '{SPREADSHEET_ID}'")
    spreadsheet = open_spreadsheet(SPREADSHEET_ID)

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    existing = supabase.table("contacts").select("name,address").eq("source", "sheet_import").execute()
    existing_keys = {(r["name"], r["address"]) for r in existing.data}

    to_insert: list[dict[str, Any]] = []
    discarded: list[tuple[str, str, str]] = []
    duplicates = 0
    not_interested_no_blocklist = 0
    total_rows = 0

    all_tabs = [(title, "named") for title in NAMED_WORKSHEETS] + [
        (title, "positional") for title in POSITIONAL_WORKSHEETS
    ]

    for title, kind in all_tabs:
        if kind == "named":
            rows = read_named_worksheet(spreadsheet, title)
        else:
            rows = read_positional_worksheet(spreadsheet, title, POSITIONAL_WORKSHEETS[title])

        print(f"  {title}: read {len(rows)} rows")
        total_rows += len(rows)

        for row in rows:
            contact, reason = map_row(row)
            if reason is not None:
                discarded.append((title, as_str(row.get("Venue")) or "<no name>", reason))
                continue

            key = (contact["name"], contact["address"])
            if key in existing_keys:
                duplicates += 1
                continue
            existing_keys.add(key)

            if contact["status"] == "Not interested":
                not_interested_no_blocklist += 1

            to_insert.append(contact)

    print("\n--- Summary ---")
    print(f"Rows read:        {total_rows}")
    print(f"To insert:        {len(to_insert)}")
    print(f"Duplicates (already imported, skipped): {duplicates}")
    print(f"Discarded:        {len(discarded)}")
    for tab, name, reason in discarded:
        print(f"  - [{tab}] {name}: {reason}")
    if not_interested_no_blocklist:
        print(
            f"\nNote: {not_interested_no_blocklist} row(s) map to 'Not interested' but have no "
            "place_id (sheet import), so they will NOT be added to `blocklist` — only "
            "contacts.status is set. Blocklist matching relies on place_id from the scraper."
        )

    if args.dry_run:
        print("\nDry run: no rows written.")
        return

    if to_insert:
        supabase.table("contacts").insert(to_insert).execute()
    print(f"\nInserted {len(to_insert)} contacts.")


if __name__ == "__main__":
    main()
