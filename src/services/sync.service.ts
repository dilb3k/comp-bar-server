import mongoose from "mongoose";
import { AuditLogModel } from "../models/audit-log.model";
import { ProductModel } from "../models/product.model";
import { SaleModel } from "../models/sale.model";
import { HttpError } from "../utils/http-error";
import { parsePagination } from "../utils/pagination";

type PushAction = {
  type: "CREATE_SALE";
  data: {
    id: string;
    productId: string;
    quantity: number;
    createdAt: string;
  };
};

type PushInput = {
  workspaceId: string;
  userId: string;
  deviceId: string;
  actions: PushAction[];
};

type PullInput = {
  workspaceId: string;
  lastSync: string;
  page?: string;
  pageSize?: string;
};

export const syncService = {
  async push(input: PushInput) {
    let synced = 0;
    const failed: Array<{ index: number; saleId?: string; reason: string }> = [];

    for (let i = 0; i < input.actions.length; i += 1) {
      const action = input.actions[i];
      try {
        if (action.type !== "CREATE_SALE") {
          failed.push({ index: i, reason: "Unsupported action type" });
          continue;
        }

        const result = await processCreateSaleAction(
          input.workspaceId,
          input.userId,
          input.deviceId,
          action
        );
        if (result === "CREATED") synced += 1;
      } catch (error) {
        failed.push({
          index: i,
          saleId: action.data.id,
          reason: error instanceof HttpError ? error.message : "Unexpected processing error"
        });
      }
    }

    return { success: true, synced, failed };
  },

  async pull(input: PullInput) {
    const pagination = parsePagination(input.page, input.pageSize, 100, 1000);
    const lastSync = new Date(input.lastSync);

    const [products, sales] = await Promise.all([
      ProductModel.find({
        workspaceId: input.workspaceId,
        updatedAt: { $gt: lastSync }
      })
        .sort({ updatedAt: 1 })
        .skip(pagination.skip)
        .limit(pagination.take)
        .lean(),
      SaleModel.find({
        workspaceId: input.workspaceId,
        createdAt: { $gt: lastSync }
      })
        .sort({ createdAt: 1 })
        .skip(pagination.skip)
        .limit(pagination.take)
        .lean()
    ]);

    return {
      success: true,
      data: {
        products: products.map(stripMongoFields),
        sales: sales.map(stripMongoFields)
      },
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize
      }
    };
  }
};

async function processCreateSaleAction(
  workspaceId: string,
  userId: string,
  deviceId: string,
  action: PushAction
): Promise<"CREATED" | "DUPLICATE"> {
  const existingSale = await SaleModel.findOne({ id: action.data.id }).lean();
  if (existingSale) {
    if (existingSale.workspaceId !== workspaceId) {
      throw new HttpError(409, "Sale id already exists in another workspace");
    }
    return "DUPLICATE";
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const product = await ProductModel.findOne({
        id: action.data.productId,
        workspaceId
      }).session(session);

      if (!product) {
        throw new HttpError(404, "Product not found in workspace");
      }

      const soldRows = await SaleModel.aggregate<{ _id: null; sold: number }>([
        { $match: { workspaceId, productId: product.id } },
        { $group: { _id: null, sold: { $sum: "$quantity" } } }
      ]).session(session);

      const sold = soldRows[0]?.sold ?? 0;
      const stock = product.initialStock - sold;
      if (action.data.quantity > stock) {
        throw new HttpError(409, `Insufficient stock. Current stock: ${stock}`);
      }

      const totalPrice = product.sellPrice * action.data.quantity;
      const profit = (product.sellPrice - product.costPrice) * action.data.quantity;

      const sale = await SaleModel.create(
        [
          {
            id: action.data.id,
            workspaceId,
            productId: product.id,
            quantity: action.data.quantity,
            totalPrice,
            profit,
            createdAt: new Date(action.data.createdAt),
            createdBy: userId
          }
        ],
        { session }
      ).then((rows) => rows[0]);

      await AuditLogModel.create(
        [
          {
            workspaceId,
            actorId: userId,
            action: "SALE_CREATED",
            entityType: "Sale",
            entityId: sale.id,
            saleId: sale.id,
            productId: product.id,
            meta: {
              deviceId,
              quantity: sale.quantity,
              totalPrice: sale.totalPrice,
              profit: sale.profit
            }
          }
        ],
        { session }
      );
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      return "DUPLICATE";
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return "CREATED";
}

function stripMongoFields<T extends Record<string, unknown>>(doc: T) {
  const { _id, __v, ...rest } = doc as T & { _id?: unknown; __v?: unknown };
  return rest;
}
