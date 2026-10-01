import { currentSession } from "../../lib/transaction";
import { roundMoney } from "../../utils/quantity";
import { AppError } from "../../utils/app-error";
import { DebtorModel } from "./debtor.model";
import type { AuthUser } from "../auth/auth.types";

export const debtorService = {
  async getAll(auth: AuthUser) {
    const debtors = await DebtorModel.find({ createdBy: auth.userId }).sort({ amount: -1 });
    return debtors;
  },

  async getById(auth: AuthUser, id: string) {
    const debtor = await DebtorModel.findOne({ _id: id, createdBy: auth.userId }).session(currentSession()??null);
    if (!debtor) throw new AppError("Debtor not found", 404);
    return debtor;
  },

  async create(
    auth: AuthUser,
    data: { name: string; amount: number; phone?: string; notes?: string }
  ) {
    const [debtor] = await DebtorModel.create([{
      createdBy: auth.userId,
      name: data.name,
      amount: data.amount,
      phone: data.phone?.trim() || "",
      notes: data.notes?.trim() || "",
      history: data.amount > 0
        ? [{ amount: data.amount, type: "add" as const, date: new Date().toISOString() }]
        : [],
    }],{session:currentSession()});
    return debtor;
  },

  async update(auth: AuthUser, id: string, data: { name?: string; phone?: string; notes?: string }) {
    const debtor = await DebtorModel.findOne({ _id: id, createdBy: auth.userId }).session(currentSession()??null);
    if (!debtor) throw new AppError("Debtor not found", 404);

    if (data.name !== undefined) debtor.name = data.name;
    if (data.phone !== undefined) debtor.phone = data.phone;
    if (data.notes !== undefined) debtor.notes = data.notes;
    await debtor.save({session:currentSession()});
    return debtor;
  },

  async adjust(
    auth: AuthUser,
    id: string,
    data: { amount: number; type: "add" | "subtract"; note?: string }
  ) {
    const amount=roundMoney(data.amount);
    if(!Number.isFinite(amount)||amount<=0) throw new AppError("Invalid amount",422);
    const incAmount = data.type === "add" ? amount : -amount;

    const debtor = await DebtorModel.findOneAndUpdate(
      { _id: id, createdBy: auth.userId, ...(data.type==="subtract"?{amount:{$gte:amount}}:{}) },
      [{$set:{
        amount:{$round:[{$add:["$amount",incAmount]},2]},
        history:{$concatArrays:[{$ifNull:["$history",[]]},{$literal:[{
          amount,type:data.type,note:data.note||"",date:new Date().toISOString(),
        }]}]},
      }}],
      { new: true, session:currentSession() }
    );

    if (!debtor) throw new AppError("Debtor not found or subtraction exceeds outstanding debt",422);

    return debtor;
  },

  async remove(auth: AuthUser, id: string) {
    const debtor = await DebtorModel.findOneAndDelete({ _id: id, createdBy: auth.userId },{session:currentSession()});
    if (!debtor) throw new AppError("Debtor not found", 404);
    return { deleted: true };
  },
};
