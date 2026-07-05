"""
UnFocus Prospect Engine — scraper microservice (FastAPI).

POST /scrape kicks off a Google Maps search + website enrichment run as a
background task and returns immediately with a job_id. Progress is tracked
in Supabase `scrape_jobs` / `scrape_job_items` (service_role key, bypasses RLS).
"""
from __future__ import annotations

import logging
import os

import requests
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from supabase import Client, create_client

import scraper_core as sc

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("scraper_service")

MAPS_API_KEY = os.getenv("MAPS_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SCRAPER_API_TOKEN = os.getenv("SCRAPER_API_TOKEN", "")

for name, value in [
    ("MAPS_API_KEY", MAPS_API_KEY),
    ("SUPABASE_URL", SUPABASE_URL),
    ("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
    ("SCRAPER_API_TOKEN", SCRAPER_API_TOKEN),
]:
    if not value:
        raise EnvironmentError(f"{name} is not set. Check scraper-service/.env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

app = FastAPI(title="Prospect Engine Scraper")


def require_token(authorization: str = Header(default="")) -> None:
    if authorization != f"Bearer {SCRAPER_API_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


class ScrapeRequest(BaseModel):
    location: str
    business_type: str


@app.get("/")
def health() -> dict:
    return {"status": "ok"}


@app.post("/scrape", dependencies=[Depends(require_token)])
def start_scrape(req: ScrapeRequest, background_tasks: BackgroundTasks) -> dict:
    location = req.location.strip()
    business_type = req.business_type.strip()
    if not location or not business_type:
        raise HTTPException(status_code=422, detail="location and business_type are required")

    job = (
        supabase.table("scrape_jobs")
        .insert({"location": location, "business_type": business_type, "status": "queued"})
        .execute()
    )
    job_id = job.data[0]["id"]

    background_tasks.add_task(run_scrape_job, job_id, location, business_type)

    return {"job_id": job_id}


@app.get("/scrape/{job_id}", dependencies=[Depends(require_token)])
def get_scrape_job(job_id: str) -> dict:
    result = supabase.table("scrape_jobs").select("*").eq("id", job_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return result.data


def run_scrape_job(job_id: str, location: str, business_type: str) -> None:
    try:
        supabase.table("scrape_jobs").update(
            {"status": "running", "started_at": "now"}
        ).eq("id", job_id).execute()

        query = f"{business_type} in {location}"
        log.info("[job %s] searching: %s", job_id, query)

        place_ids = list(dict.fromkeys(sc.text_search(MAPS_API_KEY, query)))
        total = len(place_ids)
        log.info("[job %s] %d unique places found", job_id, total)

        supabase.table("scrape_jobs").update({"total": total}).eq("id", job_id).execute()

        web_session = requests.Session()
        web_session.headers.update(sc.SCRAPER_HEADERS)

        processed = new_contacts = skipped = 0

        for place_id in place_ids:
            item_status, item_error, item_name = "pending", None, None

            try:
                existing = (
                    supabase.table("contacts").select("id").eq("place_id", place_id).limit(1).execute()
                )
                if existing.data:
                    item_status = "skipped_duplicate"
                    skipped += 1
                else:
                    blocked = (
                        supabase.table("blocklist").select("place_id").eq("place_id", place_id).limit(1).execute()
                    )
                    if blocked.data:
                        item_status = "skipped_blocklist"
                        skipped += 1
                    else:
                        details = sc.get_place_details(MAPS_API_KEY, place_id)
                        item_name = details.get("displayName", {}).get("text")

                        business_status = details.get("businessStatus", "OPERATIONAL")
                        if business_status != "OPERATIONAL":
                            # Closed venue — not a real dedup/error case, so no
                            # scrape_job_items row (schema has no status for it yet).
                            log.info("[job %s] skipping closed venue %s (%s)", job_id, place_id, business_status)
                            skipped += 1
                            processed += 1
                            supabase.table("scrape_jobs").update(
                                {"processed": processed, "new_contacts": new_contacts, "skipped": skipped}
                            ).eq("id", job_id).execute()
                            continue

                        website = details.get("websiteUri") or ""
                        email, instagram, _summary = ("", "", "")
                        if website:
                            email, instagram, _summary = sc.scrape_website(website, web_session)

                        rating = details.get("rating")
                        review_count = details.get("userRatingCount")
                        category, is_new_venue = sc.categorize(rating, review_count)

                        address = details.get("formattedAddress", "")
                        parts = [p.strip() for p in address.split(",")]
                        suburb = parts[1] if len(parts) >= 2 else location

                        inserted = (
                            supabase.table("contacts")
                            .insert(
                                {
                                    "place_id": place_id,
                                    "name": item_name or "",
                                    "address": address or None,
                                    "suburb": suburb,
                                    "phone": details.get("internationalPhoneNumber") or None,
                                    "website": website or None,
                                    "email": email or None,
                                    "instagram": instagram or None,
                                    "business_type": business_type,
                                    "rating": rating,
                                    "review_count": review_count,
                                    "category": category,
                                    "is_new_venue": is_new_venue,
                                    "source": "scraper",
                                }
                            )
                            .execute()
                        )
                        contact_id = inserted.data[0]["id"]

                        supabase.table("contact_events").insert(
                            {
                                "contact_id": contact_id,
                                "type": "import",
                                "body": f"Scraped from Google Maps — {location}, {business_type}",
                            }
                        ).execute()

                        item_status = "done"
                        new_contacts += 1
            except Exception as exc:
                log.warning("[job %s] error on place %s: %s", job_id, place_id, exc)
                item_status = "error"
                item_error = str(exc)

            supabase.table("scrape_job_items").upsert(
                {
                    "job_id": job_id,
                    "place_id": place_id,
                    "name": item_name,
                    "status": item_status,
                    "error": item_error,
                }
            ).execute()

            processed += 1
            supabase.table("scrape_jobs").update(
                {"processed": processed, "new_contacts": new_contacts, "skipped": skipped}
            ).eq("id", job_id).execute()

        supabase.table("scrape_jobs").update(
            {"status": "completed", "finished_at": "now"}
        ).eq("id", job_id).execute()
        log.info("[job %s] completed: %d processed, %d new, %d skipped", job_id, processed, new_contacts, skipped)

    except Exception as exc:
        log.exception("[job %s] failed", job_id)
        supabase.table("scrape_jobs").update(
            {"status": "failed", "error": str(exc), "finished_at": "now"}
        ).eq("id", job_id).execute()
