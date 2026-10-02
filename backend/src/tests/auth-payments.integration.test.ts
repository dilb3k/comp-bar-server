import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { UserModel } from '../modules/auth/user.model';
import { authService } from '../modules/auth/auth.service';
import { authRepository } from '../modules/auth/auth.repository';
import { authenticate } from '../modules/auth/auth.middleware';
import { hashOtp, signAccessToken, signRefreshToken } from '../modules/auth/auth.utils';
import { SessionChallengeModel } from '../modules/auth/session-challenge.model';
import { PaymentModel } from '../modules/payments/payment.model';
import { PaymentReceiptModel } from '../modules/payments/payment-receipt.model';
import { paymentService } from '../modules/payments/payment.service';
import { SubscriptionModel } from '../modules/subscriptions/subscription.model';
import { SubscriptionGrantModel } from '../modules/subscriptions/subscription-grant.model';
import { subscriptionService } from '../modules/subscriptions/subscription.service';
import { OwnerWriteVersion } from '../lib/transaction';
import { AuditEventModel } from '../modules/audit/audit.model';
import * as ocr from '../utils/ocr';
import * as imageProcessing from '../utils/image-processing';

before(async()=>{
  assert.match(process.env.MONGODB_URL??'',/^mongodb:\/\/127\.0\.0\.1:\d+\/hisvex_integration\?/);
  await mongoose.connect(process.env.MONGODB_URL!,{maxPoolSize:30});
  await Promise.all([UserModel,SessionChallengeModel,PaymentModel,PaymentReceiptModel,SubscriptionModel,SubscriptionGrantModel,OwnerWriteVersion,AuditEventModel].map(m=>m.init()));
});
after(async()=>{await mongoose.disconnect()});
let telegramSequence=100000;
async function user(extra:Record<string,unknown>={}) {
  return UserModel.create({username:randomUUID(),password:'test-password-123',phone_number:`99890${++telegramSequence}`,role:'admin',isActive:true,activeSessionId:randomUUID(),telegramId:String(telegramSequence),...extra});
}
const actor=(u:any)=>({userId:u._id.toString(),username:u.username,phone_number:u.phone_number,role:u.role,isPayed:true,tier:'pro' as const,sessionId:u.activeSessionId});
const admin=()=>({userId:new mongoose.Types.ObjectId().toString(),username:'test-admin',role:'superAdmin' as const,phone_number:'',isPayed:true,tier:'pro' as const});
async function authenticateUser(u:any,overrides:Record<string,unknown>={}) {
  const req:any={headers:{authorization:`Bearer ${signAccessToken({...actor(u),...overrides})}`}};
  let error:any;await authenticate()(req,{} as any,e=>{error=e});return {req,error};
}
async function payment(u:any,method:'manual_card'|'click'='manual_card') {
  const data={userId:u._id.toString(),telegramUserId:u.telegramId,tier:'bor' as const,durationMonths:1 as const};
  return method==='click'?paymentService.createClickPending(data):paymentService.createManualPayment(data);
}
async function paid(u:any) {
  return SubscriptionModel.create({userId:u._id.toString(),tier:'bor',startDate:new Date(),endDate:new Date('2030-01-15T00:00:00Z'),isActive:true,activatedBy:'test',reminderSentAt:new Date()});
}

