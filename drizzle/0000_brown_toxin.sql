CREATE TYPE "public"."account_type" AS ENUM('bank', 'broker', 'pension', 'manual');--> statement-breakpoint
CREATE TYPE "public"."liability_type" AS ENUM('mortgage');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('deposit', 'withdraw', 'buy', 'sell', 'transfer', 'dividend', 'fee', 'expense');--> statement-breakpoint
CREATE TYPE "public"."planned_event_type" AS ENUM('house_purchase', 'property_sale', 'job_exit', 'pension_withdrawal', 'rental_start', 'inheritance');--> statement-breakpoint
CREATE TYPE "public"."snapshot_kind" AS ENUM('strategic', 'internal');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "account_type" NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"opening_cash" numeric DEFAULT '0' NOT NULL,
	"opening_as_of" date NOT NULL,
	"disposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assumptions" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" numeric NOT NULL,
	"conservative_value" numeric,
	"optimistic_value" numeric,
	"source" text,
	"last_reviewed_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"base" text DEFAULT 'EUR' NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric NOT NULL,
	"as_of" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"isin" text NOT NULL,
	"ticker" text,
	"name" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"opening_quantity" numeric DEFAULT '0' NOT NULL,
	"opening_as_of" date NOT NULL,
	"disposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "liability_type" NOT NULL,
	"property_id" text,
	"account_id" text,
	"rate" numeric,
	"balance" numeric NOT NULL,
	"payment" numeric,
	"disposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"price" numeric NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"as_of" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_spend" (
	"id" text PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"amount" numeric NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "movement_type" NOT NULL,
	"account_id" text NOT NULL,
	"holding_id" text,
	"quantity" numeric,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"occurred_at" date NOT NULL,
	"note" text,
	"corrects_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "planned_event_type" NOT NULL,
	"date" date NOT NULL,
	"amount" numeric NOT NULL,
	"probability" numeric DEFAULT '1' NOT NULL,
	"included_in_base_case" boolean DEFAULT false NOT NULL,
	"realised_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"value" numeric NOT NULL,
	"purchase_price" numeric,
	"ownership_pct" numeric DEFAULT '100' NOT NULL,
	"rent_monthly" numeric DEFAULT '0' NOT NULL,
	"costs_monthly" numeric DEFAULT '0' NOT NULL,
	"is_primary_residence" boolean DEFAULT false NOT NULL,
	"emotional_value" integer,
	"valued_at" date NOT NULL,
	"disposed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "snapshot_kind" NOT NULL,
	"status" text NOT NULL,
	"result" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"holding_id" text NOT NULL,
	"buy_date" date NOT NULL,
	"quantity" numeric NOT NULL,
	"price" numeric NOT NULL,
	"fees" numeric DEFAULT '0' NOT NULL,
	"fx_rate" numeric DEFAULT '1' NOT NULL,
	"cost_basis_eur" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movements" ADD CONSTRAINT "movements_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_lots" ADD CONSTRAINT "tax_lots_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assumptions_key_idx" ON "assumptions" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_quote_asof_idx" ON "fx_rates" USING btree ("quote","as_of");--> statement-breakpoint
CREATE INDEX "holdings_account_idx" ON "holdings" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_prices_isin_asof_idx" ON "market_prices" USING btree ("isin","as_of");--> statement-breakpoint
CREATE INDEX "monthly_spend_month_idx" ON "monthly_spend" USING btree ("month");--> statement-breakpoint
CREATE INDEX "movements_account_idx" ON "movements" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "movements_occurred_idx" ON "movements" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "tax_lots_holding_idx" ON "tax_lots" USING btree ("holding_id");