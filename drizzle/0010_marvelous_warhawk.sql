CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"holding_id" text NOT NULL,
	"sold_at" date NOT NULL,
	"quantity" numeric NOT NULL,
	"proceeds_eur" numeric NOT NULL,
	"cost_basis_eur" numeric,
	"cost_basis_source" text DEFAULT 'fifo' NOT NULL,
	"note" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_quantity_positive" CHECK ("sales"."quantity" > 0),
	CONSTRAINT "sales_proceeds_not_negative" CHECK ("sales"."proceeds_eur" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tax_settlements" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"paid_at" date NOT NULL,
	"amount_eur" numeric NOT NULL,
	"note" text,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_updates" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "data_updates" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_holding_idx" ON "sales" USING btree ("holding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_settlements_year_idx" ON "tax_settlements" USING btree ("year") WHERE "tax_settlements"."voided_at" is null;