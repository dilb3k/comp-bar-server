# Sample cURL

## Health

```bash
curl http://localhost:4000/api/health
```

## Create product

```bash
curl -X POST http://localhost:4000/api/products \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"expo-device-1\",\"name\":\"Pepsi\",\"quantity\":30,\"buyPrice\":9000,\"sellPrice\":14000}"
```

## Search products

```bash
curl "http://localhost:4000/api/products?search=pep"
```

## Inventory list

```bash
curl "http://localhost:4000/api/inventory?date=2026-04-20"
```

## Update current quantity

```bash
curl -X PUT http://localhost:4000/api/inventory/bulk-current \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"expo-device-1\",\"date\":\"2026-04-20\",\"items\":[{\"productId\":\"prd_demo\",\"currentQuantity\":10}]}"
```

## Upsert daily snapshot

```bash
curl -X POST http://localhost:4000/api/snapshots/daily \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"expo-device-1\",\"date\":\"2026-04-20\"}"
```

## Sync

```bash
curl -X POST http://localhost:4000/api/sync \
  -H "Content-Type: application/json" \
  -d "{\"products\":[],\"inventory\":[],\"snapshots\":[],\"lastSyncAt\":\"2026-04-20T10:00:00.000Z\"}"
```
