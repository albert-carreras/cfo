CREATE TYPE "public"."revaluation_asset_type" AS ENUM('account');--> statement-breakpoint
CREATE TABLE "revaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_type" "revaluation_asset_type" NOT NULL,
	"asset_id" text NOT NULL,
	"value" numeric NOT NULL,
	"valued_at" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revaluations_value_not_negative" CHECK ("revaluations"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "movements" ADD COLUMN "transfer_group_id" text;--> statement-breakpoint
CREATE INDEX "revaluations_asset_idx" ON "revaluations" USING btree ("asset_type","asset_id","valued_at");--> statement-breakpoint
CREATE INDEX "movements_transfer_group_idx" ON "movements" USING btree ("transfer_group_id");--> statement-breakpoint
CREATE FUNCTION "prevent_revaluation_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('cfo.allow_ledger_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'revaluations is append-only; append a newer statement instead';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "revaluations_append_only"
BEFORE UPDATE OR DELETE ON "revaluations"
FOR EACH ROW EXECUTE FUNCTION "prevent_revaluation_mutation"();
