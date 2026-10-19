CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"hashed_secret" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"client_ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captcha_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"site_key" text NOT NULL,
	"challenge_type" text DEFAULT 'IMAGE_SELECTION' NOT NULL,
	"prompt" text NOT NULL,
	"correct_answer_hash" text NOT NULL,
	"options" jsonb NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"is_consumed" boolean DEFAULT false NOT NULL,
	"solved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "captcha_challenges_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"site_key" text NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret_key_hash" text NOT NULL,
	"secret_key_prefix" text NOT NULL,
	"masked_secret_key" text NOT NULL,
	"challenge_difficulty" text DEFAULT 'MEDIUM' NOT NULL,
	"invisible_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 600 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_site_key_unique" UNIQUE("site_key")
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"date" text NOT NULL,
	"requests_count" integer DEFAULT 0 NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"challenges_issued" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"firebase_uid" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_firebase_uid_unique" UNIQUE("firebase_uid"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"site_key" text NOT NULL,
	"token" text NOT NULL,
	"success" boolean NOT NULL,
	"score" integer DEFAULT 100 NOT NULL,
	"hostname" text DEFAULT '' NOT NULL,
	"action" text DEFAULT 'verify' NOT NULL,
	"client_ip" text DEFAULT '' NOT NULL,
	"error_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captcha_challenges" ADD CONSTRAINT "captcha_challenges_site_key_sites_site_key_fk" FOREIGN KEY ("site_key") REFERENCES "public"."sites"("site_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_site_id_idx" ON "api_keys" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "captcha_challenges_token_idx" ON "captcha_challenges" USING btree ("token");--> statement-breakpoint
CREATE INDEX "captcha_challenges_site_key_idx" ON "captcha_challenges" USING btree ("site_key");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_site_key_idx" ON "sites" USING btree ("site_key");--> statement-breakpoint
CREATE INDEX "sites_user_id_idx" ON "sites" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_site_date_idx" ON "usage_records" USING btree ("site_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_firebase_uid_idx" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "verification_events_token_idx" ON "verification_events" USING btree ("token");--> statement-breakpoint
CREATE INDEX "verification_events_site_key_idx" ON "verification_events" USING btree ("site_key");