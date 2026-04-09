# Postman Examples

Base URL: `http://localhost:4000/api`

## 1) Register Admin + Create Workspace

`POST /auth/register`

```json
{
  "workspaceName": "Cyber Club A",
  "name": "Owner",
  "email": "owner@club.com",
  "password": "secret123"
}
```

## 2) Login

`POST /auth/login`

```json
{
  "email": "owner@club.com",
  "password": "secret123"
}
```

Use `data.token` as `Bearer <token>`.

## 3) Create Product

`POST /products`

Headers:
- `Authorization: Bearer <token>`

```json
{
  "name": "Energy Drink",
  "costPrice": 0.6,
  "sellPrice": 1.2,
  "initialStock": 100
}
```

## 4) Push Offline Queue

`POST /sync`

Headers:
- `Authorization: Bearer <token>`

```json
{
  "deviceId": "device-01",
  "actions": [
    {
      "type": "CREATE_SALE",
      "data": {
        "id": "3017c9a4-57d2-4f70-a2ae-e9fbb4b778c5",
        "productId": "REPLACE_PRODUCT_ID",
        "quantity": 2,
        "createdAt": "2026-04-03T08:30:00.000Z"
      }
    }
  ]
}
```

Duplicate `id` is ignored (idempotent).

## 5) Pull Sync

`GET /sync?lastSync=2026-04-03T00:00:00.000Z&page=1&pageSize=100`

Headers:
- `Authorization: Bearer <token>`

## 6) Summary Stats

`GET /stats/summary?dateFrom=2026-04-01T00:00:00.000Z&dateTo=2026-04-30T23:59:59.999Z`

Headers:
- `Authorization: Bearer <token>`

## 7) Product Stats

`GET /stats/products?dateFrom=2026-04-01T00:00:00.000Z&dateTo=2026-04-30T23:59:59.999Z`

Headers:
- `Authorization: Bearer <token>`
