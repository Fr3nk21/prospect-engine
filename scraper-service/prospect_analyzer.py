"""
UnFocus — Prospect Analyzer
Analizza screenshot Instagram e arricchisce la nota Obsidian con analisi + email.

Uso:
    python prospect_analyzer.py --vault "~/Documents/Fr3nk's Vault/Fr3nk's Vault" --prospect hochi-mama-richmond
    python prospect_analyzer.py --vault "~/Documents/Fr3nk's Vault/Fr3nk's Vault" --list
"""

import anthropic
import base64
import json
import re
import sys
import argparse
from pathlib import Path
from datetime import datetime

MODEL = "claude-sonnet-4-6"
MAX_IMAGES = 8
SUPPORTED_FORMATS = {".jpg", ".jpeg", ".png", ".webp"}

SYSTEM_PROMPT = """You are a digital marketing consultant for UnFocus, a videography and photography studio in Melbourne specialising in hospitality content.

You will receive Instagram screenshots of a venue. Analyse them and produce:

1. ANALYSIS of their Instagram presence
2. OUTREACH SCORE (0-100) with breakdown
3. A COLD EMAIL for first contact
4. A FOLLOW-UP EMAIL if they don't reply

SCORING SYSTEM (explain each component):
- Visual Quality (0-20): How good are their photos/videos? Professional or phone snapshots?
- Content Consistency (0-20): Cohesive visual style/brand? Or random?
- Video Presence (0-20): Reels/video content? Quality? KEY because that's what we sell.
- Posting Frequency (0-15): How often? Gaps? Active or dormant?
- Engagement Signals (0-10): Comments, likes visible?
- Bio & Profile Setup (0-15): Professional bio? Highlights? Contact info?

COLD EMAIL RULES:
- Casual Australian English, like a real person — NOT a template
- Max 120 words
- Open with something SPECIFIC from their content (a dish, interior, event)
- Don't say "I noticed" — reference it naturally
- Propose ONE specific content idea
- NO emoji, NO "hope this finds you well", NO "I'd love to", NO "reaching out"
- Sign: Francesco | UnFocus — unfocus.com.au

FOLLOW-UP EMAIL RULES:
- Max 80 words
- Reference first email briefly
- Add new value (competitor observation, seasonal hook)
- Human tone, not automated
- Same signature

Respond ONLY with valid JSON, no markdown fences:
{
    "analysis": {
        "visual_quality": {"score": 14, "note": "one sentence"},
        "content_consistency": {"score": 8, "note": "one sentence"},
        "video_presence": {"score": 5, "note": "one sentence"},
        "posting_frequency": {"score": 10, "note": "one sentence"},
        "engagement_signals": {"score": 6, "note": "one sentence"},
        "bio_profile": {"score": 12, "note": "one sentence"},
        "total_score": 55,
        "summary": "2-3 sentence overall assessment",
        "has_videographer": "yes/no/unclear"
    },
    "venue_type": "Restaurant/Bar/Cafe/Hotel/Pub",
    "cuisine": "Italian/Japanese/Australian/etc or N/A",
    "cold_email_subject": "short subject line",
    "cold_email_body": "the email text",
    "followup_email_subject": "short subject line",
    "followup_email_body": "the followup text"
}"""


def encode_image(path: Path) -> tuple[str, str]:
    suffix = path.suffix.lower()
    media_types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    with open(path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode("utf-8")
    return data, media_types.get(suffix, "image/jpeg")


def get_images(folder: Path) -> list[Path]:
    images = sorted([f for f in folder.iterdir() if f.suffix.lower() in SUPPORTED_FORMATS])
    if len(images) > MAX_IMAGES:
        print(f"  ⚠️ {len(images)} immagini, uso le prime {MAX_IMAGES}")
        images = images[:MAX_IMAGES]
    return images


def read_frontmatter(note_path: Path) -> dict:
    """Legge il frontmatter YAML dalla nota esistente."""
    if not note_path.exists():
        return {}
    text = note_path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.+?)\n---", text, re.DOTALL)
    if not m:
        return {}
    data = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            key, val = line.split(":", 1)
            val = val.strip().strip('"').strip("'")
            data[key.strip()] = val
    return data


