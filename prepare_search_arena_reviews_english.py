#!/usr/bin/env python3
"""Prepare 500 ENGLISH-ONLY, UNVOTED Search Arena comparisons.

Requires: pip install pandas numpy pyarrow datasets langdetect

Examples:
    python prepare_search_arena_reviews_english.py --source-hf --outdir review_batch_english
    python prepare_search_arena_reviews_english.py --parquet ./search-arena-chat-24k.parquet --outdir review_batch_english

This script does not upload data, create votes, or configure Vercel/Supabase.
Third reviewers are intentionally assigned by the app *after* conflicting votes.
"""

from __future__ import annotations

import argparse
from collections import Counter
from itertools import combinations
import json
import math
from pathlib import Path
import random
import re
import ast

from langdetect import DetectorFactory, detect_langs, LangDetectException
DetectorFactory.seed = 0
from typing import Any

import pandas as pd

N_REVIEWERS = 5
N_OBSERVATIONS = 500
SEED = 20261026


def is_missing_preference(value: Any) -> bool:
    """Missing vote, not an explicit tie or both-bad vote."""
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip().lower() in {"", "nan", "null", "none"}
    if isinstance(value, (list, tuple, dict)):
        return False
    try:
        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def as_plain_json(value: Any) -> Any:
    if hasattr(value, "tolist") and not isinstance(value, (str, bytes)):
        return as_plain_json(value.tolist())
    if isinstance(value, dict):
        return {str(k): as_plain_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_plain_json(v) for v in value]
    if value is None:
        return None
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def normalized_messages(raw: Any) -> list[dict[str, str]]:
    raw = as_plain_json(raw)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list):
        return []
    result = []
    for message in raw:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "").lower()
        content = message.get("content")
        if isinstance(content, list):
            content = "\n".join(
                str(fragment.get("text", "")) if isinstance(fragment, dict) else str(fragment)
                for fragment in content
            )
        if content is None:
            content = ""
        result.append({"role": role, "content": str(content)})
    return result


def last_role(messages: list[dict[str, str]], role: str) -> tuple[str, int]:
    for i in range(len(messages) - 1, -1, -1):
        if messages[i]["role"] == role and messages[i]["content"].strip():
            return messages[i]["content"], i
    return "", -1



def listed_language_codes(value: Any) -> list[str]:
    """Extract code(s) from Search Arena's ordered language-code lists.

    Unknown/missing labels are rejected, not guessed to be English.
    Multilingual entries are rejected even when English is the first code.
    """
    value = as_plain_json(value)
    if isinstance(value, str):
        raw = value.strip()
        if raw.startswith("[") or raw.startswith("{"):
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                try:
                    value = ast.literal_eval(raw)
                except (ValueError, SyntaxError):
                    return []
        else:
            value = [raw]
    if isinstance(value, dict):
        key = next((k for k in ("languages", "language", "lang", "code", "label") if k in value), None)
        if key is None:
            return []
        return listed_language_codes(value[key])
    if not isinstance(value, (tuple, list)):
        return []
    values = []
    for entry in value:
        if isinstance(entry, (list, tuple, dict)):
            nested = listed_language_codes(entry)
            if not nested:
                return []
            values.extend(nested)
        elif isinstance(entry, str):
            text = entry.strip().lower().replace("_", "-")
            if not text:
                return []
            values.append(text)
        else:
            return []
    return values


def is_english_only_label(value: Any) -> bool:
    codes = listed_language_codes(value)
    return bool(codes) and all(c in {"en", "eng", "english"} or c.startswith("en-") for c in codes)


def response_is_english(text: str) -> bool:
    """Conservative automatic screen for substantial non-English responses.

    Short answers have too little language signal: trust the conversation label
    unless clearly using another script. Document this uncertainty in report.
    """
    if not text or not text.strip():
        return False
    # Avoid having code blocks, citation URLs and formatting dominate detection.
    cleaned = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    cleaned = re.sub(r"https?://\S+|www\.\S+", " ", cleaned)
    cleaned = re.sub(r"`[^`]*`", " ", cleaned)
    cleaned = re.sub(r"\[[0-9, ]+\]", " ", cleaned)
    cleaned = cleaned.strip()[:6000]
    # Significant non-Latin script strongly suggests a non-English response.
    foreign_script = len(re.findall(r"[\u0400-\u04ff\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]",cleaned))
    if foreign_script > 12:
        return False
    # Short strings such as dates, calculations or brief replies cannot
    # be classified reliably. Preserve them rather than bias toward long answers.
    letters = len(re.findall(r"[A-Za-z]",cleaned))
    if letters < 60:
        return True
    try:
        probabilities = detect_langs(cleaned)
        return any(x.lang == "en" and x.prob >= 0.80 for x in probabilities)
    except LangDetectException:
        return letters < 150

