import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error";
import { detectLanguage, translateMessage } from "../utils/i18n";
import { errorMiddleware } from "../middlewares/error.middleware";
import { validateRequest } from "../middlewares/validate.middleware";
import { syncController } from "../modules/sync/sync.controller";
import { syncService } from "../modules/sync/sync.service";

function response() {
  const result = { status: 0, body: undefined as any, varies: [] as string[] };
  const res = {
    vary: (header: string) => { result.varies.push(header); return res; },
    status: (status: number) => { result.status = status; return res; },
    json: (body: unknown) => { result.body = body; return res; },
  } as unknown as Response;
  return { result, res };
}

test("language negotiation handles locales, priorities and excluded languages", () => {
  for (const [header, expected] of [[undefined, "uz"], ["UZ-Latn", "uz"], ["RU-ru", "ru"], ["en,ru;q=0.9,uz;q=0.5", "ru"], ["ru;q=0,uz;q=0.7", "uz"], ["ru;q=bad", "uz"]]) {
    assert.equal(detectLanguage(header), expected);
  }
});

test("login errors are localized without changing their status or error code", () => {
  for (const lang of ["uz", "ru"]) {
    const { res, result } = response();
    errorMiddleware(new AppError("Invalid username or password", 401, null, "INVALID_CREDENTIALS"), { headers: { "accept-language": lang } } as Request, res, () => {});
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, "INVALID_CREDENTIALS");
    assert.equal(result.body.error.message, lang === "uz" ? "Login yoki parol noto‘g‘ri" : "Неверный логин или пароль");
    assert.ok(result.varies.includes("Accept-Language"));
  }
});

test("registration, recovery, limits and form errors translate to Russian", () => {
  for (const message of ["Username already exists", "Telefonni Telegram bot orqali tasdiqlang.", "Havola ishlatilgan yoki muddati tugagan. Telegram botidan yangi havola oling.", "Too many login attempts. Please try again after 15 minutes.", "Request body is too large", "Unsupported image type"]) {
    assert.match(translateMessage(message, "ru"), /[А-Яа-яЁё]/);
  }
  assert.equal(translateMessage("Kod noto'g'ri. Qolgan urinishlar: 2", "ru"), "Неверный код. Осталось попыток: 2");
  assert.equal(translateMessage("Product not found: product-123", "uz"), "Mahsulot topilmadi: product-123");
});

test("validation details use the same language as the public error", () => {
  for (const lang of ["uz", "ru"]) {
    const req = { headers: { "accept-language": lang }, body: { username: "a", password: "123" } } as Request;
    let validation: unknown;
    validateRequest({ body: z.object({ username: z.string().min(3), password: z.string().min(6) }) })(req, {} as Response, error => { validation = error; });
    const { res, result } = response();
    errorMiddleware(validation, req, res, () => {});
    assert.equal(result.status, 422);
    assert.equal(result.body.error.details[0].path, "username");
    assert.equal(result.body.error.details[0].message, lang === "uz" ? "Kamida 3 belgi kiriting" : "Введите не менее 3 символов");
  }
});

test("malformed input is localized while retaining its machine-readable discriminator", () => {
  const { res, result } = response();
  errorMiddleware({ type: "entity.parse.failed" }, { headers: { "accept-language": "ru" } } as Request, res, () => {});
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, "INVALID_JSON");
  assert.equal(result.body.error.message, "Неверный формат отправленных данных");
});

test("partial sync rejections are translated while operation identities and reasons stay intact", async () => {
  const original = syncService.sync;
  syncService.sync = async () => ({
    serverTime: new Date().toISOString(), upgradeRequired: false, protocolVersion: 2 as const,
    hasMore: false, nextCursor: null, checkpoint: null,
    inventory: [], daily: [], products: [], deletedProducts: [], acknowledged: [],
    accepted: { products: 0, inventory: 0, snapshots: 0, operations: 0 },
    rejected: [
      { entity: "product", localId: "p-1", reason: "HTTP_404", message: "Product not found" },
      { entity: "operation", localId: "op-2", reason: "RECONCILIATION_REQUIRED" },
    ],
  });
  try {
    const { res, result } = response();
    await syncController.sync({ auth: { userId: "test" }, body: {}, headers: { "accept-language": "ru" } } as Request, res);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.rejected[0].message, "Товар не найден");
    assert.equal(result.body.data.rejected[0].reason, "HTTP_404");
    assert.equal(result.body.data.rejected[0].localId, "p-1");
    assert.equal(result.body.data.rejected[1].reason, "RECONCILIATION_REQUIRED");
    assert.equal(result.body.data.rejected[1].message, undefined);
  } finally {
    syncService.sync = original;
  }
});
