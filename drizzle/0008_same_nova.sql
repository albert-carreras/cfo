ALTER TYPE "public"."revaluation_asset_type" ADD VALUE 'property';--> statement-breakpoint
ALTER TYPE "public"."revaluation_asset_type" ADD VALUE 'liability';--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN "planned_event_id" text;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_planned_event_id_planned_events_id_fk" FOREIGN KEY ("planned_event_id") REFERENCES "public"."planned_events"("id") ON DELETE no action ON UPDATE no action;