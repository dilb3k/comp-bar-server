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

  async create(auth: AuthUser, data: { name: string; amount: number }) {
    const debtor = await DebtorModel.create({
      createdBy: auth.userId,
      name: data.name,
      amount: data.amount,
      history: data.amount > 0
        ? [{ amount: data.amount, type: "add" as const, date: new Date().toISOString() }]
        : [],
    });
    return debtor;
  },

  async update(auth: AuthUser, id: string, data: { name?: string; amount?: number }) {
    const debtor = await DebtorModel.findOne({ _id: id, createdBy: auth.userId });
    if (!debtor) throw new AppError("Debtor not found", 404);

    if (data.name !== undefined) debtor.name = data.name;
    if (data.amount !== undefined) debtor.amount = data.amount;
    await debtor.save();
    return debtor;
  },

  async adjust(
    auth: AuthUser,
    id: string,
    data: { amount: number; type: "add" | "subtract"; note?: string }
  ) {
    const debtor = await DebtorModel.findOne({ _id: id, createdBy: auth.userId });
    if (!debtor) throw new AppError("Debtor not found", 404);

    if (data.type === "add") {
      debtor.amount += data.amount;
    } else {
      debtor.amount = Math.max(0, debtor.amount - data.amount);
    }

    debtor.history.push({
      amount: data.amount,
      type: data.type,
      note: data.note || "",
      date: new Date().toISOString(),
    });

    await debtor.save();
    return debtor;
  },

  async remove(auth: AuthUser, id: string) {
    const debtor = await DebtorModel.findOneAndDelete({ _id: id, createdBy: auth.userId });
    if (!debtor) throw new AppError("Debtor not found", 404);
    return { deleted: true };
  },
};
