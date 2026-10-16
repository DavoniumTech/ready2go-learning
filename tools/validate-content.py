#!/usr/bin/env python3
"""Validate Ready2Go local question packs using only the Python standard library."""
from __future__ import annotations
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REQUIRED = {"id", "subjectId", "topic", "type", "sourceType", "sourceLabel", "difficulty", "question", "options", "correctAnswer", "explanation", "reviewStatus"}
OPTIONS = {"A", "B", "C", "D"}
errors: list[str] = []
warnings: list[str] = []

def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"{path.relative_to(ROOT)}: invalid JSON ({exc})")
        return None

manifest = load_json(DATA / "manifest.json")
subjects_doc = load_json(DATA / "subjects.json")
if not isinstance(manifest, dict) or not isinstance(subjects_doc, dict):
    print("Content validation cannot continue because a required metadata file failed to load.")
    sys.exit(1)
known_subjects = {x.get("id") for x in subjects_doc.get("subjects", []) if isinstance(x, dict)}
total = 0
review_statuses: dict[str, int] = {}
all_ids: set[str] = set()

for entry in manifest.get("packs", []):
    filename = entry.get("file")
    subject_id = entry.get("subjectId")
    if not isinstance(filename, str) or Path(filename).name != filename:
        errors.append(f"Manifest entry for {subject_id!r} has an invalid file name.")
        continue
    pack = load_json(DATA / filename)
    if not isinstance(pack, dict):
        continue
    questions = pack.get("questions")
    if pack.get("subjectId") != subject_id:
        errors.append(f"{filename}: pack subject ID does not match manifest.")
    if subject_id not in known_subjects:
        errors.append(f"{filename}: subject ID is missing from subjects.json.")
    if not isinstance(questions, list):
        errors.append(f"{filename}: questions must be a JSON array.")
        continue
    if entry.get("questionCount") != len(questions):
        errors.append(f"{filename}: manifest questionCount={entry.get('questionCount')} but actual={len(questions)}.")
    if pack.get("questionCount") != len(questions):
        errors.append(f"{filename}: pack questionCount={pack.get('questionCount')} but actual={len(questions)}.")
    ids: set[str] = set()
    for index, question in enumerate(questions, start=1):
        where = f"{filename} question #{index}"
        if not isinstance(question, dict):
            errors.append(f"{where}: must be an object.")
            continue
        missing = REQUIRED - question.keys()
        if missing:
            errors.append(f"{where}: missing fields {sorted(missing)}.")
        qid = question.get("id")
        if not isinstance(qid, str) or not qid:
            errors.append(f"{where}: missing stable ID.")
        elif qid in ids:
            errors.append(f"{where}: duplicate question ID {qid!r} in this pack.")
        else:
            ids.add(qid)
        if qid in all_ids:
            warnings.append(f"{where}: ID {qid!r} also appears in another pack; keep IDs globally unique when possible.")
        if isinstance(qid, str):
            all_ids.add(qid)
        if question.get("subjectId") != subject_id:
            errors.append(f"{where}: subject ID does not match its pack.")
        if set(question.get("options", {})) != OPTIONS:
            errors.append(f"{where}: options must contain exactly A, B, C and D.")
        if question.get("correctAnswer") not in OPTIONS:
            errors.append(f"{where}: correctAnswer must be A, B, C or D.")
        for field in ("topic", "question", "explanation", "sourceLabel"):
            if not isinstance(question.get(field), str) or not question.get(field, "").strip():
                errors.append(f"{where}: {field} must be non-empty text.")
        review = question.get("reviewStatus", "missing")
        review_statuses[review] = review_statuses.get(review, 0) + 1
        if review != "approved":
            warnings.append(f"{where}: reviewStatus is {review!r}; not ready for remote publication.")
    total += len(questions)

print(f"Ready2Go content check: {len(manifest.get('packs', []))} packs, {total} questions")
print("Review-status totals: " + ", ".join(f"{status}={count}" for status, count in sorted(review_statuses.items())))
print(f"Errors: {len(errors)}; review warnings: {len(warnings)}")
for msg in errors[:100]: print("ERROR:", msg)
for msg in warnings[:30]: print("REVIEW:", msg)
if len(warnings) > 30: print(f"... {len(warnings) - 30} additional review warnings omitted")
if errors:
    sys.exit(1)
print("Structure checks passed. This is not a subject-matter correctness or copyright review.")
