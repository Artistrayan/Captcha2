# ShieldCaptcha PrismFlow: Next-Generation Anti-Bot Design

Status: design proposal only. Not deployed and not a trained ML model.

## Goal

Move ShieldCaptcha from a rules-only score plus fixed icon selection to a privacy-minimizing, adaptive verification system. No CAPTCHA is unbreakable, and no global first-place claim is supportable without independent benchmarks. The target is measurable resistance to automation, low human friction, accessibility, and continuous improvement.

## Research synthesis

Public guidance converges on layered controls rather than a single puzzle: edge/network signals and rate limits; browser/environment consistency; session and endpoint behavior; adaptive challenges; server-side, single-use validation; privacy-minimized telemetry; and evaluation against false positives. See OWASP Bot Management, Cloudflare Turnstile and bot-detection docs, AWS WAF Bot Control, IETF RFC 9421, and Google's experimental Web Bot Auth guidance. These are references, not endorsements or integrations.

## Proposed differentiated challenge family: PrismFlow

PrismFlow is a procedurally generated relational-interaction challenge, not a static image grid. Each challenge is derived from a server-generated cryptographically random seed and a short-lived task specification.

1. Generate a small scene from vector primitives: shape, orientation, count, relative position, and transformation.
2. Ask the visitor to identify or complete a relation across the scene, for example select the item that follows a rotation/reflection rule or arrange a short transformation chain.
3. Randomize scene, rule, distractors, order, and rendering parameters per challenge. Never reuse a static answer or expose the generation seed or answer.
4. Measure only coarse task features needed for security: task-duration bucket, action count, ordering validity, retries, challenge transitions, and session/request consistency. Do not record raw mouse trajectories, keystrokes, canvas/audio fingerprints, or page contents by default.
5. If confidence remains low, escalate to an accessible alternate task; if risk is elevated, optionally add bounded proof-of-work (PoW). PoW raises automation cost but is not proof of humanity.
6. Issue a short-lived, site-bound, action-bound, single-use receipt after server-side verification.

The challenge diversifies the task distribution and raises the cost of static answer farms. It must be evaluated against vision-language models, browser automation, solver farms, low-end devices, touch devices, and assistive technology before being called effective.

## Decision architecture

Use a calibrated ensemble, not one opaque score.

- Layer A — deterministic safety rules: request validation, expiry/replay protection, site/domain binding, endpoint-specific rate limits, known automation indicators.
- Layer B — supervised model: start with a gradient-boosted tree model over tabular, minimized features. Train only on appropriately labeled events and split train/test data by time and site to prevent leakage.
- Layer C — anomaly detector: flag novel traffic distributions for step-up review; never automatically declare a human to be a bot solely from anomaly.
- Layer D — policy: allow, step-up, rate-limit, soft-block, or block. High-impact blocks require high confidence and multiple independent signals. Browser privacy settings alone must not cause a hard block.
- Layer E — monitoring: calibration, precision/recall, false-positive rate, challenge completion, p50/p95 latency, accessibility outcomes, and drift.

Start ML in shadow mode: record model scores and evaluation metrics without changing production decisions. Enable staged enforcement only after a representative validation set and rollback controls exist.

## Data contract for model training

Store feature records, not unnecessary personal data:
- event timestamp bucket, site ID, endpoint category, challenge family/version;
- elapsed-time bucket, attempt count, challenge escalation, completion outcome;
- coarse request/session velocity buckets and rate-limit outcomes;
- server-verified outcome label plus label provenance and confidence;
- current heuristic score/signals and model version.

Do not treat a successful image answer as definitive proof of a human. Use multiple evidence sources, keep unknown labels, and prevent a model from training on its own unverified predictions. Keep raw network identifiers only as long as operationally necessary; use short-lived keyed hashes where cross-event correlation is required. Document retention and lawful processing before collecting any new client-side telemetry.

## Training and release gates

1. Audit existing event tables and quantify label quality, class balance, missing fields, and duplicate/replayed events.
2. Build a versioned offline dataset export with PII minimization and label provenance.
3. Train a baseline model and compare it with the current rules engine on a time-separated holdout set.
4. Report ROC-AUC and PR-AUC, but prioritize false-positive rate at the chosen operating point, precision on high-risk blocks, calibration, and latency.
5. Red-team with scripted browsers, headless automation, replay attempts, proxy rotation, solver-assisted attempts, and legitimate accessibility/privacy browsers.
6. Run shadow mode, then small canary rollout with a kill switch and model rollback.
7. Retrain only when enough reviewed labels exist; keep reproducible data/model versions and audit trails.

## Initial acceptance criteria (provisional; validate against actual traffic)

- No challenge accepted twice; no expired or cross-site receipt accepted.
- No client-supplied score can influence server-side authorization.
- All model outputs have a model version and reason/feature-group trace.
- Shadow mode does not change allow/block decisions.
- A high-risk hard block requires independent evidence; uncertain cases receive step-up instead.
- A documented accessible alternative exists for each challenge family.
- Evaluation is stratified by browser family, device class, language, and assistive-technology testing where feasible.
- Performance, false-positive rate, and solve rate are reported from measured traffic, never invented.

## Known blockers

- Current rules-based risk scoring is not ML.
- Existing verification events may not contain enough reliable labels or behavior features for training.
- A production model cannot honestly be described as trained or world-leading until data quality, benchmark results, and red-team evaluation are available.
- A separate model-serving process or embedded inference runtime must be chosen based on measured latency and hosting budget; do not add a fragile network dependency before testing.

## References

- OWASP, Bot Management and Anti-Automation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Bot_Management_and_Anti-Automation_Cheat_Sheet.html
- Cloudflare Turnstile: https://developers.cloudflare.com/turnstile/
- Cloudflare bot detection engines: https://developers.cloudflare.com/bots/concepts/bot-detection-engines/
- AWS WAF Bot Control: https://docs.aws.amazon.com/waf/latest/developerguide/waf-bot-control.html
- IETF RFC 9421, HTTP Message Signatures: https://www.rfc-editor.org/rfc/rfc9421.html
- Google Web Bot Auth (experimental): https://developers.google.com/crawling/docs/crawlers-fetchers/web-bot-auth
