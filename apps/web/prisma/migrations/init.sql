-- Run this in Supabase SQL Editor to create tables
-- Or use: npx prisma db push

CREATE TYPE "ProductStatus" AS ENUM ('captured', 'enriching', 'ready', 'publishing', 'active', 'error');

CREATE TABLE IF NOT EXISTS "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_url" TEXT NOT NULL,
    "source_site" TEXT NOT NULL DEFAULT 'maxx.ca',
    "source_id" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'captured',
    "raw_title" TEXT,
    "raw_price" DECIMAL(10,2),
    "raw_description" TEXT,
    "raw_variants" JSONB,
    "title" TEXT,
    "description_html" TEXT,
    "bullet_points" JSONB,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggested_price" DECIMAL(10,2),
    "cost_price" DECIMAL(10,2),
    "market_analysis" JSONB,
    "shopify_product_id" TEXT,
    "shopify_status" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "products_source_url_key" ON "products"("source_url");
CREATE INDEX IF NOT EXISTS "products_status_idx" ON "products"("status");

CREATE TABLE IF NOT EXISTS "product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'maxx',
    "score" DOUBLE PRECISION,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_images_product_id_idx" ON "product_images"("product_id");
