# ShieldCaptcha geometric challenge models

ShieldCaptcha now issues only these visual challenge families:

- **PrismFlow**: identify the arrow sequence that rotates by a consistent quarter-turn in one direction.
- **Polygon Sequence**: identify the sequence where each polygon gains exactly one side at each step.
- **Polygon Count**: identify the pentagon among polygons with different side counts.

Legacy icon selection, odd-one-out icon grids, and rotated single-icon challenges are no longer selected or rendered by the challenge engine.

All choices are randomized server-side, and only the HMAC of the correct option identifier is persisted. The browser receives opaque option IDs and SVG data, not the correct answer. Challenges expire after 20 seconds and allow at most four incorrect attempts. These visual models are one layer of defense and are not a claim of complete bot immunity; the supervised ML pipeline remains shadow-only until trained and validated on reviewed labels.
