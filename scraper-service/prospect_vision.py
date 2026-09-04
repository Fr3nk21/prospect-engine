"""
UnFocus — Instagram screenshot analysis + email generation (Claude Vision).

Used by the /analyze background job in main.py. The model scores six 0-20
dimensions; main.py then combines them into the Intent / Craft / opportunity
score and the High/Medium/Low category, using weights/thresholds read from
the `scoring_config` settings row (falling back to DEFAULT_SCORING_CONFIG).
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

DEFAULT_ANALYSIS_CONTEXT = "a videography and photography studio in Melbourne specialising in hospitality content"

DEFAULT_SCORING_CONFIG = {
    "intent_weights": {
        "content_consistency": 35,
        "posting_frequency": 30,
        "engagement_signals": 20,
        "bio_profile": 15,
    },
    "craft_weights": {
        "video_presence": 60,
        "photo_quality": 40,
    },
    "thresholds": {
        "intent_min": 40,
        "gap_high": 20,
        "gap_medium": 5,
    },
    "opportunity_blend": {
        "intent_share": 0.4,
        "gap_share": 0.6,
        "gap_ceiling": 40,
    },
}

SYSTEM_PROMPT_TEMPLATE = """You are a digital marketing consultant for UnFocus, {analysis_context}.

You will receive Instagram screenshots of a venue plus some business context. Score six dimensions and write three outreach emails. Do NOT compute any total or category yourself, only score the six dimensions honestly.

SCORING, six dimensions, each scored 0-20, explain each with one sentence:
- photo_quality (0-20): quality of the still photography. Lighting, composition, styling, editing. Professional shoot or phone snapshots?
- video_presence (0-20): amount AND quality of video/Reels. Look for a Reels tab, play icons on thumbnails, view counts, cover frames. Little or no video is a LOW score even when the photos are good. This is central to what we sell, judge it strictly.
- content_consistency (0-20): a cohesive visual style and brand identity across the grid, or random and inconsistent?
- posting_frequency (0-20): how often they post, how recent, visible gaps or dormancy.
- engagement_signals (0-20): likes and comments visible, relative to how many followers they have.
- bio_profile (0-20): professional bio, highlights, contact info, a working link.

EMAIL PHILOSOPHY (applies to all three variants, same substance, different register):
- Write like a real business owner emailing another business owner: professional, direct, warm. Short sentences, plain language. No marketing hype, no filler adjectives, no clichés. It must read as a genuine note from one professional to another, never as a template.
- Never use em dashes (—) or en dashes (–) anywhere in the email. Use commas, full stops, or split into two sentences instead.
- First person, honest and human tone, not salesy.
- Prove you actually looked: reference something SPECIFIC seen in the screenshots (a dish, an event, the interior, a reel), never a generic observation.
- One honest note on what's working or missing, tied to 1-2 concrete video/photo ideas.

LEAD WITH THE RIGHT CRAFT GAP — photo vs video:
- Look at your own photo_quality and video_presence scores before writing. Lead the email's concrete observation with whichever of the two is weaker: if video is the weaker one, focus the suggestion on video and Reels (the higher-value angle for us); if photo is weaker, focus on photography. If both are weak, lead with video. If both are already strong, pick the one with more room and keep the pitch lighter.

MATCH CONFIDENCE TO WHAT YOU SEE — intent vs execution:
- When the brand clearly cares (consistent identity, regular posting) but the execution lags behind, be direct and specific about the gap and the fix. When the signals are weaker or the profile is already polished, keep the tone lighter and more exploratory, and never manufacture a problem that isn't there.

