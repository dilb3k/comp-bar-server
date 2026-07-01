import { AppError } from "../../utils/app-error";
import { DebtorModel } from "./debtor.model";
import type { AuthUser } from "../auth/auth.types";

export const debtorService = {
  async getAll(auth: AuthUser) {
    const debtors = await DebtorModel.find({ createdBy: auth.userId }).sort({ amount: -1 });
    return debtors;
  },

  async getById(auth: AuthUser, id: string) {
    const debtor = await DebtorModel.findOne({ _id: id, createdBy: auth.userId });
    if (!debtor) throw new AppError("Debtor not found", 404);
    return debtor;
  },

  async create(
    auth: AuthUser,
    data: { name: string; amount: number; phone?: string; notes?: string }
  ) {
    const debtor = await DebtorModel.create({
      createdBy: auth.userId,
      name: data.name,
      amount: data.amount,
      phone: data.phone?.trim() || "",
      notes: data.notes?.trim() || "",
      history: data.amount > 0
        ? [{ amount: data.amount, type: "add" as const, date: new Date().toISOString() }]
        : [],
    });
    return debtor;
  },

  async update(auth: AuthUser, id: string, data: { name?: string; phone?: string; notes?: string }) {
    const debtor = await DebtorModel.findOne({ _id: id, createdBy: auth.userId });
    if (!debtor) throw new AppError("Debtor not found", 404);

    if (data.name !== undefined) debtor.name = data.name;
    if (data.phone !== undefined) debtor.phone = data.phone;
    if (data.notes !== undefined) debtor.notes = data.notes;
    await debtor.save();
    return debtor;
  },

  async adjust(
    auth: AuthUser,
    id: string,
    data: { amount: number; type: "add" | "subtract"; note?: string }
  ) {
    const incAmount = data.type === "add" ? data.amount : -data.amount;

    const debtor = await DebtorModel.findOneAndUpdate(
      { _id: id, createdBy: auth.userId },
      {
        $inc: { amount: incAmount },
        $push: {
          history: {
            amount: data.amount,
            type: data.type,
            note: data.note || "",
            date: new Date().toISOString(),
          },
        },
      },
      { new: true }
    );

    if (!debtor) throw new AppError("Debtor not found", 404);

    if (debtor.amount < 0) {
      const corrected = await DebtorModel.findOneAndUpdate(
        { _id: id, amount: { $lt: 0 } },
        { $set: { amount: 0 } },
        { new: true }
      );
      return corrected ?? debtor;
    }

    return debtor;
  },

  async remove(auth: AuthUser, id: string) {
    const debtor = await DebtorModel.findOneAndDelete({ _id: id, createdBy: auth.userId });
    if (!debtor) throw new AppError("Debtor not found", 404);
    return { deleted: true };
  },
};
