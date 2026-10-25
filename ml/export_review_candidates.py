#!/usr/bin/env python3
"""Export privacy-minimized CAPTCHA events for independent human/bot review.

This does NOT label events and its output is NOT train-ready. Existing event tables
do not store user-agent/language snapshots, so those fields are left blank. Reviewers
must fill label only from independent evidence; never infer bot solely from a failed
challenge or human solely from a successful challenge.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

import psycopg

FIELDS = [
    "label",
    "userAgent",
    "acceptLanguage",
    "elapsedMs",
    "attemptsCount",
    "sameIpRecentCount",
    "sameIpRecentFailureCount",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--since-days", type=int, default=30)
    args = parser.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is required in the environment.", file=sys.stderr)
        return 2
    if args.since_days < 1 or args.since_days > 365:
        print("--since-days must be between 1 and 365.", file=sys.stderr)
        return 2

    query = """
      SELECT
        cc.created_at,
        cc.attempts_count,
        COALESCE(ve.client_ip, '') AS client_ip,
        COALESCE(ve.success, FALSE) AS success,
        ve.created_at AS event_at
      FROM verification_events ve
      JOIN captcha_challenges cc ON cc.token = ve.token
      WHERE ve.created_at >= NOW() - (%s * INTERVAL '1 day')
      ORDER BY ve.created_at ASC
    """
    with psycopg.connect(dsn, connect_timeout=15) as conn:
        rows = conn.execute(query, (args.since_days,)).fetchall()
        events = []
        for created_at, attempts, client_ip, success, event_at in rows:
            recent_count = 0
            recent_failures = 0
            if client_ip:
                # Use IP only in memory for aggregation; never write it to the CSV.
                for other_created, other_ip, other_success in conn.execute(
                    """
                    SELECT created_at, client_ip, success
                    FROM verification_events
                    WHERE created_at BETWEEN %s - INTERVAL '1 hour' AND %s
                    """,
                    (event_at, event_at),
                ).fetchall():
                    if other_ip and other_ip == client_ip:
                        recent_count += 1
                        if not other_success:
                            recent_failures += 1
            elapsed = max(0, int((event_at - created_at).total_seconds() * 1000))
            events.append({
                "label": "",
                "userAgent": "",
                "acceptLanguage": "",
                "elapsedMs": min(120000, elapsed),
                "attemptsCount": min(10, max(0, int(attempts or 0))),
                "sameIpRecentCount": min(1000, recent_count),
                "sameIpRecentFailureCount": min(1000, recent_failures),
            })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(events)

    print(f"Exported {len(events)} review candidates to {args.output}.")
    print("Labels and missing browser features remain blank intentionally; this file is NOT train-ready.")
    print("Do not infer labels from CAPTCHA success/failure alone. Do not upload the CSV to GitHub.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
