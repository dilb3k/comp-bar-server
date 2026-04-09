# Bar Backend (MongoDB + Offline Sync)

Offline-first cashier backend with multi-tenant workspaces, JWT auth, append-only sales, and idempotent sync.

## Stack
- Node.js + Express + TypeScript
- MongoDB Atlas + Mongoose
- JWT Auth
- Zod validation

## Setup
1. Configure `.env`:
```env
MONGODB_URL="mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?appName=<app>"
PORT=4000
NODE_ENV=development
JWT_SECRET="change-this-secret"
JWT_EXPIRES_IN="7d"
```

2. Install and run:
```bash
npm install
npm run build
npm start
```

Base URL: `http://localhost:4000/api`

## Core Rules
- Multi-tenant scope by `workspaceId` from JWT
- Product stock is not stored as mutable value
- Dynamic stock: `initialStock - SUM(sales.quantity)`
- Sales are append-only
- `sale.id` is unique and used for idempotent sync

## Main Endpoints
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/products` (admin)
- `PATCH /api/products/:id` (admin, LWW by `updatedAt`)
- `GET /api/products`
- `POST /api/sync`
- `GET /api/sync?lastSync=...`
- `GET /api/stats/summary`
- `GET /api/stats/products`

Postman examples: `docs/postman-examples.md`, `docs/postman.collection.json`
