import { Schema, model, models } from "mongoose";

const debtorSchema = new Schema(
  {
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    history: [
      {
        amount: { type: Number, required: true },
        type: { type: String, enum: ["add", "subtract"], required: true },
        note: { type: String, default: "" },
        date: { type: String, required: true },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc: any, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const DebtorModel = models.Debtor || model("Debtor", debtorSchema);
