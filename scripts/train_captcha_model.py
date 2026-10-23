#!/usr/bin/env python3
"""Train a portable ShieldCaptcha random-forest artifact from explicitly labeled CSV data.

Input CSV columns:
label,userAgent,acceptLanguage,elapsedMs,attemptsCount,sameIpRecentCount,sameIpRecentFailureCount
label must be "bot" or "human". Do not feed secrets, raw URLs, email addresses, or other PII.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

FEATURE_NAMES = [
    "automationUserAgent",
    "missingUserAgent",
    "missingLanguage",
    "elapsedMs",
    "attemptsCount",
    "sameIpRecentCount",
    "sameIpRecentFailureCount",
]
AUTOMATION_RE = re.compile(
    r"headlesschrome|headlessfirefox|playwright|puppeteer|selenium|phantomjs|"
    r"python-requests|python-urllib|aiohttp|httpx/|(?:^|\s)(?:curl|wget)/|"
    r"scrapy|go-http-client|java/\d",
    re.IGNORECASE,
)
REQUIRED = {
    "label", "userAgent", "acceptLanguage", "elapsedMs", "attemptsCount",
    "sameIpRecentCount", "sameIpRecentFailureCount",
}


def number(row: dict[str, str], key: str, maximum: int, floor: bool = False) -> float:
    raw = (row.get(key) or "").strip()
    if not raw:
        raise ValueError(f"missing numeric value in {key}")
    value = float(raw)
    if not (value >= 0 and value < float("inf")):
        raise ValueError(f"invalid numeric value in {key}")
    if floor:
        value = float(int(value))
    return min(float(maximum), value)


def vector(row: dict[str, str]) -> list[float]:
    ua = (row.get("userAgent") or "")[:512]
    return [
        1.0 if AUTOMATION_RE.search(ua.lower()) else 0.0,
        0.0 if ua else 1.0,
        0.0 if (row.get("acceptLanguage") or "").strip() else 1.0,
        number(row, "elapsedMs", 120_000),
        number(row, "attemptsCount", 10, floor=True),
        number(row, "sameIpRecentCount", 1000, floor=True),
        number(row, "sameIpRecentFailureCount", 1000, floor=True),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Labeled CSV file")
    parser.add_argument("--output", required=True, type=Path, help="Output JSON model artifact")
    parser.add_argument("--metrics", type=Path, help="Optional path for held-out evaluation metrics JSON")
    parser.add_argument("--seed", type=int, default=20261023)
    args = parser.parse_args()

    try:
        with args.input.open("r", newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            columns = set(reader.fieldnames or [])
            missing = sorted(REQUIRED - columns)
            if missing:
                raise ValueError("CSV is missing required columns: " + ", ".join(missing))
            rows = list(reader)
        if len(rows) < 500:
            raise ValueError(f"Need at least 500 labeled examples; found {len(rows)}.")
        labels = []
        features = []
        for line, row in enumerate(rows, start=2):
            label = (row.get("label") or "").strip().lower()
            if label not in {"bot", "human"}:
                raise ValueError(f"line {line}: label must be bot or human")
            labels.append(1 if label == "bot" else 0)
            try:
                features.append(vector(row))
            except (ValueError, OverflowError) as exc:
                raise ValueError(f"line {line}: {exc}") from exc
        human_count = labels.count(0)
        bot_count = labels.count(1)
        if min(human_count, bot_count) < 100:
            raise ValueError(f"Need at least 100 examples per class; humans={human_count}, bots={bot_count}.")

        from sklearn.ensemble import RandomForestClassifier
        from sklearn.metrics import accuracy_score, confusion_matrix, precision_score, recall_score
        from sklearn.model_selection import train_test_split

        x_train, x_test, y_train, y_test = train_test_split(
            features, labels, test_size=0.25, random_state=args.seed, stratify=labels
        )
        model = RandomForestClassifier(
            n_estimators=64, max_depth=8, min_samples_leaf=5,
            class_weight="balanced_subsample", random_state=args.seed, n_jobs=-1,
        )
        model.fit(x_train, y_train)
        predicted = model.predict(x_test)
        tn, fp, fn, tp = confusion_matrix(y_test, predicted, labels=[0, 1]).ravel()
        fpr = fp / (fp + tn) if fp + tn else 1.0
        bot_recall = recall_score(y_test, predicted, pos_label=1, zero_division=0)
        metrics = {
            "schemaVersion": 1,
            "datasetRows": len(rows),
            "trainRows": len(y_train),
            "testRows": len(y_test),
            "humanRows": human_count,
            "botRows": bot_count,
            "accuracy": round(float(accuracy_score(y_test, predicted)), 5),
            "botPrecision": round(float(precision_score(y_test, predicted, pos_label=1, zero_division=0)), 5),
            "botRecall": round(float(bot_recall), 5),
            "humanFalsePositiveRate": round(float(fpr), 5),
            "confusionMatrix": {"trueHuman": int(tn), "falseBotFlag": int(fp), "missedBot": int(fn), "detectedBot": int(tp)},
            "modelType": "random-forest",
            "modelVersion": "shieldcaptcha-rf-" + str(args.seed),
            "thresholdPolicy": "default 0.5; shadow-only; human false-positive target <= 0.05 and bot recall target >= 0.85",
        }
        if fpr > 0.05 or bot_recall < 0.85:
            if args.metrics:
                args.metrics.parent.mkdir(parents=True, exist_ok=True)
                args.metrics.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
            raise ValueError(
                "Held-out quality gate failed: human false-positive rate must be <= 5% "
                "and bot recall must be >= 85%. No model artifact was written. "
                f"Observed FPR={fpr:.3f}, bot recall={bot_recall:.3f}."
            )

        portable_trees = []
        for estimator in model.estimators_:
            tree = estimator.tree_
            nodes = []
            for i in range(tree.node_count):
                counts = tree.value[i][0]
                total = float(sum(counts))
                bot_probability = float(counts[1] / total) if total else 0.5
                leaf = tree.children_left[i] == tree.children_right[i]
                nodes.append({
                    "feature": -1 if leaf else int(tree.feature[i]),
                    "threshold": float(tree.threshold[i]),
                    "left": int(tree.children_left[i]),
                    "right": int(tree.children_right[i]),
                    "botProbability": round(bot_probability, 8),
                })
            portable_trees.append({"nodes": nodes})

        artifact = {
            "schemaVersion": 1,
            "modelType": "random-forest",
            "modelVersion": metrics["modelVersion"],
            "featureNames": FEATURE_NAMES,
            "treeCount": len(portable_trees),
            "trees": portable_trees,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(artifact, separators=(",", ":")) + "\n", encoding="utf-8")
        if args.metrics:
            args.metrics.parent.mkdir(parents=True, exist_ok=True)
            args.metrics.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(metrics, indent=2))
        print(f"Model artifact written to {args.output}. Keep it shadow-only until independent review and rollout approval.")
        return 0
    except Exception as exc:
        print(f"Training refused: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
