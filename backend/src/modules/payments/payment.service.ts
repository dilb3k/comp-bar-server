import crypto from "node:crypto";
import { currentSession, withOwnerTransaction } from "../../lib/transaction";
import { AppError } from "../../utils/app-error";
import { processImageToWebp } from "../../utils/image-processing";
import { extractTransactionRef, parseReceiptAmount, runOcr } from "../../utils/ocr";
import { authRepository } from "../auth/auth.repository";
import { subscriptionService } from "../subscriptions/subscription.service";
import { PaymentModel, type PaymentTier } from "./payment.model";
import { PaymentReceiptModel } from "./payment-receipt.model";
import { auditService } from "../audit/audit.service";
import { PRICING } from "./payment.constants";

type PaymentInput={userId:string;telegramUserId:string;telegramUsername?:string;tier:PaymentTier;durationMonths:1|6|12};
export class PaymentService {
  private async ownedPayment(paymentId:string,telegramUserId:string) {
    const payment=await PaymentModel.findOne({_id:paymentId,telegramUserId});
    if(!payment) throw new AppError("Payment not found for this Telegram account",404);
    return payment;
  }
  private async createPending(input:PaymentInput,method:"click"|"manual_card") {
    const user=await authRepository.findById(input.userId);
    if(!user||!user.isActive||user.role!=="admin"||user.telegramId!==input.telegramUserId) throw new AppError("Linked payment account does not match",403);
    return (await PaymentModel.create({...input,amount:PRICING[input.tier][input.durationMonths],method,status:"pending",...(method==='click'?{merchantTransId:crypto.randomUUID()}:{})})).toJSON();
  }
  async createManualPayment(input:PaymentInput) {return this.createPending(input,'manual_card');}
  async createClickPending(input:PaymentInput) {return this.createPending(input,'click');}

  async attachReceipt(paymentId:string,receiptFileId:string,file:{buffer:Buffer;mimetype:string},telegramUserId:string) {
    const payment=await this.ownedPayment(paymentId,telegramUserId);
    const receiptHash=crypto.createHash('sha256').update(file.buffer).digest('hex');
    if(payment.receiptHash===receiptHash) return {payment:payment.toJSON(),provisioned:false};
    if(payment.method!=='manual_card'||payment.status!=='pending'||payment.receiptHash) throw new AppError("Payment cannot accept another receipt",409);
    const [ocrText,processed]=await Promise.all([runOcr(file.buffer).catch(()=>''),processImageToWebp(file.buffer)]);
    const {extractedAmount,matched}=parseReceiptAmount(ocrText,payment.amount);
    return withOwnerTransaction(payment.userId,async session=>{
      const current=await this.getDocument(paymentId);
      if(current.receiptHash===receiptHash) return {payment:current.toJSON(),provisioned:false};
      if(current.status!=='pending'||current.receiptHash) throw new AppError("Payment already reviewed or receipt already attached",409);
      current.receiptFileId=receiptFileId;current.receiptHash=receiptHash;current.receiptImageUrl=null;
      current.ocr={extractedAmount,extractedText:ocrText.slice(0,500)||null,transactionRef:extractTransactionRef(ocrText),amountMatched:matched};
      // OCR is review assistance. A screenshot never grants an entitlement.
      await current.save({session});
      await PaymentReceiptModel.create([{paymentId,userId:current.userId,contentType:processed.contentType,bytes:processed.buffer}],{session});
      return {payment:current.toJSON(),provisioned:false};
    });
  }
  async submitCardDetails(paymentId:string,cardNumber:string,fullName:string,telegramUserId:string) {
    const payment=await this.ownedPayment(paymentId,telegramUserId);
    const updated=await PaymentModel.findOneAndUpdate({_id:payment._id,telegramUserId,method:'manual_card',status:'pending'},{$set:{senderCardDetails:{cardNumber,fullName}}},{new:true});
    if(!updated) throw new AppError("Payment is not pending",409);
    return updated.toJSON();
  }
  private async getDocument(paymentId:string) {
    const payment=await PaymentModel.findById(paymentId).session(currentSession()??null);
    if(!payment) throw new AppError('Payment not found',404);
    return payment;
  }
  private async complete(paymentId:string,method:'manual_card'|'click',approvedBy:string,clickTransId?:string,prepareId?:string) {
    const target=await this.getDocument(paymentId);
    return withOwnerTransaction(target.userId,async session=>{
      const payment=await this.getDocument(paymentId);
      if(payment.method!==method) throw new AppError('Payment method mismatch',409);
      if(method==='click' && (prepareId!==payment._id.toString() || (payment.clickTransId && payment.clickTransId!==clickTransId))) throw new AppError('Click transaction/prepare identity mismatch',409);
      if(payment.status==='completed') return payment.toJSON();
      if(payment.status==='provisioned') throw new AppError('Legacy OCR grant requires reconciliation before approval',409,undefined,'LEGACY_PAYMENT_RECONCILIATION_REQUIRED');
      if(payment.status!=='pending') throw new AppError('Payment is not pending',409);
      const subscription=await subscriptionService.activateFromPayment(payment.userId,payment.tier,payment.durationMonths,approvedBy,payment._id.toString());
      payment.status='completed';payment.approvedBy=approvedBy;payment.approvedAt=new Date();
      payment.subscriptionId=String(subscription._id);payment.grantId=payment._id.toString();
      if(clickTransId) payment.clickTransId=clickTransId;
      await payment.save({session});
      return payment.toJSON();
    });
  }
  async approveManualPayment(paymentId:string,approvedByTelegramId:string) { return this.complete(paymentId,'manual_card',`bot:${approvedByTelegramId}`); }
  async completeClickPayment(payment:InstanceType<typeof PaymentModel>,clickTransId:string,prepareId:string) {return this.complete(payment._id.toString(),'click','click',clickTransId,prepareId);}
  async rejectPayment(paymentId:string,rejectedByTelegramId:string,reason?:string) {
    const target=await this.getDocument(paymentId);
    return withOwnerTransaction(target.userId,async session=>{
      const payment=await this.getDocument(paymentId);
      if(payment.status==='rejected') return {payment:payment.toJSON(),wasDowngraded:false,needsReconciliation:payment.needsReconciliation??false};
      if(!['pending','provisioned'].includes(payment.status)) throw new AppError('Payment is not pending',409);
      const legacy=payment.status==='provisioned';
      payment.status='rejected';payment.rejectedReason=reason??'';payment.approvedBy=`bot:${rejectedByTelegramId}`;payment.approvedAt=new Date();payment.needsReconciliation=legacy;
      await payment.save({session});
      await auditService.log({ownerAdminId:payment.userId,action:'UPDATE',entityType:'subscription',entityId:paymentId,after:{status:'rejected',needsReconciliation:legacy},source:'bot',createdBy:payment.approvedBy});
      // Historical provisional grants lack payment-specific provenance. Never
      // revoke an entire account's unrelated paid subscription to guess.
      return {payment:payment.toJSON(),wasDowngraded:false,needsReconciliation:legacy};
    });
  }
  async cancelClickPayment(payment:InstanceType<typeof PaymentModel>) {
    return withOwnerTransaction(payment.userId,async session=>{
      const current=await this.getDocument(payment._id.toString());
      if(current.method!=='click'||current.status==='completed') throw new AppError('Completed payment cannot be cancelled by a stale callback',409);
      if(current.status==='cancelled') return current.toJSON();
      if(current.status!=='pending') throw new AppError('Payment is not pending',409);
      current.status='cancelled';await current.save({session});return current.toJSON();
    });
  }
  async findByMerchantTransId(merchantTransId:string) {return PaymentModel.findOne({merchantTransId,method:'click'});}
  async getByUserId(userId:string) {
    const payments=await PaymentModel.find({userId}).sort({createdAt:-1}).limit(50).lean();
    return payments.map((p:any)=>({...p,id:p._id.toString()}));
  }
  async getPending() {
    const payments=await PaymentModel.find({$or:[{status:{$in:['pending','provisioned']}},{needsReconciliation:true}]}).sort({createdAt:1}).lean();
    return payments.map((p:any)=>({...p,id:p._id.toString()}));
  }
  async getById(paymentId:string) {return (await this.getDocument(paymentId)).toJSON();}
  // ---- Shared lookups the bot needs ----
  async lookupUserByPhone(phone: string) {
    const user = await authRepository.findByPhone(phone);
    if (!user) return null;
    const { tier, subscription } = await subscriptionService.getUserTier(
      user._id.toString(),
      (user as any).role,
      (user as any).isPayed
    );
    return {
      userId: user._id.toString(),
      username: (user as any).username,
      phone_number: (user as any).phone_number,
      tier,
      subscriptionEndDate: subscription?.endDate ?? null,
    };
  }

