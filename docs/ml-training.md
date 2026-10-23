# ShieldCaptcha ML training and rollout

## Current state
The production anti-automation decision is still the explainable rule engine. The optional random-forest runtime accepts a portable JSON artifact through `SHIELDCAPTCHA_ML_MODEL_PATH`, but this repository does not contain a trained production model. Do not claim ML enforcement is active until a real, labeled dataset passes the quality gates and the model has been independently reviewed.

## Dataset contract
Use a CSV with these columns:

```csv
label,userAgent,acceptLanguage,elapsedMs,attemptsCount,sameIpRecentCount,sameIpRecentFailureCount
```

- `label` must be `human` or `bot`, based on verified outcomes or carefully reviewed security investigations.
- Remove direct identifiers and secrets. Do not include IP addresses, site keys, challenge tokens, emails, URLs with query strings, or other unnecessary personal data. The two rate features should be precomputed aggregates.
- Include representative browsers, assistive technology, mobile networks, shared NATs, languages, and real automation. Avoid labeling a user as a bot solely because they use a VPN, are fast, or have a missing header.
- Never train on synthetic examples as if they were production observations.

## Train and evaluate
Use an isolated Python environment; this is an offline model-build dependency, not a runtime dependency:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-ml.txt
python scripts/train_captcha_model.py --input /secure/path/labeled-captcha.csv --output ./artifacts/shieldcaptcha-rf.json --metrics ./artifacts/evaluation.json
```

Training refuses datasets below 500 rows or below 100 examples in either class. It uses a stratified holdout set and refuses to write a model unless held-out human false-positive rate is at most 5% and bot recall is at least 85%. These are minimum gates, not proof of universal performance. Review confusion counts and performance across relevant subgroups before use.

## Shadow deployment
1. Store the reviewed artifact in a protected, persistent location and set `SHIELDCAPTCHA_ML_MODEL_PATH` to that exact file path.
2. Verify health reports `ready-shadow-only` and a model version. If it says `invalid-model` or `model-unavailable`, do not proceed.
3. Keep the model in shadow mode; compare its predictions with independently labeled outcomes for a meaningful observation window.
4. Evaluate drift, false positives, bot recall, latency, and subgroup performance. Obtain approval before any enforcement change; keep a rapid rollback to the rule-only scorer.
5. Never use the model's own predictions as ground-truth labels.

## Limits
The trainer only makes an artifact from data supplied by the operator. It does not manufacture labels, retrieve private user data, or make the model production-ready by itself. Real labeled data and live shadow evaluation are required before claiming the ML work is complete.


## Administrator review workflow

Use `GET /api/v1/admin/ml/status` to check reviewed row counts. An authenticated administrator can label a security event using `POST /api/v1/admin/ml/events/:id/label` with a `human` or `bot` label, then download the reviewed dataset from `GET /api/v1/admin/ml/training.csv`. Review context carefully: a failed CAPTCHA, fast solve, mobile browser, shared IP, VPN, or missing header alone does not prove automation. Never label an event based on the model prediction itself. The CSV export omits raw IP addresses and site keys.
