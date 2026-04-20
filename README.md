# Bar Backend

Expo React Native kassir app uchun production-ready Express + MongoDB backend.

## Nimalar bor

- `backend/` ichida modular TypeScript server
- `products`, `inventory`, `snapshots`, `sync`, `health` modullari
- MongoDB + Mongoose schema va indexlar
- Zod validation, consistent error responses
- 07:00 business day logikasi
- Soft delete, daily snapshot derivation, offline sync
- Rootdan `npm run dev`, `npm run build`, `npm test`

## Ishga tushirish

1. `npm install`
2. `.env.example` yoki `backend/.env.example` asosida `.env` yarating
3. `npm run dev`

Prod build:

1. `npm run build`
2. `npm start`

## Environment

`.env` misol:

```env
PORT=4000
NODE_ENV=development
MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net/bar
CLIENT_URL=http://localhost:8081,http://10.0.2.2:8081
BUSINESS_DAY_START_HOUR=7
```

Expo fizik device uchun frontend odatda `http://YOUR_LOCAL_IP:4000/api` ga ulanishi kerak bo‘ladi. Android emulator uchun ko‘p holatda `10.0.2.2` ishlatiladi.

## Asosiy biznes qoidalar

- Business day `07:00` da boshlanadi
- O‘tgan business day uchun inventory va snapshot edit taqiqlangan
- Kelajak sana uchun inventory/snapshot yozilmaydi
- Product yaratishda bugungi inventory avtomatik yaratiladi
- Product update bugungi inventorydagi allaqachon sotilgan sonni saqlab qoladi
- Product delete soft delete qiladi
- Snapshot inventorydan derive qilinadi
- Sync conflict strategy: oxirgi `updatedAt` yutadi

## API

### Health

- `GET /api/health`

### Products

- `GET /api/products?search=cola`
- `GET /api/products/:id`
- `POST /api/products`
- `PUT /api/products/:id`
- `DELETE /api/products/:id`

`POST /api/products` body:

```json
{
  "deviceId": "expo-device-1",
  "name": "Cola 1L",
  "quantity": 20,
  "buyPrice": 10000,
  "sellPrice": 15000,
  "image": ""
}
```

### Inventory

- `GET /api/inventory?date=2026-04-20`
- `GET /api/inventory/range?from=2026-04-19&to=2026-04-20`
- `POST /api/inventory/start-day`
- `PUT /api/inventory/bulk-current`

`PUT /api/inventory/bulk-current` body:

```json
{
  "deviceId": "expo-device-1",
  "date": "2026-04-20",
  "items": [
    {
      "productId": "prd_abc123",
      "currentQuantity": 14
    }
  ]
}
```

### Snapshots

- `GET /api/snapshots/daily?date=2026-04-20`
- `POST /api/snapshots/daily`
- `GET /api/snapshots/range?from=2026-04-01&to=2026-04-20`

`POST /api/snapshots/daily` body:

```json
{
  "deviceId": "expo-device-1",
  "date": "2026-04-20"
}
```

### Sync

- `POST /api/sync`

Body:

```json
{
  "products": [],
  "inventory": [],
  "snapshots": [],
  "lastSyncAt": "2026-04-20T10:00:00.000Z"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "products": [],
    "inventory": [],
    "snapshots": [],
    "serverTime": "2026-04-20T10:05:00.000Z"
  }
}
```

## Papka tuzilmasi

```txt
backend/
  src/
    app.ts
    server.ts
    config/
    lib/
    middlewares/
    modules/
      products/
      inventory/
      snapshots/
      sync/
      health/
    tests/
    types/
    utils/
```

## Testlar

- `npm test`

Hozir critical business rule lar uchun unit testlar qo‘shilgan:

- 07:00 business date
- product quantity update consistency
- snapshot revenue/profit derivation

## Eslatma

Frontendning siz sanagan `app/` va `src/` Expo fayllari bu repo ichida mavjud emas edi. Shu sabab backend contractlari siz bergan aniq domain va endpoint talablari asosida qurildi; frontend repo keyin shu URL contractlarga ulanadi.