  async linkTelegram(userId: string, telegramId: string, telegramUsername?: string, verifiedPhone?: string) {
    const user=await authRepository.linkTelegram(userId, telegramId, telegramUsername, verifiedPhone);
    if(!user) throw new AppError("Telefon tasdiqlanmadi yoki hisob boshqa Telegramga bog‘langan",409);
    return user;
  }

  // Lets the bot re-resolve an already-linked account from telegramId alone
  // (see auth.repository.ts's findByTelegramId, which this account gets
  // linked into via linkTelegram above). The bot's own "am I linked"
  // state is just an in-memory Telegraf session, wiped on every restart —
  // without this, that meant re-prompting every previously-linked user to
  // share their phone number again after each deploy, even though the
  // backend never forgot who they were.
  async lookupUserByTelegramId(telegramId: string) {
    const user = await authRepository.findByTelegramId(telegramId);
    if (!user) return null;
    const { tier, subscription } = await subscriptionService.getUserTier(
      user._id.toString(),
      (user as any).role,
      (user as any).isPayed
    );
    return {
      userId: user._id.toString(),
      username: (user as any).username,
      phone_number: (user as any).phone_number,
      tier,
      subscriptionEndDate: subscription?.endDate ?? null,
    };
  }

  async getSubscriptionStatus(userId: string) {
    const user = await authRepository.findById(userId);
    if (!user) throw new AppError("User not found", 404);
    const { tier, subscription } = await subscriptionService.getUserTier(
      userId,
      (user as any).role,
      (user as any).isPayed
    );
    return {
      userId,
      username: (user as any).username,
      tier,
      subscriptionEndDate: subscription?.endDate ?? null,
    };
  }


  async autoExpireProvisionedPayments():Promise<Array<{paymentId:string;userId:string;tier:PaymentTier;amount:number}>> {
    const overdue=await PaymentModel.find({status:'provisioned',provisionExpiresAt:{$lt:new Date()}}).limit(200);
    for(const payment of overdue) {
      try {await this.rejectPayment(payment._id.toString(),'cron:expiry','Legacy provisional receipt expired; payment-specific reconciliation required');}
      catch(error) { if(!(error instanceof AppError && error.statusCode===409)) throw error; }
    }
    // No unrelated entitlement was removed, so the bot must not tell a user
    // they were downgraded. The admin review list retains these records.
    return [];
  }
}
export const paymentService=new PaymentService();
