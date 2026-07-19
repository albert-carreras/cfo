ALTER TYPE "public"."liability_type" ADD VALUE 'loan';--> statement-breakpoint
ALTER TYPE "public"."revaluation_asset_type" ADD VALUE 'holding' BEFORE 'property';--> statement-breakpoint
ALTER TYPE "public"."revaluation_asset_type" ADD VALUE 'other_asset';--> statement-breakpoint
CREATE TABLE "data_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"as_of" date NOT NULL,
	"note" text,
	"changes" jsonb NOT NULL,
	"snapshot_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"dedupe_key" text,
	"snapshot_id" text NOT NULL,
	"verdict" text NOT NULL,
	"summary" jsonb NOT NULL,
	"report" jsonb,
	"model" text,
	"llm_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "other_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"value" numeric NOT NULL,
	"include_in_net_worth" boolean DEFAULT false NOT NULL,
	"valued_at" date NOT NULL,
	"note" text,
	"disposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "data_updates" ADD CONSTRAINT "data_updates_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "health_checks" ADD CONSTRAINT "health_checks_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "data_updates_created_idx" ON "data_updates" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "health_checks_dedupe_key_idx" ON "health_checks" USING btree ("dedupe_key") WHERE "health_checks"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "health_checks_created_idx" ON "health_checks" USING btree ("created_at");