- Greeting: "Hey [business name]"
- Sign-off must be exactly two lines: "Cheers," alone on the first line, then "Francesco" alone on the line below (use a real line break between them).
- CTA: end with a low-friction, concrete next step tied to the observation made earlier in the email. Style example: "Want me to put together a couple of quick ideas for [business name]?" Never end with a vague question about feelings or interest (avoid phrasing like "does this resonate").
- No bullets, no bold, no emoji, no generic adjectives ("stunning", "amazing"), no artificial urgency, nothing that could be copy-pasted onto any other business.

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
    {"key": "photo_quality", "label": "Photo Quality", "max": 20, "score": 0, "note": "..."},
    {"key": "video_presence", "label": "Video Presence", "max": 20, "score": 0, "note": "..."},
    {"key": "content_consistency", "label": "Content Consistency", "max": 20, "score": 0, "note": "..."},
    {"key": "posting_frequency", "label": "Posting Frequency", "max": 20, "score": 0, "note": "..."},
    {"key": "engagement_signals", "label": "Engagement Signals", "max": 20, "score": 0, "note": "..."},
    {"key": "bio_profile", "label": "Bio & Profile Setup", "max": 20, "score": 0, "note": "..."}
  ],
  "summary": "2-3 sentence overall assessment",
  "has_videographer": "yes/no/unclear",
  "email_technical": "full email body",
  "email_warm": "full email body",
  "email_followup": "full email body"
}"""


def build_system_prompt(analysis_context: str | None) -> str:
    return SYSTEM_PROMPT_TEMPLATE.replace("{analysis_context}", analysis_context or DEFAULT_ANALYSIS_CONTEXT)


def _media_type(storage_path: str) -> str:
    ext = storage_path.rsplit(".", 1)[-1].lower()
    return MEDIA_TYPES.get(ext, "image/jpeg")


def _strip_dashes(text: str) -> str:
    """Deterministic safety net: the prompt tells the model not to use em/en
    dashes, but that's probabilistic. Strip any that slip through before the
    email is saved, since a long dash is one of the clearest AI tells."""
    if not text:
        return text
    text = text.replace(" — ", ", ").replace("—", ", ")
    text = text.replace(" – ", "-").replace("–", "-")
    return text


def compute_opportunity(dimensions: list[dict], config: dict | None = None) -> dict:
    """Turns the six raw 0-20 dimension scores into Intent, Craft, gap, the
    0-100 opportunity score, and the High/Medium/Low category. Pure function,
    no I/O. See DEFAULT_SCORING_CONFIG for the shape of `config`."""
    config = config or DEFAULT_SCORING_CONFIG
    by_key = {d.get("key"): d for d in dimensions}

    def norm(key: str) -> float:
        d = by_key.get(key)
        if not d:
            return 0.0
        mx = d.get("max", 20) or 20
        return (d.get("score", 0) or 0) / mx

    iw = config.get("intent_weights", DEFAULT_SCORING_CONFIG["intent_weights"])
    cw = config.get("craft_weights", DEFAULT_SCORING_CONFIG["craft_weights"])
    th = config.get("thresholds", DEFAULT_SCORING_CONFIG["thresholds"])
    blend = config.get("opportunity_blend", DEFAULT_SCORING_CONFIG["opportunity_blend"])

    intent = sum(norm(k) * w for k, w in iw.items())
    craft = sum(norm(k) * w for k, w in cw.items())
    gap = intent - craft

    ceiling = blend.get("gap_ceiling", 40) or 40
    gap_component = max(0.0, min(gap, ceiling)) / ceiling * 100.0
    opportunity = blend.get("intent_share", 0.4) * intent + blend.get("gap_share", 0.6) * gap_component

    if intent < th.get("intent_min", 40):
        opportunity *= 0.4
        category = "Low"
    elif gap >= th.get("gap_high", 20):
        category = "High"
    elif gap >= th.get("gap_medium", 5):
        category = "Medium"
    else:
        category = "Low"

    return {
        "intent": round(intent, 1),
        "craft": round(craft, 1),
        "gap": round(gap, 1),
        "opportunity": round(opportunity),
        "category": category,
    }


def _parse_json_response(raw_text: str) -> dict:
    """Claude is asked for raw JSON but sometimes wraps it in a ```json fence
    or adds a sentence before/after anyway. Strip fences if present, then
    fall back to slicing between the first '{' and the last '}'."""
    text = raw_text.strip()

    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        if text.endswith("```"):
            text = text[:-len("```")]
        text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start: end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError(
        f"Could not parse JSON from Claude's response. Raw text received:\n{raw_text}"
    )


def analyze(
    client: anthropic.Anthropic,
    contact: dict,
    screenshots: list[tuple[str, bytes]],
    analysis_context: str | None = None,
) -> dict:
    """screenshots: list of (storage_path, raw_bytes)."""
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
        system=[
            {
                "type": "text",
                "text": build_system_prompt(analysis_context),
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": content}],
    )

    raw_text = response.content[0].text
    result = _parse_json_response(raw_text)
    for field in ("email_technical", "email_warm", "email_followup"):
        if field in result:
            result[field] = _strip_dashes(result[field])
    return result