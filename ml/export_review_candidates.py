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
      WITH recent AS (
        SELECT
          cc.created_at AS challenge_created_at,
          cc.attempts_count,
          NULLIF(ve.client_ip, '') AS ip_for_aggregation,
          ve.success,
          ve.created_at AS event_at,
          COUNT(*) OVER (
            PARTITION BY NULLIF(ve.client_ip, '')
            ORDER BY ve.created_at
            RANGE BETWEEN INTERVAL '1 hour' PRECEDING AND CURRENT ROW
          ) AS same_ip_count,
          COUNT(*) FILTER (WHERE ve.success = FALSE) OVER (
            PARTITION BY NULLIF(ve.client_ip, '')
            ORDER BY ve.created_at
            RANGE BETWEEN INTERVAL '1 hour' PRECEDING AND CURRENT ROW
          ) AS same_ip_failures
        FROM verification_events ve
        JOIN captcha_challenges cc ON cc.token = ve.token
        WHERE ve.created_at >= NOW() - (%s * INTERVAL '1 day')
      )
      SELECT challenge_created_at, attempts_count, event_at,
             CASE WHEN ip_for_aggregation IS NULL THEN 0 ELSE same_ip_count END,
             CASE WHEN ip_for_aggregation IS NULL THEN 0 ELSE same_ip_failures END
      FROM recent
      ORDER BY event_at ASC
    """
    with psycopg.connect(dsn, connect_timeout=15) as conn:
        rows = conn.execute(query, (args.since_days,)).fetchall()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for challenge_created, attempts, event_at, same_ip_count, same_ip_failures in rows:
            elapsed = max(0, int((event_at - challenge_created).total_seconds() * 1000))
            writer.writerow({
                "label": "",
                "userAgent": "",
                "acceptLanguage": "",
                "elapsedMs": min(120000, elapsed),
                "attemptsCount": min(10, max(0, int(attempts or 0))),
                "sameIpRecentCount": min(1000, max(0, int(same_ip_count or 0))),
                "sameIpRecentFailureCount": min(1000, max(0, int(same_ip_failures or 0))),
            })

    print(f"Exported {len(rows)} review candidates to {args.output}.")
    print("Labels and missing browser features remain blank intentionally; this file is NOT train-ready.")
    print("Do not infer labels from CAPTCHA success/failure alone. Do not upload the CSV to GitHub.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