test('current role and expiry override a stale paid/superadmin JWT',async()=>{
  const u=await user({isPayed:true});
  await SubscriptionModel.create({userId:u._id.toString(),tier:'pro',startDate:new Date(0),endDate:new Date(10000),isActive:true,activatedBy:'test'});
  const {req,error}=await authenticateUser(u,{role:'superAdmin',tier:'pro',isPayed:true});
  assert.equal(error,undefined);assert.equal(req.auth.role,'admin');assert.equal(req.auth.tier,'tekin');assert.equal(req.auth.isPayed,false);
});
test('auth DB outage returns 503 and never claims the session expired',async()=>{
  const u=await user();const original=authRepository.findById;
  authRepository.findById=async()=>{throw Error('test DB unavailable')};
  try {assert.equal((await authenticateUser(u)).error.statusCode,503)}finally{authRepository.findById=original}
});
test('legacy phone endpoint obeys OTP policy; failed OTP delivery cannot downgrade verification',async()=>{
  const u=await user({telegramId:null});
  await assert.rejects(authService.loginWithPhoneVerification(u.username,'test-password-123',u.phone_number,'new-device'),(e:any)=>e.code==='PHONE_OWNERSHIP_REQUIRED');
  await UserModel.updateOne({_id:u._id},{$set:{telegramId:String(++telegramSequence)}});
  // Test configuration has no Telegram token: no network request is made.
  await assert.rejects(authService.loginWithPhoneVerification(u.username,'test-password-123',u.phone_number,'new-device'),(e:any)=>e.code==='OTP_DELIVERY_FAILED');
  assert.equal((await UserModel.findById(u._id))!.activeSessionId,u.activeSessionId);
});
test('an active session cannot bypass verification just because the legacy account has no phone',async()=>{
  const u=await user({phone_number:'',telegramId:null});
  await assert.rejects(authService.login(u.username,'test-password-123','new-device'),(e:any)=>e.code==='PHONE_OWNERSHIP_REQUIRED');
  assert.equal((await UserModel.findById(u._id))!.activeSessionId,u.activeSessionId);
});
test('a remembered device ID cannot bypass an active session takeover challenge',async()=>{
  const u=await user({verifiedDeviceIds:['remembered-device'],telegramId:null});
  await assert.rejects(authService.login(u.username,'test-password-123','remembered-device'),(e:any)=>e.code==='PHONE_OWNERSHIP_REQUIRED');
  await assert.rejects(authService.loginWithPhoneVerification(u.username,'test-password-123',u.phone_number,'remembered-device'),(e:any)=>e.code==='PHONE_OWNERSHIP_REQUIRED');
  assert.equal((await UserModel.findById(u._id))!.activeSessionId,u.activeSessionId);
});
test('concurrent initial logins cannot silently replace the first established session',async()=>{
  const u=await user({activeSessionId:null,telegramId:null});
  const outcomes=await Promise.allSettled(Array.from({length:8},(_,i)=>authService.login(u.username,'test-password-123',`race-${i}`)));
  const successes=outcomes.filter((r):r is PromiseFulfilledResult<any>=>r.status==='fulfilled');
  assert.equal(successes.length,1);
  const payload=JSON.parse(Buffer.from(successes[0].value.token.split('.')[1],'base64url').toString());
  assert.equal((await UserModel.findById(u._id))!.activeSessionId,payload.sessionId);
});
test('password reset invalidates access, refresh, trusted devices and old OTP challenges',async()=>{
  const u=await user({verifiedDeviceIds:['old-device']});const token=signRefreshToken({userId:u._id.toString(),sessionId:u.activeSessionId!});
  const c=await SessionChallengeModel.create({userId:u._id.toString(),securityVersion:0,deviceId:'old-device',otpHash:hashOtp('123456'),expiresAt:new Date(Date.now()+60000)});
  await authRepository.updateAdmin(u._id.toString(),{password:'new-test-password-456'});
  assert.equal((await authenticateUser(u)).error.statusCode,401);
  const preview:any={headers:{authorization:`Bearer ${signAccessToken(actor(u))}`}};let previewError:any;
  await authenticate({allowStale:true})(preview,{} as any,error=>{previewError=error});assert.equal(previewError.code,'SESSION_REVOKED');
  await assert.rejects(authService.refresh(token),(e:any)=>e.statusCode===401);
  await assert.rejects(authService.verifySessionChallenge(c._id.toString(),'123456','old-device'),(e:any)=>e.statusCode===410);
  assert.equal((await UserModel.findById(u._id))!.verifiedDeviceIds.length,0);
  assert.equal((await SessionChallengeModel.findById(c._id))!.consumed,false);
});
test('local lock PIN is never included in a signed access-token payload',()=>{
  const token=signAccessToken({...admin(),blockCode:'1234'});
  const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());assert.equal('blockCode' in payload,false);
});
test('parallel OTP completion issues only one session; device, expiry and attempt limit are enforced',async()=>{
  const u=await user();const data={userId:u._id.toString(),securityVersion:0,deviceId:'A',otpHash:hashOtp('123456'),expiresAt:new Date(Date.now()+60000)};
  const c=await SessionChallengeModel.create(data);
  await assert.rejects(authService.verifySessionChallenge(c._id.toString(),'123456','B'),(e:any)=>e.statusCode===403);
  const outcomes=await Promise.allSettled(Array.from({length:8},()=>authService.verifySessionChallenge(c._id.toString(),'123456','A')));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  const locked=await SessionChallengeModel.create(data);
  for(let i=0;i<3;i++) await assert.rejects(authService.verifySessionChallenge(locked._id.toString(),'000000','A'));
  await assert.rejects(authService.verifySessionChallenge(locked._id.toString(),'123456','A'),(e:any)=>e.statusCode===429);
  const expired=await SessionChallengeModel.create({...data,expiresAt:new Date(Date.now()-1000)});
  await assert.rejects(authService.verifySessionChallenge(expired._id.toString(),'123456','A'),(e:any)=>e.statusCode===410);
});
test('stale logout cannot clear a replacement session; old account header is rejected',async()=>{
  const u=await user();const replacement=randomUUID();await UserModel.updateOne({_id:u._id},{$set:{activeSessionId:replacement}});
  await authService.logout(u._id.toString(),u.activeSessionId!);assert.equal((await UserModel.findById(u._id))!.activeSessionId,replacement);
  const req:any={headers:{authorization:`Bearer ${signAccessToken(actor(u))}`,'x-account-id':'another'}};let error:any;
  await authenticate()(req,{} as any,e=>{error=e});assert.equal(error.code,'ACCOUNT_CHANGED');
});
test('Telegram linkage requires matching verified contact and cannot replace an existing link',async()=>{
  const u=await user({telegramId:null});const id=String(++telegramSequence);
  await assert.rejects(paymentService.linkTelegram(u._id.toString(),id));
  await paymentService.linkTelegram(u._id.toString(),id,undefined,u.phone_number);
  await paymentService.linkTelegram(u._id.toString(),id,undefined,u.phone_number);
  await assert.rejects(paymentService.linkTelegram(u._id.toString(),String(++telegramSequence),undefined,u.phone_number));
  const other=await user({telegramId:null});
  await assert.rejects(paymentService.linkTelegram(other._id.toString(),id,undefined,other.phone_number));
  assert.equal((await UserModel.findById(u._id))!.telegramId,id);
});
test('many receipt-free payments coexist; linked-account isolation is checked',async()=>{
  const u=await user();const payments=await Promise.all(Array.from({length:20},()=>payment(u)));
  assert.equal(payments.length,20);assert.equal(payments[0].receiptHash,undefined);
  await assert.rejects(paymentService.createManualPayment({userId:u._id.toString(),telegramUserId:'another',tier:'bor',durationMonths:1}));
  await assert.rejects(paymentService.submitCardDetails(payments[0].id,'86001234','Test owner','another'));
});
test('16 parallel approvals and unknown-response retry grant exactly once',async()=>{
  const u=await user();const original=await paid(u);const p=await payment(u);
  await Promise.all(Array.from({length:16},()=>paymentService.approveManualPayment(p.id,'test')));
  await paymentService.approveManualPayment(p.id,'test');
  const sub=await SubscriptionModel.findById(original._id);
  assert.equal(sub!.endDate.toISOString(),'2030-02-15T00:00:00.000Z');assert.equal(sub!.reminderSentAt,null);
  assert.equal(await SubscriptionGrantModel.countDocuments({paymentId:p.id}),1);
  assert.equal((await PaymentModel.findById(p.id))!.subscriptionId,original._id.toString());
});
test('parallel distinct payments retain all purchased months; other accounts remain isolated',async()=>{
  const a=await user(),b=await user();const sa=await paid(a),sb=await paid(b);
  const payments=await Promise.all(Array.from({length:8},(_,i)=>payment(i%2?a:b)));
  await Promise.all(payments.map(p=>paymentService.approveManualPayment(p.id,'test')));
  for(const s of [sa,sb]) assert.equal((await SubscriptionModel.findById(s._id))!.endDate.toISOString(),'2030-05-15T00:00:00.000Z');
  assert.equal(await SubscriptionGrantModel.countDocuments({userId:a._id.toString()}),4);
});
test('failure after subscription/grant write rolls back payment, entitlement and audit; retry applies once',async()=>{
  const u=await user();const sub=await paid(u);const p=await payment(u);const original=PaymentModel.prototype.save;
  PaymentModel.prototype.save=async function(this:any,...args:any[]) {if(this._id.toString()===p.id&&this.status==='completed')throw Error('injected crash before commit');return original.apply(this,args)};
  try {await assert.rejects(paymentService.approveManualPayment(p.id,'test'),/injected crash/)}finally{PaymentModel.prototype.save=original}
  assert.equal((await PaymentModel.findById(p.id))!.status,'pending');
  assert.equal((await SubscriptionModel.findById(sub._id))!.endDate.toISOString(),'2030-01-15T00:00:00.000Z');
  assert.equal(await SubscriptionGrantModel.countDocuments({paymentId:p.id}),0);
  assert.equal(await AuditEventModel.countDocuments({ownerAdminId:u._id.toString()}),0);
  await paymentService.approveManualPayment(p.id,'test');assert.equal(await SubscriptionGrantModel.countDocuments({paymentId:p.id}),1);
});
test('rejecting an old provisional receipt never revokes unrelated paid time and remains in admin review',async()=>{
  const u=await user();const sub=await paid(u);const p=await payment(u);await PaymentModel.updateOne({_id:p.id},{$set:{status:'provisioned'}});
  const result=await paymentService.rejectPayment(p.id,'test','not verified');assert.equal(result.wasDowngraded,false);assert.equal(result.needsReconciliation,true);
  assert.equal((await SubscriptionModel.findById(sub._id))!.endDate.toISOString(),'2030-01-15T00:00:00.000Z');
  assert.ok((await paymentService.getPending()).some((row:any)=>row.id===p.id));
  await paymentService.rejectPayment(p.id,'test','repeat');
});
test('Click complete binds exact payment/transaction, deduplicates and rejects stale cancellation',async()=>{
  const u=await user();const p=await payment(u,'click');const doc=await PaymentModel.findById(p.id);
  await assert.rejects(paymentService.completeClickPayment(doc!,'1234',new mongoose.Types.ObjectId().toString()));
  await Promise.all(Array.from({length:6},()=>paymentService.completeClickPayment(doc!,'1234',p.id)));
  await assert.rejects(paymentService.completeClickPayment(doc!,'5678',p.id));
  await assert.rejects(paymentService.cancelClickPayment(doc!));
  assert.equal(await SubscriptionGrantModel.countDocuments({paymentId:p.id}),1);
  assert.equal((await PaymentModel.findById(p.id))!.status,'completed');
});
test('a reminder for an old period cannot mark the renewed period as already reminded',async()=>{
  const u=await user();const sub=await paid(u);const prior=sub.endDate.toISOString();await subscriptionService.activate(admin(),u._id.toString(),'bor',1);
  await subscriptionService.markReminderSent(sub._id.toString(),prior);assert.equal((await SubscriptionModel.findById(sub._id))!.reminderSentAt,null);
  const current=(await SubscriptionModel.findById(sub._id))!;await subscriptionService.markReminderSent(sub._id.toString(),current.endDate.toISOString());
  assert.ok((await SubscriptionModel.findById(sub._id))!.reminderSentAt);
});
test('OCR matching is advisory, private receipt retry is immutable, and no subscription is granted',async()=>{
  const u=await user();const p=await payment(u);const originalOcr=ocr.runOcr;const originalImage=imageProcessing.processImageToWebp;
  (ocr as any).runOcr=async()=>`${p.amount} UZS`; (imageProcessing as any).processImageToWebp=async()=>({buffer:Buffer.from('private receipt'),contentType:'image/webp',hash:'test'});
  try {
    const file={buffer:Buffer.from('unique:'+p.id),mimetype:'image/png'};
    const result=await paymentService.attachReceipt(p.id,'telegram-file',file,u.telegramId!);
    assert.equal(result.provisioned,false);assert.equal(result.payment.status,'pending');assert.equal(result.payment.receiptImageUrl,null);
    await paymentService.attachReceipt(p.id,'telegram-file',file,u.telegramId!);
    assert.equal(await SubscriptionGrantModel.countDocuments({userId:u._id.toString()}),0);
    assert.equal(await SubscriptionModel.countDocuments({userId:u._id.toString()}),0);
    assert.equal(await PaymentReceiptModel.countDocuments({paymentId:p.id}),1);
    await assert.rejects(paymentService.attachReceipt(p.id,'wrong-owner',file,'foreign'));
    const another=await payment(u);await assert.rejects(paymentService.attachReceipt(another.id,'same-bytes',file,u.telegramId!));
    assert.equal((await PaymentModel.findById(another.id))!.receiptHash,undefined);
  } finally {(ocr as any).runOcr=originalOcr;(imageProcessing as any).processImageToWebp=originalImage}
});
