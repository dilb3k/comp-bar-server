import { Schema, model, models } from "mongoose";
import bcrypt from "bcryptjs";

const SALT_WORK_FACTOR = 10;

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
    isPayed: {
      type: Boolean,
      default: false,
      index: true,
    },
    businessDayStartHour: {
      type: Number,
      default: 12,
    },
    pendingBusinessDayStartHour: {
      type: Number,
      default: null,
    },
    businessDayEffectiveFrom: {
      type: Date,
      default: null,
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

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(SALT_WORK_FACTOR);
    const hash = await bcrypt.hash(this.password, salt);
    this.password = hash;
    next();
  } catch (error: any) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.index({ username: 1 }, { unique: true });

export const UserModel = models.User ?? model("User", userSchema);
