#!/usr/bin/env python3
"""Train a portable Random Forest only from reviewed, labeled JSONL examples."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

FEATURES = [
    "automationUserAgent",
    "missingUserAgent",
    "missingLanguage",
    "elapsedMs",
    "attemptsCount",
    "sameIpRecentCount",
    "sameIpRecentFailureCount",
]
LABELS = {"human": 0, "bot": 1}


def read_examples(path: Path):
    rows, labels, groups, timestamps = [], [], [], []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            label = record["label"]
            features = record["features"]
            if label not in LABELS:
                raise ValueError("label must be 'human' or 'bot'")
            row = [float(features[name]) for name in FEATURES]
            if not all(np.isfinite(value) for value in row):
                raise ValueError("feature values must be finite")
            if row[0] not in (0.0, 1.0) or row[1] not in (0.0, 1.0) or row[2] not in (0.0, 1.0):
                raise ValueError("binary features must be 0 or 1")
            if any(value < 0 for value in row[3:]):
                raise ValueError("numeric behavior features cannot be negative")
            rows.append(row)
            labels.append(LABELS[label])
            groups.append(str(record.get("siteGroup", "unknown")))
            timestamps.append(record.get("timestamp"))
        except Exception as exc:
            raise ValueError(f"Invalid JSONL at line {line_number}: {exc}") from exc
    return np.asarray(rows, dtype=float), np.asarray(labels, dtype=int), groups, timestamps


def export_tree(estimator):
    tree = estimator.tree_
    nodes = []
    for i in range(tree.node_count):
        counts = tree.value[i][0].astype(float).tolist()
        total = sum(counts)
        bot_probability = counts[1] / total if total else 0.5
        nodes.append({
            "feature": int(tree.feature[i]),
            "threshold": float(tree.threshold[i]) if tree.feature[i] >= 0 else 0.0,
            "left": int(tree.children_left[i]),
            "right": int(tree.children_right[i]),
            "botProbability": float(bot_probability),
        })
    return {"nodes": nodes}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    x, y, groups, timestamps = read_examples(args.input)
    counts = np.bincount(y, minlength=2)
    if len(y) < 200 or counts.min() < 50:
        raise SystemExit(
            f"Refusing to train: need >=200 reviewed examples and >=50 per class; "
            f"got total={len(y)}, human={counts[0]}, bot={counts[1]}."
        )
    if len(set(groups)) < 2:
        print("WARNING: examples cover fewer than two site groups; cross-site generalization is untested.", file=sys.stderr)

    # Prefer a chronological holdout if all examples have parseable timestamps.
    parsed = []
    for value in timestamps:
        try:
            parsed.append(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp())
        except Exception:
            parsed = []
            break
    if parsed:
        order = np.argsort(np.asarray(parsed))
        split = int(len(order) * 0.8)
        train_idx, test_idx = order[:split], order[split:]
        if len(set(y[train_idx])) < 2 or len(set(y[test_idx])) < 2:
            train_idx, test_idx = train_test_split(
                np.arange(len(y)), test_size=0.2, random_state=42, stratify=y
            )
            print("WARNING: chronological split lacked both classes; used stratified random holdout.", file=sys.stderr)
    else:
        train_idx, test_idx = train_test_split(
            np.arange(len(y)), test_size=0.2, random_state=42, stratify=y
        )
        print("WARNING: timestamps missing; reported holdout is random, not temporal.", file=sys.stderr)

    model = RandomForestClassifier(
        n_estimators=120,
        max_depth=8,
        min_samples_leaf=3,
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(x[train_idx], y[train_idx])
    probabilities = model.predict_proba(x[test_idx])[:, 1]
    predictions = (probabilities >= 0.8).astype(int)
    tn, fp, fn, tp = confusion_matrix(y[test_idx], predictions, labels=[0, 1]).ravel()
    metrics = {
        "holdoutExamples": int(len(test_idx)),
        "precisionBotAtThreshold080": float(precision_score(y[test_idx], predictions, zero_division=0)),
        "recallBotAtThreshold080": float(recall_score(y[test_idx], predictions, zero_division=0)),
        "humanFalsePositiveRateAtThreshold080": float(fp / (fp + tn)) if (fp + tn) else None,
        "rocAuc": float(roc_auc_score(y[test_idx], probabilities)) if len(set(y[test_idx])) == 2 else None,
        "prAuc": float(average_precision_score(y[test_idx], probabilities)) if len(set(y[test_idx])) == 2 else None,
        "threshold": 0.8,
        "confusionMatrix": {"trueHuman": int(tn), "falseBot": int(fp), "missedBot": int(fn), "trueBot": int(tp)},
    }
    artifact = {
        "schemaVersion": 1,
        "modelType": "random-forest",
        "modelVersion": datetime.utcnow().strftime("%Y%m%dT%H%M%SZ"),
        "featureNames": FEATURES,
        "labelMeaning": {"0": "human", "1": "bot"},
        "treeCount": len(model.estimators_),
        "metrics": metrics,
        "trees": [export_tree(tree) for tree in model.estimators_],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "trainingExamples": int(len(train_idx)), "metrics": metrics}, indent=2))


if __name__ == "__main__":
    main()
