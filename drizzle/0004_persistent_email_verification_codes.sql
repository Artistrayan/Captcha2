CREATE TABLE IF NOT EXISTS "email_verification_codes" (
  "email" text PRIMARY KEY NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "sent_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_verification_codes_expires_idx" ON "email_verification_codes" ("expires_at");
