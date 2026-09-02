-- P1/P2 inventory hardening (apply via prisma db push or migrate)
-- sku, shopify_available_qty, unique shopify_product_id, line item idempotency

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_available_qty INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS products_shopify_product_id_key
  ON products (shopify_product_id)
  WHERE shopify_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_sku_idx ON products (sku);

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS shopify_line_item_id TEXT;

-- Drop loose duplicates before unique (keep earliest movement per pair)
DELETE FROM inventory_movements a
USING inventory_movements b
WHERE a.shopify_order_id IS NOT NULL
  AND a.shopify_line_item_id IS NOT NULL
  AND a.shopify_order_id = b.shopify_order_id
  AND a.shopify_line_item_id = b.shopify_line_item_id
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_order_line_unique
  ON inventory_movements (shopify_order_id, shopify_line_item_id)
  WHERE shopify_order_id IS NOT NULL AND shopify_line_item_id IS NOT NULL;
