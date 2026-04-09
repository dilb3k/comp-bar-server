import { AuditLogModel } from "../models/audit-log.model";
import { ProductModel } from "../models/product.model";
import { SaleModel } from "../models/sale.model";
import { HttpError } from "../utils/http-error";
import { parsePagination } from "../utils/pagination";

type CreateProductInput = {
  workspaceId: string;
  actorId: string;
  name: string;
  costPrice: number;
  sellPrice: number;
  initialStock: number;
};

type UpdateProductInput = {
  workspaceId: string;
  actorId: string;
  id: string;
  name?: string;
  costPrice?: number;
  sellPrice?: number;
  initialStock?: number;
  updatedAt?: string;
};

type ListProductsInput = {
  workspaceId: string;
  page?: string;
  pageSize?: string;
  updatedAfter?: string;
  updatedBefore?: string;
};

export const productService = {
  async create(input: CreateProductInput) {
    const product = await ProductModel.create({
      workspaceId: input.workspaceId,
      name: input.name,
      costPrice: input.costPrice,
      sellPrice: input.sellPrice,
      initialStock: input.initialStock
    });

    await AuditLogModel.create({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: "PRODUCT_CREATED",
      entityType: "Product",
      entityId: product.id,
      productId: product.id,
      meta: {
        name: product.name,
        costPrice: product.costPrice,
        sellPrice: product.sellPrice,
        initialStock: product.initialStock
      }
    });

    return toProductResponse(product.toObject());
  },

  async update(input: UpdateProductInput) {
    const product = await ProductModel.findOne({ id: input.id, workspaceId: input.workspaceId });
    if (!product) {
      throw new HttpError(404, "Product not found");
    }

    if (input.updatedAt && new Date(input.updatedAt) < product.updatedAt) {
      return {
        updated: false as const,
        reason: "Incoming update is older than server version",
        product: toProductResponse(product.toObject())
      };
    }

    if (input.name !== undefined) product.name = input.name;
    if (input.costPrice !== undefined) product.costPrice = input.costPrice;
    if (input.sellPrice !== undefined) product.sellPrice = input.sellPrice;
    if (input.initialStock !== undefined) product.initialStock = input.initialStock;
    await product.save();

    await AuditLogModel.create({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: "PRODUCT_UPDATED",
      entityType: "Product",
      entityId: product.id,
      productId: product.id,
      meta: {
        name: product.name,
        costPrice: product.costPrice,
        sellPrice: product.sellPrice,
        initialStock: product.initialStock
      }
    });

    return {
      updated: true as const,
      product: toProductResponse(product.toObject())
    };
  },

  async list(input: ListProductsInput) {
    const pagination = parsePagination(input.page, input.pageSize);
    const filter: Record<string, unknown> = { workspaceId: input.workspaceId };

    if (input.updatedAfter || input.updatedBefore) {
      filter.updatedAt = {};
      if (input.updatedAfter) {
        (filter.updatedAt as Record<string, unknown>).$gt = new Date(input.updatedAfter);
      }
      if (input.updatedBefore) {
        (filter.updatedAt as Record<string, unknown>).$lt = new Date(input.updatedBefore);
      }
    }

    const [products, total] = await Promise.all([
      ProductModel.find(filter).sort({ updatedAt: -1 }).skip(pagination.skip).limit(pagination.take).lean(),
      ProductModel.countDocuments(filter)
    ]);

    const productIds = products.map((product) => product.id);
    const soldRows =
      productIds.length > 0
        ? await SaleModel.aggregate<{ _id: string; sold: number }>([
            { $match: { workspaceId: input.workspaceId, productId: { $in: productIds } } },
            { $group: { _id: "$productId", sold: { $sum: "$quantity" } } }
          ])
        : [];

    const soldMap = new Map(soldRows.map((row) => [row._id, row.sold]));
    const data = products.map((product) => ({
      ...toProductResponse(product),
      stock: product.initialStock - (soldMap.get(product.id) ?? 0)
    }));

    return {
      data,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize)
      }
    };
  }
};

function toProductResponse(product: {
  id: string;
  workspaceId: string;
  name: string;
  costPrice: number;
  sellPrice: number;
  initialStock: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: product.id,
    workspaceId: product.workspaceId,
    name: product.name,
    costPrice: product.costPrice,
    sellPrice: product.sellPrice,
    initialStock: product.initialStock,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  };
}
