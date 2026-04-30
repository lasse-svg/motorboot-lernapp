#!/usr/bin/env python3
"""Parse the ELWIS Fragenkatalog Binnen text into structured JSON.

Output: data/questions.json with {id, section, category, question, answers[4]}
Section "basis" = 1-72, "binnen" = 73-253. Segeln (254-300) is skipped.
Correct answer is always index 0 (catalog convention) but is shuffled at runtime.
"""
import json
import re
from pathlib import Path

SRC = Path("/Users/lassegloy/Downloads/boot/katalog.txt")
OUT = Path("/Users/lassegloy/motorboot-lernapp/data/questions.json")

# Topic tags inferred by keyword (for Lernmodus filter)
TOPIC_RULES = [
    ("lichter",       ["topplicht", "hecklicht", "seitenlicht", "rundumlicht", "funkellicht", "lichterführung", "schlepplicht"]),
    ("schallzeichen", ["kurzer ton", "langer ton", "schallzeichen", "glocke", "nebelhorn", "schallsignal"]),
    ("vorfahrt",      ["vorfahrt", "ausweichen", "begegnen", "überholen", "kurs", "wegerecht", "kleinfahrzeug"]),
    ("schifffahrtszeichen", ["tafelzeichen", "schifffahrtszeichen", "tonne", "schwimmkörper", "fahrwassertonne", "verbotszeichen"]),
    ("schleuse",      ["schleuse", "schleusen"]),
    ("notfall",       ["notruf", "hilferuf", "rettung", "mensch über bord", "feuer", "unfall", "havarie"]),
    ("umwelt",        ["umwelt", "abfall", "abwasser", "öl", "treibstoff", "ölbinder", "verschmut"]),
    ("technik",       ["motor", "tank", "bilge", "kraftstoff", "batterie", "gas", "feuerlöscher"]),
    ("recht",         ["führerschein", "vorschrift", "verordnung", "berechtigung", "ausweis", "schiffsführer"]),
    ("wetter",        ["wind", "wetter", "sturm", "nebel", "gewitter", "windstärke"]),
    ("brücke",        ["brücke", "durchfahrt"]),
    ("anker",         ["anker", "festmach", "leine"]),
]

def tag_topics(text: str) -> list:
    t = text.lower()
    tags = []
    for tag, keys in TOPIC_RULES:
        if any(k in t for k in keys):
            tags.append(tag)
    return tags or ["allgemein"]


def parse():
    lines = SRC.read_text(encoding="utf-8").splitlines()

    questions = []
    i = 0
    n = len(lines)

    # Find first question start (line beginning with "1.")
    q_re = re.compile(r"^\s*(\d{1,3})\.\s+(.*)$")
    a_re = re.compile(r"^\s*([abcd])\.\s+(.*)$")

    current = None  # dict in progress
    current_field = None  # "question" or "a"/"b"/"c"/"d"

    def flush():
        if not current:
            return
        # Strip and post-process — also remove trailing breadcrumb/footer text
        trail_re = re.compile(r"\s+(ELWIS|Sie sind hier|Stand:|©\s*Wasserstraßen).*$", re.I)
        for k in ("question", "a", "b", "c", "d"):
            if k in current:
                v = re.sub(r"\s+", " ", current[k]).strip()
                v = trail_re.sub("", v)
                current[k] = v
        if all(k in current for k in ("question", "a", "b", "c", "d")):
            qid = current["id"]
            if qid <= 72:
                section = "basis"
            elif qid <= 253:
                section = "binnen"
            else:
                return  # skip Segeln
            questions.append({
                "id": qid,
                "section": section,
                "topics": tag_topics(current["question"] + " " + current["a"]),
                "question": current["question"],
                "answers": [current["a"], current["b"], current["c"], current["d"]],
            })

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        # Skip header/footer markers (be specific to avoid matching answer text)
        stripped = line.strip()
        if stripped.startswith("Stand:") or stripped.startswith("Sie sind hier") or "© Wasserstraßen-" in stripped or "Wasserstraßen- und Schifffahrtsverwaltung des Bundes" in stripped:
            continue
        if stripped in ("Basisfragen", "Spezifische Fragen Binnen", "Spezifische Fragen Segeln", "ELWIS"):
            continue
        if stripped == "Anmerkung:" or "Antwort a ist immer die richtige" in stripped:
            continue

        m_q = q_re.match(line)
        m_a = a_re.match(line)

        if m_q:
            num = int(m_q.group(1))
            # Sanity: question numbers 1..300, must be sequential-ish
            if 1 <= num <= 300:
                # Heuristic: only treat as new question if we don't already have a current one
                # waiting for answers, OR the text looks like a real question (ends with ? eventually)
                if current and current_field and current_field in ("a","b","c","d"):
                    # we're inside an answer; "1." inside an answer body is unlikely but possible.
                    # Only switch if num is exactly current+1 to avoid false positives.
                    if num == current["id"] + 1:
                        flush()
                        current = {"id": num, "question": m_q.group(2)}
                        current_field = "question"
                        continue
                    else:
                        # Treat as continuation of answer
                        current[current_field] += " " + line.strip()
                        continue
                flush()
                current = {"id": num, "question": m_q.group(2)}
                current_field = "question"
                continue
        if m_a and current is not None:
            letter = m_a.group(1)
            current[letter] = m_a.group(2)
            current_field = letter
            continue
        # Continuation line
        if current and current_field:
            current[current_field] += " " + line.strip()

    flush()
    # Sort and validate
    questions.sort(key=lambda q: q["id"])
    expected = list(range(1, 254))
    got_ids = [q["id"] for q in questions]
    missing = sorted(set(expected) - set(got_ids))
    extras = sorted(set(got_ids) - set(expected))
    print(f"Parsed {len(questions)} questions. Missing: {missing}. Extras (segeln/etc): {extras}")
    OUT.write_text(json.dumps(questions, ensure_ascii=False, indent=1), encoding="utf-8")
    # Also emit a JS file so the app works under file:// without fetch (CORS).
    JS_OUT = OUT.parent / "questions.js"
    JS_OUT.write_text("window.QUESTIONS = " + json.dumps(questions, ensure_ascii=False) + ";", encoding="utf-8")
    print(f"Wrote {OUT} and {JS_OUT}")

if __name__ == "__main__":
    parse()
