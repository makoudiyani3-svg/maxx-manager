# Maxx Manager

Product sourcing pipeline: snipe products from **maxx.ca** via Chrome extension, enrich with AI (OpenRouter + Serper), review in dashboard, publish to **Shopify** in one click.

## Stack

- **Next.js 16** on Vercel
- **Supabase** Postgres + Prisma
- **OpenRouter** for AI (copywriting, market analysis, image ranking)
- **Serper** for image and shopping search
- **Shopify Admin GraphQL** for product publishing
- **Chrome Extension** MV3 for maxx.ca sniping

## Setup

### 1. Database (Supabase)

1. Create a Supabase project
2. Run `prisma/migrations/init.sql` in the SQL Editor, or:
   ```bash
   cd apps/web
   cp .env.example .env.local
   # Set DATABASE_URL to your Supabase connection string
   npx prisma db push
   npx prisma generate
   ```

### 2. Environment variables

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in:

- `DATABASE_URL` — Supabase Postgres connection string
- `MAXX_API_KEY` — secret key for Chrome extension
- `OPENROUTER_API_KEY` — from openrouter.ai
- `SERPER_API_KEY` — from serper.dev
- `SHOPIFY_STORE_DOMAIN` — `your-store.myshopify.com`
- `SHOPIFY_ADMIN_API_TOKEN` — Custom App admin token
- `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` or your Vercel URL

### 3. Run locally

```bash
cd apps/web
npm install
npx prisma generate
npm run dev
```

Open http://localhost:3000

### 4. Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `chrome-extension/`
4. Open extension popup → set API URL and API Key (`MAXX_API_KEY`)
5. Visit a product page on maxx.ca → click **Sniper**

### 5. Deploy to Vercel

1. Connect GitHub repo to Vercel
2. Set **Root Directory** to `apps/web`
3. Add all environment variables from `.env.example`
4. Deploy

Update Chrome extension API URL to your Vercel domain.

## Workflow

1. **Sniper** — Extension captures product from maxx.ca → `POST /api/capture`
2. **Enrich** — Auto-triggered pipeline: validate images (min 1500px), Serper fallback, AI copy + market analysis
3. **Review** — Dashboard at `/products/[id]` — edit title, price, description, select images
4. **Publish** — One click → Shopify creates product, imports image URLs to CDN, publishes to Online Store

## Image quality on Shopify

Images are stored as URLs only. On publish, Shopify downloads them via `productCreateMedia` (`originalSource`) and serves them from `cdn.shopify.com`. The pipeline:

- Normalizes URLs (removes resize params)
- Probes dimensions (rejects < 1500px width)
- Ranks images with AI
- Polls media status until `READY` before publishing

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/capture` | Bearer MAXX_API_KEY | Capture product from extension |
| POST | `/api/enrich/[id]` | Bearer MAXX_API_KEY | Run enrichment pipeline |
| GET | `/api/products` | — | List products |
| GET/PATCH | `/api/products/[id]` | — | Get/update product |
| POST | `/api/publish/[id]` | — | Publish to Shopify |

## Project structure

```
maxx-manager/
├── apps/web/           # Next.js app (dashboard + API)
├── chrome-extension/   # Chrome MV3 sniper
└── README.md
```
