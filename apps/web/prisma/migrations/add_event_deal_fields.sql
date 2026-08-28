-- Event week + auction deal fields
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_week_key" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_id" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "event_name" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "auction_ends_at" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lot_quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "bid_status" TEXT NOT NULL DEFAULT 'watching';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "max_bid_lot" DECIMAL(10,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "max_bid_unit" DECIMAL(10,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "transport_share" DECIMAL(10,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "deal_math" JSONB;

CREATE INDEX IF NOT EXISTS "products_event_week_key_idx" ON "products"("event_week_key");
CREATE INDEX IF NOT EXISTS "products_bid_status_idx" ON "products"("bid_status");
