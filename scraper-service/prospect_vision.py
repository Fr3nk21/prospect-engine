"""
UnFocus — Instagram screenshot analysis + email generation (Claude Vision).

Used by the /analyze background job in main.py. Score breakdown keeps the
six dimensions already validated in the old prospect_analyzer.py (Obsidian
CLI), restructured as a list so the frontend can render any number of
dimensions without hardcoding field names.
"""
from __future__ import annotations

import base64
import json

import anthropic

MODEL = "claude-sonnet-4-6"
MAX_IMAGES = 10

MEDIA_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}

SYSTEM_PROMPT = """You are a digital marketing consultant for UnFocus, a videography and photography studio in Melbourne specialising in hospitality content.

You will receive Instagram screenshots of a venue plus some business context. Analyse the screenshots and produce a scored breakdown and three outreach emails.

SCORING — six dimensions, explain each with one sentence:
- visual_quality (max 20): photo/video quality — professional or phone snapshots?
- content_consistency (max 20): cohesive visual style/brand, or random?
- video_presence (max 20): Reels/video content and quality — KEY, this is what we sell
- posting_frequency (max 15): how often, gaps, active or dormant
- engagement_signals (max 10): comments/likes visible
- bio_profile (max 15): professional bio, highlights, contact info

EMAIL PHILOSOPHY (applies to all three variants — same substance, different register):
- First person, honest and human tone — not salesy
- Prove you actually looked: reference something SPECIFIC seen in the screenshots
  (a dish, an event, the interior, a reel) — never a generic observation
- One honest note on what's working or missing, tied to 1-2 concrete video/photo ideas
- Greeting "Hey [business name]", sign-off "Cheers, Francesco"
- CTA: "Curious if this resonates?" or a natural equivalent
- No bullets, no bold, no emoji, no generic adjectives ("stunning", "amazing"),
  no artificial urgency, nothing that could be copy-pasted onto any other business

- email_technical: opens more directly with the observation + suggestion.
  Fits structured/corporate-feeling businesses. Max ~120 words.
- email_warm: opens with more relational warmth before the proposal. Fits
  small/family-feeling businesses. Max ~120 words.
- email_followup: assumes email_technical or email_warm went unanswered.
  Briefly references the first email, adds one new observation or hook.
  Max ~80 words.

Respond ONLY with valid JSON, no markdown fences, matching exactly:
{
  "dimensions": [
    {"key": "visual_quality", "label": "Visual Quality", "max": 20, "score": 0, "note": "..."},
    {"key": "content_consistency", "label": "Content Consistency", "max": 20, "score": 0, "note": "..."},
    {"key": "video_presence", "label": "Video Presence", "max": 20, "score": 0, "note": "..."},
    {"key": "posting_frequency", "label": "Posting Frequency", "max": 15, "score": 0, "note": "..."},
    {"key": "engagement_signals", "label": "Engagement Signals", "max": 10, "score": 0, "note": "..."},
    {"key": "bio_profile", "label": "Bio & Profile Setup", "max": 15, "score": 0, "note": "..."}
  ],
  "total_score": 0,
  "summary": "2-3 sentence overall assessment",
  "has_videographer": "yes/no/unclear",
  "email_technical": "full email body",
  "email_warm": "full email body",
  "email_followup": "full email body"
}"""


def _media_type(storage_path: str) -> str:
    ext = storage_path.rsplit(".", 1)[-1].lower()
    return MEDIA_TYPES.get(ext, "image/jpeg")


def analyze(
    client: anthropic.Anthropic,
    contact: dict,
    screenshots: list[tuple[str, bytes]],
) -> dict:
    """screenshots: list of (storage_path, raw_bytes), newest-safe order doesn't matter."""
    content = []
    for storage_path, raw in screenshots[:MAX_IMAGES]:
        data = base64.standard_b64encode(raw).decode("utf-8")
        content.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": _media_type(storage_path), "data": data},
            }
        )

    context = [f"Venue: {contact.get('name', '')}"]
    for field in ("business_type", "suburb", "website", "instagram", "rating", "review_count"):
        if contact.get(field):
            context.append(f"{field}: {contact[field]}")
    context.append(f"\n{len(content)} Instagram screenshots. Analyse and generate the outreach emails.")
    content.append({"type": "text", "text": "\n".join(context)})

    response = client.messages.create(
        model=MODEL,
        max_tokens=3000,
        system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": content}],
    )

    raw_text = response.content[0].text.strip()
    if raw_text.startswith("```"):
        raw_text = raw_text.split("\n", 1)[1]
    if raw_text.endswith("```"):
        raw_text = raw_text.rsplit("```", 1)[0]

    return json.loads(raw_text.strip())
