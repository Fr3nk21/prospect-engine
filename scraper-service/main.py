"""
UnFocus Prospect Engine — scraper microservice (FastAPI).

POST /scrape kicks off a Google Maps search + website enrichment run as a
background task and returns immediately with a job_id. Progress is tracked
in Supabase `scrape_jobs` / `scrape_job_items` (service_role key, bypasses RLS).
"""
from __future__ import annotations

import asyncio
import logging
import os

import anthropic
import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel
from supabase import Client, create_client

import prospect_vision as pv
import scraper_core as sc

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("scraper_service")

MAPS_API_KEY = os.getenv("MAPS_API_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SCRAPER_API_TOKEN = os.getenv("SCRAPER_API_TOKEN", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

ENRICHMENT_CONCURRENCY = 8

for name, value in [
    ("MAPS_API_KEY", MAPS_API_KEY),
    ("SUPABASE_URL", SUPABASE_URL),
    ("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
    ("SCRAPER_API_TOKEN", SCRAPER_API_TOKEN),
    ("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY),
]:
    if not value:
        raise EnvironmentError(f"{name} is not set. Check scraper-service/.env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

app = FastAPI(title="Prospect Engine Scraper")


def require_token(authorization: str = Header(default="")) -> None:
    if authorization != f"Bearer {SCRAPER_API_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


class ScrapeRequest(BaseModel):
    location: str
    business_type: str


@app.get("/")
@app.get("/health")
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


class AnalyzeRequest(BaseModel):
    contact_id: str


@app.post("/analyze", dependencies=[Depends(require_token)])
def start_analysis(req: AnalyzeRequest, background_tasks: BackgroundTasks) -> dict:
    contact_id = req.contact_id.strip()
    if not contact_id:
        raise HTTPException(status_code=422, detail="contact_id is required")

    job = (
        supabase.table("analysis_jobs")
        .insert({"contact_id": contact_id, "status": "queued"})
        .execute()
    )
    job_id = job.data[0]["id"]

    background_tasks.add_task(run_analysis_job, job_id, contact_id)

    return {"job_id": job_id}


@app.get("/analyze/{job_id}", dependencies=[Depends(require_token)])
def get_analysis_job(job_id: str) -> dict:
    result = supabase.table("analysis_jobs").select("*").eq("id", job_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return result.data


def _mark_job_item(job_id: str, place_id: str, name: str | None, status: str, error: str | None) -> None:
    supabase.table("scrape_job_items").upsert(
        {"job_id": job_id, "place_id": place_id, "name": name, "status": status, "error": error}
    ).execute()


async def _enrich_candidates(
    job_id: str,
    location: str,
    business_type: str,
    candidates: list[dict],
    processed: int,
    new_contacts: int,
    skipped: int,
) -> tuple[int, int]:
    """Runs website enrichment for `candidates` concurrently (semaphore-8 +
    per-host lock, see scraper_core.scrape_website) and saves each contact
    as soon as its own enrichment finishes — same processed/new_contacts
    increments as the old sequential loop, just driven by completion order
    instead of list order."""
    sem = asyncio.Semaphore(ENRICHMENT_CONCURRENCY)
    host_locks = sc.HostLocks()
    counters = {"processed": processed, "new_contacts": new_contacts}
    counters_lock = asyncio.Lock()

    async def handle(client: httpx.AsyncClient, candidate: dict) -> None:
        place_id = candidate["place_id"]
        details = candidate["details"]
        item_name = candidate["item_name"]
        item_status, item_error = "pending", None

        try:
            website = details.get("websiteUri") or ""
            email, instagram, _summary = ("", "", "")
            if website:
                async with sem:
                    email, instagram, _summary = await sc.scrape_website(website, client, host_locks)

            rating = details.get("rating")
            review_count = details.get("userRatingCount")
            category, is_new_venue = sc.categorize(rating, review_count)
            place_type = sc.normalize_business_type(details.get("types"), business_type)

            address = details.get("formattedAddress", "")
            # suburb = the search location entered in the scrape form, not a
            # piece of the business's own street address — that's what
            # "1 Martin Pl" / "21/31 Hall St" leaking into it were.
            suburb = location

            def save_contact() -> None:
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
                            "business_type": place_type,
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

            await asyncio.to_thread(save_contact)
            item_status = "done"
            async with counters_lock:
                counters["new_contacts"] += 1
        except Exception as exc:
            log.warning("[job %s] error on place %s: %s", job_id, place_id, exc)
            item_status = "error"
            item_error = str(exc)

        await asyncio.to_thread(_mark_job_item, job_id, place_id, item_name, item_status, item_error)

        async with counters_lock:
            counters["processed"] += 1
            snapshot = {**counters, "skipped": skipped}

        await asyncio.to_thread(
            lambda: supabase.table("scrape_jobs").update(snapshot).eq("id", job_id).execute()
        )

    async with httpx.AsyncClient(headers=sc.SCRAPER_HEADERS) as client:
        await asyncio.gather(*(handle(client, candidate) for candidate in candidates))

    return counters["processed"], counters["new_contacts"]


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

        processed = new_contacts = skipped = 0
        candidates: list[dict] = []

        # Phase 1 — dedup / blocklist / Place Details. Cheap sequential calls,
        # not the bottleneck, so this stays a plain for loop exactly as before.
        for place_id in place_ids:
            try:
                existing = (
                    supabase.table("contacts").select("id").eq("place_id", place_id).limit(1).execute()
                )
                if existing.data:
                    _mark_job_item(job_id, place_id, None, "skipped_duplicate", None)
                    skipped += 1
                    processed += 1
                    supabase.table("scrape_jobs").update(
                        {"processed": processed, "new_contacts": new_contacts, "skipped": skipped}
                    ).eq("id", job_id).execute()
                    continue

                blocked = (
                    supabase.table("blocklist").select("place_id").eq("place_id", place_id).limit(1).execute()
                )
                if blocked.data:
                    _mark_job_item(job_id, place_id, None, "skipped_blocklist", None)
                    skipped += 1
                    processed += 1
                    supabase.table("scrape_jobs").update(
                        {"processed": processed, "new_contacts": new_contacts, "skipped": skipped}
                    ).eq("id", job_id).execute()
                    continue

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

                candidates.append({"place_id": place_id, "details": details, "item_name": item_name})
            except Exception as exc:
                log.warning("[job %s] error on place %s: %s", job_id, place_id, exc)
                _mark_job_item(job_id, place_id, None, "error", str(exc))
                processed += 1
                supabase.table("scrape_jobs").update(
                    {"processed": processed, "new_contacts": new_contacts, "skipped": skipped}
                ).eq("id", job_id).execute()

        # Phase 2 — website enrichment, concurrency 8 with a per-host lock
        # (see scraper_core.HostLocks / scrape_website). Runs in its own
        # asyncio loop; run_scrape_job itself stays a plain sync function
        # because FastAPI's BackgroundTasks executes sync callables in a
        # worker thread, which has no event loop of its own — asyncio.run()
        # here does not clash with the request-handling loop.
        processed, new_contacts = asyncio.run(
            _enrich_candidates(job_id, location, business_type, candidates, processed, new_contacts, skipped)
        )

        supabase.table("scrape_jobs").update(
            {"status": "completed", "finished_at": "now"}
        ).eq("id", job_id).execute()
        log.info("[job %s] completed: %d processed, %d new, %d skipped", job_id, processed, new_contacts, skipped)

    except Exception as exc:
        log.exception("[job %s] failed", job_id)
        supabase.table("scrape_jobs").update(
            {"status": "failed", "error": str(exc), "finished_at": "now"}
        ).eq("id", job_id).execute()


def run_analysis_job(job_id: str, contact_id: str) -> None:
    try:
        supabase.table("analysis_jobs").update(
            {"status": "running", "started_at": "now"}
        ).eq("id", job_id).execute()

        contact = (
            supabase.table("contacts")
            .select("name, business_type, suburb, website, instagram, rating, review_count")
            .eq("id", contact_id)
            .single()
            .execute()
        ).data

        rows = (
            supabase.table("screenshots")
            .select("storage_path")
            .eq("contact_id", contact_id)
            .order("created_at")
            .limit(pv.MAX_IMAGES)
            .execute()
        ).data
        if not rows:
            raise ValueError("No screenshots to analyze")

        screenshots = [
            (row["storage_path"], supabase.storage.from_("screenshots").download(row["storage_path"]))
            for row in rows
        ]

        analysis_context = (
            supabase.table("settings")
            .select("value")
            .eq("key", "analysis_context")
            .single()
            .execute()
        ).data
        analysis_context = analysis_context["value"] if analysis_context else None

        result = pv.analyze(anthropic_client, contact, screenshots, analysis_context)

        dimensions = result.get("dimensions", [])
        total_max = sum(d.get("max", 0) for d in dimensions) or 100
        total_score = result.get("total_score", sum(d.get("score", 0) for d in dimensions))
        priority_score = max(1, min(10, round(total_score / total_max * 10)))

        supabase.table("contacts").update(
            {
                "analysis": result.get("summary", ""),
                "score_breakdown": {
                    "dimensions": dimensions,
                    "total_score": total_score,
                    "total_max": total_max,
                    "has_videographer": result.get("has_videographer", "unclear"),
                },
                "priority_score": priority_score,
                "email_technical": result.get("email_technical", ""),
                "email_warm": result.get("email_warm", ""),
                "email_followup": result.get("email_followup", ""),
            }
        ).eq("id", contact_id).execute()

        supabase.table("contact_events").insert(
            {
                "contact_id": contact_id,
                "type": "analysis",
                "body": f"Instagram analysis: {total_score}/{total_max} — {result.get('summary', '')}",
            }
        ).execute()

        supabase.table("analysis_jobs").update(
            {"status": "completed", "finished_at": "now"}
        ).eq("id", job_id).execute()
        log.info("[analysis %s] completed for contact %s: %s/%s", job_id, contact_id, total_score, total_max)

    except Exception as exc:
        log.exception("[analysis %s] failed", job_id)
        supabase.table("analysis_jobs").update(
            {"status": "failed", "error": str(exc), "finished_at": "now"}
        ).eq("id", job_id).execute()
