ALTER TABLE "order_items" ADD COLUMN "served_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "order_items_served_recent_idx" ON "order_items" USING btree ("status","served_at");