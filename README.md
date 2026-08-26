# Bar Backend

Expo React Native kassir app uchun production-ready Express + MongoDB backend.

## Nimalar bor

- `backend/` ichida modular TypeScript server
- `products`, `inventory`, `snapshots`, `sync`, `health` modullari
- MongoDB + Mongoose schema va indexlar
- `auth` dan tashqari barcha data bitta `products` collection ichida `recordType + product/inventory/daily` ko'rinishida saqlanadi
- Zod validation, consistent error responses
- 00:00 business day logikasi
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
BUSINESS_DAY_START_HOUR=0
```

Expo fizik device uchun frontend odatda `http://YOUR_LOCAL_IP:4000/api` ga ulanishi kerak bo‘ladi. Android emulator uchun ko‘p holatda `10.0.2.2` ishlatiladi.

`superAdmin` account `.env` dan olinmaydi. U MongoDB ichidagi `users` kolleksiyasida mavjud bo'lishi kerak.

## Asosiy biznes qoidalar

- Business day `00:00` da boshlanadi
- O‘tgan business day uchun inventory va snapshot edit taqiqlangan
- Kelajak sana uchun inventory/snapshot yozilmaydi
- Product yaratishda bugungi inventory avtomatik yaratiladi
- Product update bugungi inventorydagi allaqachon sotilgan sonni saqlab qoladi
- Product delete soft delete qiladi
- Snapshot inventorydan derive qilinadi
- Sync conflict strategy: oxirgi `updatedAt` yutadi
- Har mahsulotning `unit`i bor: `dona` (butun son) yoki `kg` (3 kasrgacha,
  ya'ni 1 gramm aniqligida). Miqdorlar shu panjaraga yaxlitlanadi — qarang
  `utils/quantity.ts`
- Sotuv qatorida `unitPrice` bo'lsa (kelishilgan narx yoki chegirma natijasi),
  o'sha birliklar `locked*` akkumulyatorlarga haqiqiy narxda yoziladi va
  `startQuantity` ular bilan birga tushadi. Kun boshidagi zaxira
  `startQuantity + lockedSold` sifatida tiklanadi

## Miqdor va narx modeli

Sotilgan birliklar ikki yo'ldan biri bilan hisoblanadi:

| yo'l | qachon | qanday baholanadi |
|---|---|---|
| **derive** | qo'lda qoldiq tahriri, kun boshi, `unitPrice`siz sotuv | `(startQuantity − currentQuantity) × sellPrice` |
| **locked** | `unitPrice` berilgan sotuv, kun o'rtasida narx tuzatilishi | `lockedRevenue` / `lockedProfit` — haqiqiy narxda yozilgan |

Yakuniy ko'rsatkichlar ikkalasining yig'indisi, shuning uchun bitta mahsulot
bir kunda bir necha xil narxda sotilsa ham tushum so'mgacha aniq bo'ladi.
`lockedProfit` manfiy bo'lishi mumkin — tannarxdan past sotish haqiqiy holat.

**Muhim:** chegirmani mijoz taqsimlaydi. Server faqat bitta tushunchani
biladi — har birlik qanchaga sotilgani. Mijoz ko'rsatadigan yakuniy summa
aynan shu narxlardan hosil qilinishi shart, aks holda ekran va hisobot
farq qiladi.

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
  "unit": "dona",
  "buyPrice": 10000,
  "sellPrice": 15000,
  "image": ""
}
```

`unit` ixtiyoriy va `dona` ga default bo'ladi (eski mijozlar shu sababli
o'zgarishsiz ishlaydi). `kg` bo'lsa `quantity` kasr bo'lishi mumkin:

```json
{
  "deviceId": "expo-device-1",
  "name": "Mol go'shti",
  "quantity": 12.5,
  "unit": "kg",
  "buyPrice": 80000,
  "sellPrice": 95000
}
```

### Inventory

- `GET /api/inventory?date=2026-04-20`
- `GET /api/inventory/range?from=2026-04-19&to=2026-04-20`
- `POST /api/inventory/start-day`
- `PUT /api/inventory/bulk-current`
- `POST /api/inventory/sales`

`POST /api/inventory/sales` body — `unitPrice` faqat asl narxdan farq
qilganda yuboriladi:

```json
{
  "deviceId": "expo-device-1",
  "date": "2026-04-20",
  "lines": [
    { "productId": "prd_abc123", "quantity": 2 },
    { "productId": "prd_abc123", "quantity": 3, "unitPrice": 9000 },
    { "productId": "prd_meat01", "quantity": 1.75, "unitPrice": 90000 }
  ]
}
```

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
  "daily": [],
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
    "daily": [],
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

- 00:00 business date
- product quantity update consistency
- snapshot revenue/profit derivation

## Eslatma

Frontendning siz sanagan `app/` va `src/` Expo fayllari bu repo ichida mavjud emas edi. Shu sabab backend contractlari siz bergan aniq domain va endpoint talablari asosida qurildi; frontend repo keyin shu URL contractlarga ulanadi.
