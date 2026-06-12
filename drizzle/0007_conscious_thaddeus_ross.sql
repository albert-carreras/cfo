CREATE TABLE "pictures" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"summary" jsonb NOT NULL,
	"derived" jsonb NOT NULL,
	"narrative" jsonb,
	"context" jsonb,
	"model" text,
	"llm_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pictures_scope_valid" CHECK ("pictures"."scope" in ('full', 'deterministic'))
);
--> statement-breakpoint
ALTER TABLE "pictures" ADD CONSTRAINT "pictures_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "pictures_snapshot_idx" ON "pictures" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "pictures_created_idx" ON "pictures" USING btree ("created_at");