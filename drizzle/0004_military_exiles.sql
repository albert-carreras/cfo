CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"scope" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"summary" jsonb NOT NULL,
	"material_change" jsonb NOT NULL,
	"tax_table_version" text NOT NULL,
	"report" jsonb,
	"context" jsonb,
	"model" text,
	"llm_error" text,
	"decision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_month_format" CHECK ("reviews"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "reviews_scope_valid" CHECK ("reviews"."scope" in ('full', 'deterministic'))
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_month_idx" ON "reviews" USING btree ("month");--> statement-breakpoint
CREATE INDEX "reviews_created_idx" ON "reviews" USING btree ("created_at");