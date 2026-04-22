import { Schema, model, models } from "mongoose";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

const catalogItemSchema = new Schema(
  {
    entityType: {
      type: String,
      required: true,
      enum: ["product", "inventory"],
      index: true
    },
    localId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    deviceId: {
      type: String,
      required: true,
      trim: true
    },
    name: {
      type: String,
      trim: true
    },
    quantity: {
      type: Number,
      min: 0
    },
    buyPrice: {
      type: Number,
      min: 0
    },
    sellPrice: {
      type: Number,
      min: 0
    },
    image: {
      type: String,
      default: ""
    },
    deletedAt: {
      type: Date,
      default: null
    },
    productId: {
      type: String,
      trim: true
    },
    date: {
      type: String
    },
    startQuantity: {
      type: Number,
      min: 0
    },
    currentQuantity: {
      type: Number,
      min: 0
    },
    note: {
      type: String,
      default: ""
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    collection: "catalog_items",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.entityType;
        delete ret.deletedAt;
        ret.createdAt = iso(ret.createdAt);
        ret.updatedAt = iso(ret.updatedAt);
        return ret;
      }
    }
  }
);

catalogItemSchema.pre("validate", function validateCatalogItem(next) {
  if (this.entityType === "product") {
    if (!this.name) {
      this.invalidate("name", "name is required");
    }

    if (this.quantity === undefined) {
      this.invalidate("quantity", "quantity is required");
    }

    if (this.buyPrice === undefined) {
      this.invalidate("buyPrice", "buyPrice is required");
    }

    if (this.sellPrice === undefined) {
      this.invalidate("sellPrice", "sellPrice is required");
    }
  }

  if (this.entityType === "inventory") {
    if (!this.productId) {
      this.invalidate("productId", "productId is required");
    }

    if (!this.date) {
      this.invalidate("date", "date is required");
    }

    if (this.startQuantity === undefined) {
      this.invalidate("startQuantity", "startQuantity is required");
    }

    if (this.currentQuantity === undefined) {
      this.invalidate("currentQuantity", "currentQuantity is required");
    }
  }

  next();
});

catalogItemSchema.index({ entityType: 1, updatedAt: -1 });
catalogItemSchema.index(
  { productId: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: { entityType: "inventory" }
  }
);
catalogItemSchema.index(
  { name: "text" },
  {
    partialFilterExpression: { entityType: "product" }
  }
);

export const CatalogItemModel =
  models.CatalogItem ?? model("CatalogItem", catalogItemSchema);
