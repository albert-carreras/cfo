CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"status_at_check" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "checks_checked_at_idx" ON "checks" USING btree ("checked_at");