import { Schema, model, models } from "mongoose";

function iso(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : undefined;
}

const snapshotItemSchema = new Schema(
  {
    productId: {
      type: String,
      required: true,
      trim: true
    },
    productName: {
      type: String,
      required: true,
      trim: true
    },
    sold: {
      type: Number,
      required: true,
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
    revenue: {
      type: Number,
      required: true,
      min: 0
    },
    profit: {
      type: Number,
      required: true
    }
  },
  {
    _id: false
  }
);

const productDataSchema = new Schema(
  {
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
    }
  },
  {
    _id: false
  }
);

const inventoryDataSchema = new Schema(
  {
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
    }
  },
  {
    _id: false
  }
);

const dailyDataSchema = new Schema(
  {
    date: {
      type: String
    },
    totalRevenue: {
      type: Number,
      min: 0
    },
    totalProfit: {
      type: Number
    },
    totalSoldItems: {
      type: Number,
      min: 0
    },
    items: {
      type: [snapshotItemSchema],
      default: []
    }
  },
  {
    _id: false
  }
);

const productRecordSchema = new Schema(
  {
    recordType: {
      type: String,
      required: true,
      enum: ["product", "inventory", "daily"],
      index: true
    },
    ownerAdminId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    localId: {
      type: String,
      required: true,
      trim: true
    },
    deviceId: {
      type: String,
      required: true,
      trim: true
    },
    product: {
      type: productDataSchema,
      default: undefined
    },
    inventory: {
      type: inventoryDataSchema,
      default: undefined
    },
    daily: {
      type: dailyDataSchema,
      default: undefined
    },
    deletedAt: {
      type: Date,
      default: null
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    collection: "products",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        const recordType = ret.recordType;
        const payload =
          recordType === "product"
            ? ret.product
            : recordType === "inventory"
              ? ret.inventory
              : ret.daily;

        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.ownerAdminId;
        delete ret.recordType;
        delete ret.product;
        delete ret.inventory;
        delete ret.daily;
        delete ret.deletedAt;
        ret.createdAt = iso(ret.createdAt);
        ret.updatedAt = iso(ret.updatedAt);

        if (payload) {
          Object.assign(ret, payload);
        }

        return ret;
      }
    }
  }
);

productRecordSchema.pre("validate", function validateProductRecord(next) {
  if (this.recordType === "product") {
    this.inventory = undefined;
    this.daily = undefined;

    if (!this.product?.name) {
      this.invalidate("product.name", "name is required");
    }

    if (this.product?.quantity === undefined) {
      this.invalidate("product.quantity", "quantity is required");
    }

    if (this.product?.buyPrice === undefined) {
      this.invalidate("product.buyPrice", "buyPrice is required");
    }

    if (this.product?.sellPrice === undefined) {
      this.invalidate("product.sellPrice", "sellPrice is required");
    }
  }

  if (this.recordType === "inventory") {
    this.product = undefined;
    this.daily = undefined;

    if (!this.inventory?.productId) {
      this.invalidate("inventory.productId", "productId is required");
    }

    if (!this.inventory?.date) {
      this.invalidate("inventory.date", "date is required");
    }

    if (this.inventory?.startQuantity === undefined) {
      this.invalidate("inventory.startQuantity", "startQuantity is required");
    }

    if (this.inventory?.currentQuantity === undefined) {
      this.invalidate("inventory.currentQuantity", "currentQuantity is required");
    }
  }

  if (this.recordType === "daily") {
    this.product = undefined;
    this.inventory = undefined;

    if (!this.daily?.date) {
      this.invalidate("daily.date", "date is required");
    }

    if (this.daily?.totalRevenue === undefined) {
      this.invalidate("daily.totalRevenue", "totalRevenue is required");
    }

    if (this.daily?.totalProfit === undefined) {
      this.invalidate("daily.totalProfit", "totalProfit is required");
    }

    if (this.daily?.totalSoldItems === undefined) {
      this.invalidate("daily.totalSoldItems", "totalSoldItems is required");
    }
  }

  next();
});

for (const [virtualName, path] of [
  ["name", "product.name"],
  ["quantity", "product.quantity"],
  ["buyPrice", "product.buyPrice"],
  ["sellPrice", "product.sellPrice"],
  ["image", "product.image"],
  ["productId", "inventory.productId"],
  ["startQuantity", "inventory.startQuantity"],
  ["currentQuantity", "inventory.currentQuantity"],
  ["note", "inventory.note"],
  ["dailyDate", "daily.date"],
  ["totalRevenue", "daily.totalRevenue"],
  ["totalProfit", "daily.totalProfit"],
  ["totalSoldItems", "daily.totalSoldItems"],
  ["items", "daily.items"]
] as const) {
  productRecordSchema.virtual(virtualName).get(function getPayloadValue() {
    return this.get(path);
  });
}

productRecordSchema.virtual("date").get(function getRecordDate() {
  return this.get("inventory.date") ?? this.get("daily.date");
});

productRecordSchema.index({ ownerAdminId: 1, recordType: 1, isDeleted: 1, updatedAt: -1 });
productRecordSchema.index({ ownerAdminId: 1, recordType: 1, localId: 1 }, { unique: true });
productRecordSchema.index(
  { ownerAdminId: 1, "inventory.productId": 1, "inventory.date": 1 },
  {
    unique: true,
    partialFilterExpression: { recordType: "inventory" }
  }
);
productRecordSchema.index(
  { ownerAdminId: 1, deviceId: 1, "daily.date": 1 },
  {
    unique: true,
    partialFilterExpression: { recordType: "daily" }
  }
);
productRecordSchema.index(
  { ownerAdminId: 1, "product.name": "text" },
  {
    partialFilterExpression: { recordType: "product" }
  }
);

export const ProductRecordModel =
  models.ProductRecord ?? model("ProductRecord", productRecordSchema);
export const ProductModel = ProductRecordModel;
