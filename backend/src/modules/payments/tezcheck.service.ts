import { PaymentModel, PaymentTier } from './payment.model';
import { PRICING } from './payment.constants';
import { authRepository } from '../auth/auth.repository';
import { subscriptionService } from '../subscriptions/subscription.service';
import { withOwnerTransaction } from '../../lib/transaction';
import { AppError } from '../../utils/app-error';

type Input={userId:string;telegramUserId:string;telegramUsername?:string;tier:PaymentTier;durationMonths:1|6|12;requestKey:string};
type Settlement={billId:string;paymentId:string;eventId?:string;amountMinor:number;netMinor:number;feeMinor:number;currency:string;environment:string;state:string;refundedMinor:number};
export const tezcheckPayments={
 async create(input:Input){
  const user=await authRepository.findById(input.userId);
  if(!user||!user.isActive||user.role!=='admin'||user.telegramId!==input.telegramUserId)throw new AppError('Linked account mismatch',403);
  return withOwnerTransaction(input.userId,async session=>{
   const key=`${input.telegramUserId}:${input.requestKey}`;
   const old=await PaymentModel.findOne({tezcheckRequestKey:key}).session(session);
   if(old){if(old.userId!==input.userId||old.tier!==input.tier||old.durationMonths!==input.durationMonths)throw new AppError('Order identity mismatch',409);return old.toJSON();}
   const [p]=await PaymentModel.create([{...input,tezcheckRequestKey:key,amount:PRICING[input.tier][input.durationMonths],method:'tezcheck',status:'pending'}],{session});return p.toJSON();
  });
 },
 async bind(id:string,input:{telegramUserId:string;billId:string;payUrl:string}){
  const url=new URL(input.payUrl);if(url.protocol!=='https:' || !(url.hostname==='tezcheck.uz'||url.hostname.endsWith('.tezcheck.uz')))throw new AppError('Untrusted checkout URL',422);
  const p=await PaymentModel.findOneAndUpdate({_id:id,method:'tezcheck',telegramUserId:input.telegramUserId,status:'pending',$or:[{tezcheckBillId:{$exists:false}},{tezcheckBillId:input.billId}]},{$set:{tezcheckBillId:input.billId,tezcheckPayUrl:input.payUrl}},{new:true});
  if(!p)throw new AppError('Order cannot be bound',409);return p.toJSON();
 },
 async settle(id:string,input:Settlement){
  const target=await PaymentModel.findById(id);if(!target)throw new AppError('Payment not found',404);
  return withOwnerTransaction(target.userId,async session=>{
   const p=await PaymentModel.findById(id).session(session);
   if(!p||p.method!=='tezcheck'||(p.tezcheckBillId&&p.tezcheckBillId!==input.billId)||(p.tezcheckPaymentId&&p.tezcheckPaymentId!==input.paymentId))throw new AppError('Payment identity mismatch',409);
   if(input.currency!=='UZS'||input.environment!=='live'||!Number.isSafeInteger(input.amountMinor)||input.amountMinor!==Math.round(p.amount*100)||input.netMinor+input.feeMinor!==input.amountMinor||input.refundedMinor>input.amountMinor)throw new AppError('Payment amount/environment mismatch',422);
   if(input.eventId&&p.tezcheckEventIds?.includes(input.eventId))return p.toJSON();
   p.tezcheckBillId=input.billId;p.tezcheckPaymentId=input.paymentId;
   p.tezcheckNetMinor=input.netMinor;p.tezcheckFeeMinor=input.feeMinor;p.tezcheckRefundedMinor=Math.max(p.tezcheckRefundedMinor??0,input.refundedMinor);
   if(input.state!=='succeeded'||input.refundedMinor>0){
    p.needsReconciliation=true;
   }else if(p.status==='pending'&&!p.needsReconciliation){
    const sub=await subscriptionService.activateFromPayment(p.userId,p.tier,p.durationMonths,'tezcheck',id);
    p.status='completed';p.approvedBy='tezcheck';p.approvedAt=new Date();p.subscriptionId=String(sub._id);p.grantId=id;
   }else if(p.status!=='completed'){throw new AppError('Payment needs review',409);}
   if(input.eventId)p.tezcheckEventIds=[...(p.tezcheckEventIds??[]),input.eventId].slice(-100);
   await p.save({session});return p.toJSON();
  });
 }
};