def build_eligible_rows(data: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    required = {"winner", "messages_a", "messages_b", "primary_intent", "languages"}
    absent = required - set(data.columns)
    if absent:
        raise ValueError(f"Input is missing required columns: {sorted(absent)}")
    data = data.reset_index(drop=True).copy()
    data["source_row_id"] = data.index.astype(int)
    missing = data["winner"].map(is_missing_preference)
    candidates = data.loc[missing].copy()
    no_vote_count = len(candidates)
    english = candidates["languages"].map(is_english_only_label)
    candidates = candidates.loc[english].copy()
    english_metadata_count = len(candidates)
    parsed_a, parsed_b, prompts, answers_a, answers_b = [], [], [], [], []
    valid = []
    for row in candidates.itertuples(index=False):
        a = normalized_messages(row.messages_a)
        b = normalized_messages(row.messages_b)
        prompt_a, _ = last_role(a, "user")
        prompt_b, _ = last_role(b, "user")
        answer_a, _ = last_role(a, "assistant")
        answer_b, _ = last_role(b, "assistant")
        parsed_a.append(a)
        parsed_b.append(b)
        prompts.append(prompt_a or prompt_b)
        answers_a.append(answer_a)
        answers_b.append(answer_b)
        valid.append(bool((prompt_a or prompt_b).strip() and answer_a.strip() and answer_b.strip())
                     and response_is_english(answer_a) and response_is_english(answer_b))
    candidates["_a"] = parsed_a
    candidates["_b"] = parsed_b
    candidates["_prompt"] = prompts
    candidates["_answer_a"] = answers_a
    candidates["_answer_b"] = answers_b
    candidates = candidates.loc[valid].copy()
    candidates["_intent"] = candidates["primary_intent"].map(lambda x: str(x) if x is not None and str(x) else "Unknown")
    return candidates, {
        "source_rows": len(data),
        "missing_vote_rows": no_vote_count,
        "english_metadata_rows_without_votes": english_metadata_count,
        "english_metadata_rows_with_two_english_responses": len(candidates),
        "eligible_with_two_responses": len(candidates),
    }


def proportional_stratified_sample(eligible: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    """Largest-remainder allocation proportional to primary intent counts."""
    if len(eligible) < n:
        raise ValueError(f"Need {n} eligible observations; only {len(eligible)} found.")
    counts = eligible["_intent"].value_counts().sort_index()
    exact = counts * n / len(eligible)
    quotas = exact.map(math.floor).astype(int)
    remainder = n - int(quotas.sum())
    by_remainder = sorted(counts.index, key=lambda name: (-(exact[name] - quotas[name]), name))
    for name in by_remainder[:remainder]:
        quotas[name] += 1
    rng = random.Random(seed)
    pieces = []
    for intent, quota in quotas.items():
        if quota:
            pieces.append(eligible[eligible["_intent"] == intent].sample(n=int(quota), random_state=rng.randrange(2**32)))
    chosen = pd.concat(pieces, ignore_index=True)
    return chosen.sample(frac=1, random_state=rng.randrange(2**32)).reset_index(drop=True)


def prepare(data: pd.DataFrame, n: int = N_OBSERVATIONS, seed: int = SEED):
    if n % 10 != 0:
        raise ValueError("For exact pair balance across five reviewers, sample size must be a multiple of 10.")
    eligible, counts = build_eligible_rows(data)
    sample = proportional_stratified_sample(eligible, n, seed)
    rng = random.Random(seed + 1)
    pairs = list(combinations(range(1, N_REVIEWERS + 1), 2))
    pair_plan = pairs * (n // len(pairs))
    rng.shuffle(pair_plan)
    items, assignments, private_lookup = [], [], []
    for i, (_, row) in enumerate(sample.iterrows(), 1):
        item_id = f"ARENA-{i:04d}"
        # Public review content contains no model identities or existing votes.
        item = {
            "id": item_id,
            "source_row_id": int(row["source_row_id"]),
            "primary_intent": row["_intent"],
            "languages": as_plain_json(row.get("languages")),
            "prompt": row["_prompt"],
            "response_a": row["_answer_a"],
            "response_b": row["_answer_b"],
            "conversation_a": row["_a"],
            "conversation_b": row["_b"],
        }
        items.append(item)
        private_lookup.append({
            "id": item_id,
            "source_row_id": int(row["source_row_id"]),
            "model_a": as_plain_json(row.get("model_a")),
            "model_b": as_plain_json(row.get("model_b")),
        })
        for reviewer in pair_plan[i - 1]:
            left = "a" if rng.random() < 0.5 else "b"
            assignments.append({
                "observation_id": item_id,
                "reviewer_id": f"reviewer_{reviewer}",
                "stage": "initial",
                "left_response": left,
                "right_response": "b" if left == "a" else "a",
            })
    per_reviewer = Counter(row["reviewer_id"] for row in assignments)
    per_pair = Counter(pair_plan)
    assert len(items) == n and len(assignments) == 2*n
    assert len(per_pair) == 10 and set(per_pair.values()) == {n//10}
    assert set(per_reviewer.values()) == {2*n//5}
    report = {
        **counts,
        "selected_observations": n,
        "only_missing_preference": True,
        "english_only": True,
        "english_filter": "All detected language metadata codes must be English; last assistant replies on both sides screened with langdetect",
        "response_language_check": "langdetect",
        "response_language_check_limits": "Replies with fewer than 60 Latin letters cannot be reliably classified; non-Latin script is checked; manually audit sample",
        "seed": seed,
        "stratification": "proportional allocation by primary_intent",
        "intent_counts_in_sample": dict(Counter(x["primary_intent"] for x in items)),
        "review_assignments": len(assignments),
        "initial_votes_per_reviewer": dict(sorted(per_reviewer.items())),
        "assignments_per_pair": {f"{a}+{b}": number for (a,b), number in sorted(per_pair.items())},
        "third_reviewers": "assigned dynamically on disagreements, from 3 eligible reviewers with lowest current load",
    }
    return items, assignments, private_lookup, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--parquet", type=Path, help="Local parquet path")
    source.add_argument("--source-hf", action="store_true", help="Download the public Search Arena 24k test split")
    parser.add_argument("--outdir", type=Path, default=Path("review_batch_english"))
    parser.add_argument("--n", type=int, default=N_OBSERVATIONS)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()
    if args.parquet:
        data = pd.read_parquet(args.parquet)
    else:
        from datasets import load_dataset
        data = load_dataset("lmarena-ai/search-arena-24k", split="test").to_pandas()
    items, assignments, lookup, report = prepare(data, args.n, args.seed)
    args.outdir.mkdir(parents=True, exist_ok=True)
    (args.outdir / "review_items.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    pd.DataFrame(assignments).to_csv(args.outdir / "initial_assignments.csv", index=False)
    (args.outdir / "private_model_lookup.json").write_text(json.dumps(lookup, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.outdir / "sampling_manifest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    # A reproducible random audit of 30 comparisons to review before upload.
    audit_rng = random.Random(args.seed + 2)
    audit = [items[j] for j in audit_rng.sample(range(len(items)), min(30, len(items)))]
    pd.DataFrame([{
        "id": x["id"], "source_row_id": x["source_row_id"],
        "primary_intent": x["primary_intent"], "languages": str(x["languages"]),
        "prompt_excerpt": x["prompt"][:600],
        "response_a_excerpt": x["response_a"][:1200],
        "response_b_excerpt": x["response_b"][:1200],
    } for x in audit]).to_csv(args.outdir / "english_audit_sample.csv", index=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    print(f"\nOutput written to: {args.outdir.resolve()}")
    print("IMPORTANT: Keep private_model_lookup.json server-side, never inside a public/ folder.")
    print("Before uploading, spot-check english_audit_sample.csv (30 random observations).")

if __name__ == "__main__":
    main()