def analyze(client: anthropic.Anthropic, name: str, images: list[Path], extra: dict) -> dict:
    content = []
    for img in images:
        data, mtype = encode_image(img)
        content.append({"type": "image", "source": {"type": "base64", "media_type": mtype, "data": data}})

    context = [f"Venue: {name}"]
    for field in ["address", "website", "email", "instagram", "rating", "reviews", "priority"]:
        if extra.get(field):
            context.append(f"{field.title()}: {extra[field]}")
    context.append(f"\n{len(images)} Instagram screenshots. Analyse and generate outreach emails.")
    content.append({"type": "text", "text": "\n".join(context)})

    response = client.messages.create(
        model=MODEL, max_tokens=2000, system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]

    result = json.loads(raw.strip())
    result["_tokens_in"] = response.usage.input_tokens
    result["_tokens_out"] = response.usage.output_tokens
    return result


def enrich_note(note_path: Path, result: dict):
    """Arricchisce una nota esistente con l'analisi e le email."""
    text = note_path.read_text(encoding="utf-8")
    today = datetime.now().strftime("%Y-%m-%d")
    analysis = result.get("analysis", {})
    total_score = analysis.get("total_score", 0)

    # Update frontmatter: set analyzed to true and add score
    text = re.sub(r'analyzed: false', 'analyzed: true', text)
    text = re.sub(r'(area: "[^"]*")', f'\\1\noutreach_score: {total_score}\nvenue_type: "{result.get("venue_type", "")}"\ncuisine: "{result.get("cuisine", "")}"\nanalysis_date: "{today}"', text)

    # Build analysis section
    score_fields = [
        ("🎨 Visual Quality", "visual_quality", 20),
        ("🎯 Consistency", "content_consistency", 20),
        ("🎬 Video Presence", "video_presence", 20),
        ("📅 Frequency", "posting_frequency", 15),
        ("💬 Engagement", "engagement_signals", 10),
        ("👤 Bio & Profile", "bio_profile", 15),
    ]

    analysis_section = [
        "## 📊 Analisi Instagram",
        "",
        f"> 📅 Analizzato il **{today}** | Score: **{total_score}/100**",
        "",
        "### Score Breakdown",
        "",
        "| Criterio | Punti | Max | Dettaglio |",
        "| --- | :---: | :---: | --- |",
    ]

    for label, key, max_score in score_fields:
        field = analysis.get(key, {})
        score = field.get("score", 0) if isinstance(field, dict) else 0
        note = field.get("note", "") if isinstance(field, dict) else ""
        bar = "█" * round(score / max_score * 10) + "░" * (10 - round(score / max_score * 10))
        analysis_section.append(f"| {label} | **{score}** | {max_score} | {bar} {note} |")

    analysis_section += [
        f"| **TOTALE** | **{total_score}** | **100** | |",
        "",
        "### 🏷️ Legenda Score",
        "",
        "| Range | Significato |",
        "| :---: | --- |",
        "| 80-100 | 🟢 Eccellente presenza — difficile da migliorare, ma possibile proporre contenuti premium |",
        "| 60-79 | 🟡 Buona base — hanno potenziale ma manca qualità professionale, specialmente nei video |",
        "| 40-59 | 🟠 Mediocre — contenuti inconsistenti, ottima opportunità per proporre servizi |",
        "| 0-39 | 🔴 Debole — quasi assente o molto amatoriale, alto bisogno ma potrebbero non avere budget |",
        "",
    ]

    if analysis.get("summary"):
        analysis_section += [f"> 💡 {analysis['summary']}", ""]

    has_vid = analysis.get("has_videographer", "unclear")
    vid_text = {"yes": "⚠️ Sembrano avere già un videographer", "no": "✅ Nessun videographer — ottima opportunità", "unclear": "❓ Non chiaro se hanno un videographer"}.get(has_vid, "❓")
    analysis_section += [f"> {vid_text}", ""]

    # Email sections
    analysis_section += [
        "---",
        "",
        "## 📧 Cold Email",
        "",
        f"**Subject:** {result.get('cold_email_subject', '')}",
        "",
        "```",
        result.get("cold_email_body", ""),
        "```",
        "",
        "## 📧 Follow-up Email",
        "",
        f"**Subject:** {result.get('followup_email_subject', '')}",
        "",
        "```",
        result.get("followup_email_body", ""),
        "```",
        "",
    ]

    # Replace the placeholder analysis section
    new_analysis = "\n".join(analysis_section)
    text = re.sub(
        r"## 📊 Analisi Instagram\n\n>.*?(?=\n---\n\n## 📝 Note)",
        new_analysis + "\n",
        text,
        flags=re.DOTALL
    )

    note_path.write_text(text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="UnFocus Prospect Analyzer")
    parser.add_argument("--vault", type=str, required=True)
    parser.add_argument("--prospect", type=str, help="Slug della cartella prospect")
    parser.add_argument("--list", action="store_true", help="Mostra prospect disponibili")
    args = parser.parse_args()

    vault_dir = Path(args.vault).expanduser()
    prospects_dir = vault_dir / "prospects"

    if not prospects_dir.exists():
        print(f"❌ Cartella prospects non trovata. Prima lancia obsidian_prospects.py")
        return

    if args.list:
        print(f"📁 Prospect in {prospects_dir}:\n")
        notes = sorted([f for f in prospects_dir.iterdir() if f.is_file() and f.suffix == ".md" and not f.name.startswith("_")])
        for n in notes:
            fm = read_frontmatter(n)
            name = fm.get("name", n.stem)
            status = fm.get("contact_status", "?")
            analyzed = fm.get("analyzed", "false") == "true"
            s_emoji = {"not-contacted": "🔴", "in-contact": "🟢", "no-answer": "🟠", "follow-up": "🔵"}.get(status, "⚪")
            a_emoji = "📋" if analyzed else "—"

            # Check for screenshots
            img_dir = prospects_dir / n.stem
            img_count = len([f for f in img_dir.iterdir() if f.suffix.lower() in SUPPORTED_FORMATS]) if img_dir.exists() else 0
            img_info = f"📸 {img_count}" if img_count > 0 else ""

            print(f"  {s_emoji} {a_emoji} {name:<40s} {img_info}")

        print(f"\n  📸 = ha screenshot pronti | 📋 = già analizzato")
        return

    if not args.prospect:
        print("❌ Specifica --prospect <slug> o usa --list")
        return

    # Find the note
    note_path = prospects_dir / f"{args.prospect}.md"
    if not note_path.exists():
        print(f"❌ Nota non trovata: {note_path}")
        print(f"   Prima lancia: python obsidian_prospects.py --csv richmond_venues.csv --vault '{vault_dir}'")
        return

    # Find screenshots - check for folder with same name
    img_dir = prospects_dir / args.prospect
    if not img_dir.exists():
        print(f"📁 Cartella screenshot non trovata.")
        print(f"   Creala e aggiungi gli screenshot:")
        print(f"   mkdir '{img_dir}'")
        print(f"   mv ~/Desktop/Screenshot*.jpg '{img_dir}/'")
        return

    images = get_images(img_dir)
    if not images:
        print(f"❌ Nessuna immagine in {img_dir}")
        return

    # Read existing frontmatter for context
    fm = read_frontmatter(note_path)
    name = fm.get("name", args.prospect.replace("-", " ").title())

    print(f"🔍 Analisi: {name} ({len(images)} screenshot)...")

    client = anthropic.Anthropic()

    try:
        result = analyze(client, name, images, fm)
    except Exception as e:
        print(f"❌ Errore: {e}")
        return

    tokens = result.get("_tokens_in", 0) + result.get("_tokens_out", 0)
    score = result.get("analysis", {}).get("total_score", "?")

    enrich_note(note_path, result)

    print(f"✅ Score: {score}/100 | Tokens: {tokens}")
    print(f"📋 Nota aggiornata: {note_path}")
    print(f"📧 Cold email + Follow-up incluse nella nota")


if __name__ == "__main__":
    main()
