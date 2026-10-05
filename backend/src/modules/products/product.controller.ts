import { cachedOwnerRead } from "../../lib/cached-owner-read";
import { productRepository } from "./product.repository";
import { replyToMutation } from "../idempotency/http-mutation";
import { assertBaseVersion } from "../../lib/versioning";
import type { Request, Response } from "express";

import { AppError } from "../../utils/app-error";
import { sendSuccess } from "../../utils/response";
import { getCurrentBusinessDate, getEffectiveHour } from "../../utils/business-day";
import { env } from "../../config/env";
import { inventoryService } from "../inventory/inventory.service";
import { snapshotService } from "../snapshots/snapshot.service";
import { productService } from "./product.service";

function requireAuth(req: Request) {
  if (!req.auth) {
    throw new AppError("Unauthorized", 401);
  }

  return req.auth;
}

async function mutationState(req:Request) {
  // V2 callers refresh projections separately; legacy envelopes remain available.
  return req.get('X-Client-Protocol')==='2'?{}:inventoryService.getDashboard(requireAuth(req));
}

export const productController = {
  async list(req: Request, res: Response) {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    return cachedOwnerRead(req, res, "products", () => productService.getAll(requireAuth(req), search));
  },

  async get(req: Request, res: Response) {
    return cachedOwnerRead(req, res, `product:${req.params.id}`, async () => {
      const product = await productRepository.findPublicByIdentifier(requireAuth(req).userId, String(req.params.id));
      if (!product) throw new AppError("Product not found", 404);
      return product;
    });
  },

  async create(req:Request,res:Response) {
    const auth=requireAuth(req);
    return replyToMutation(req,res,auth.userId,'product.create',async()=>({product:await productService.create(auth,req.body),...await mutationState(req)}),201);
  },
  async update(req:Request,res:Response) {
    const auth=requireAuth(req);
    return replyToMutation(req,res,auth.userId,'product.update',async()=>({product:await productService.update(auth,String(req.params.id),req.body),...await mutationState(req)}));
  },
  async restock(req:Request,res:Response) {
    const auth=requireAuth(req);
    return replyToMutation(req,res,auth.userId,'product.restock',async()=>({product:await productService.restock(auth,String(req.params.id),req.body.quantity),...await mutationState(req)}));
  },
  async remove(req:Request,res:Response) {
    const auth=requireAuth(req);
    return replyToMutation(req,res,auth.userId,'product.delete',async()=>{
      const product=await productService.getByIdentifier(auth,String(req.params.id));
      assertBaseVersion(product as any,req.body?.baseVersion);
      await productService.remove(auth,String(req.params.id));return {deleted:true,...await mutationState(req)};
    });
  },

  async uploadImage(req: Request, res: Response) {
    const file = req.file;
    if (!file) {
      throw new AppError("image file is required (multipart field name: image)", 422);
    }
    const product = await productService.setImageFromUpload(requireAuth(req), String(req.params.id), file);
    return sendSuccess(res, { product });
  }
};
