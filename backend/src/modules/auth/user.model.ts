import { Schema, model, models } from "mongoose";

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["admin", "superAdmin"],
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret: any) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.password;
        return ret;
      },
    },
  },
);

userSchema.index({ username: 1 }, { unique: true });

export const UserModel = models.User ?? model("User", userSchema);
