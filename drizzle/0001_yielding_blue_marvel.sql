ALTER TABLE "snapshots" ADD COLUMN "as_of" date;--> statement-breakpoint
UPDATE "snapshots"
SET "as_of" = COALESCE(
  NULLIF("result"->>'asOf', '')::date,
  "computed_at"::date
);--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "as_of" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_corrects_id_movements_id_fk" FOREIGN KEY ("corrects_id") REFERENCES "public"."movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "movements_corrects_unique_idx" ON "movements" USING btree ("corrects_id") WHERE "movements"."corrects_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_dedupe_key_idx" ON "snapshots" USING btree ("dedupe_key") WHERE "snapshots"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "snapshots_latest_idx" ON "snapshots" USING btree ("kind","computed_at","created_at");--> statement-breakpoint
ALTER TABLE "monthly_spend" ADD CONSTRAINT "monthly_spend_amount_positive" CHECK ("monthly_spend"."amount" > 0);--> statement-breakpoint
ALTER TABLE "monthly_spend" ADD CONSTRAINT "monthly_spend_month_format" CHECK ("monthly_spend"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_amount_positive" CHECK ("movements"."amount" > 0);--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_currency_eur" CHECK ("movements"."currency" = 'EUR');--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_holding_quantity_shape" CHECK ((
        ("movements"."type" in ('buy', 'sell') and "movements"."holding_id" is not null and "movements"."quantity" > 0)
        or
        ("movements"."type" not in ('buy', 'sell') and "movements"."holding_id" is null and "movements"."quantity" is null)
      ));--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_correction_not_self" CHECK ("movements"."corrects_id" is null or "movements"."corrects_id" <> "movements"."id");--> statement-breakpoint
CREATE FUNCTION "prevent_movement_mutation"()
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

  RAISE EXCEPTION 'movements is append-only; append a correction row instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "movements_append_only"
BEFORE UPDATE OR DELETE ON "movements"
FOR EACH ROW EXECUTE FUNCTION "prevent_movement_mutation"();
