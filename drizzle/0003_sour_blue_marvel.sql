CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"answer" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"snapshot_id" text NOT NULL,
	"requires_manual_review" boolean DEFAULT false NOT NULL,
	"chosen_action" text,
	"reviewed_at" timestamp with time zone,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assumptions" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assumptions" ADD COLUMN "date_value" date;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "decisions_created_idx" ON "decisions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_key_idx" ON "settings" USING btree ("key");--> statement-breakpoint
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_value_shape" CHECK (("assumptions"."value" is null) <> ("assumptions"."date_value" is null));