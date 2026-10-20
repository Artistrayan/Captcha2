ALTER TABLE "captcha_challenges" ADD COLUMN "server_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "captcha_challenges" ALTER COLUMN "max_attempts" SET DEFAULT 4;
