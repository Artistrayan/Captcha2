# ShieldCaptcha ML pipeline

This directory provides a real, reproducible supervised-model training path. It intentionally does **not** ship a fake trained model or label existing CAPTCHA success/failure as ground truth.

## Current status

- The production TypeScript rules engine remains authoritative.
- A Random Forest model can be trained from reviewed, labeled JSONL examples.
- The TypeScript runtime loads `ml/model.json` only if a trained artifact exists.
- Model predictions are shadow-only; they must not block users.
- Do not commit raw IPs, emails, cookies, tokens, user-agent strings, or unreviewed customer logs.

## Training examples

Each JSONL line is one reviewed event:

```json
{"label":"bot","timestamp":"2026-10-22T10:00:00Z","siteGroup":"site-a","features":{"automationUserAgent":1,"missingUserAgent":0,"missingLanguage":0,"elapsedMs":120,"attemptsCount":0,"sameIpRecentCount":8,"sameIpRecentFailureCount":6}}
{"label":"human","timestamp":"2026-10-22T10:01:00Z","siteGroup":"site-b","features":{"automationUserAgent":0,"missingUserAgent":0,"missingLanguage":0,"elapsedMs":4200,"attemptsCount":0,"sameIpRecentCount":1,"sameIpRecentFailureCount":0}}
```

These are schema examples only, not training data. Labels must come from reviewed, independent evidence. A correct answer alone is not proof of a human, and a failed answer alone is not proof of a bot.

## Train

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r ml/requirements.txt
python ml/train.py --input /secure/path/reviewed-events.jsonl --output ml/model.json
```

The trainer requires at least 200 labeled examples and at least 50 examples per class, keeps a holdout set, prints precision/recall/false-positive metrics, and writes a versioned portable tree model. Use time-separated data when timestamps are available. Review results before deploying the artifact.

## Runtime

When a validated artifact is available, set `SHIELDCAPTCHA_ML_MODEL_PATH=ml/model.json`. The runtime returns a prediction only; production decisions remain controlled by the existing deterministic policy until a separate, approved rollout changes that behavior.

## Privacy and release gates

- Keep only coarse features required for abuse prevention.
- Use short retention and access controls for source evidence.
- Do not use raw identifiers as model features.
- Review performance by device, browser, language, and accessibility usage.
- Run shadow mode, canary, rollback, and red-team tests before enforcement.


## Prepare a review dataset from the existing PostgreSQL database

The repository currently has no reviewed human/bot labels, and existing verification records do not retain browser user-agent or language snapshots. Exporting existing events therefore creates **review candidates only**, not training data.

Install dependencies in a private environment and keep the database URL out of shell history and source control:

```bash
pip install -r ml/requirements.txt
export DATABASE_URL='your-private-postgres-connection-string'
python ml/export_review_candidates.py --output /secure/path/review-candidates.csv --since-days 30
unset DATABASE_URL
```

The exporter aggregates recent same-IP activity in SQL but never writes IPs or CAPTCHA tokens into the CSV. The `label`, `userAgent`, and `acceptLanguage` columns are intentionally blank because those facts are not stored in the current schema. A reviewer must add a human/bot label only where independent evidence exists and fill missing features only from a legitimate source. Otherwise discard the row. Do not infer a label from the CAPTCHA result alone.

The existing database currently has fewer than the trainer's minimum 200 labeled examples, and no verified labels were found in its schema. A production-quality model cannot be truthfully trained until a sufficiently large, representative, independently labeled dataset exists. The model remains shadow-only.
