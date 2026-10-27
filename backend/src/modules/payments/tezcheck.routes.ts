import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/async-handler';
import { validateRequest } from '../../middlewares/validate.middleware';
import { sendSuccess } from '../../utils/response';
import { createManualPaymentSchema } from './payment.validation';
import { tezcheckPayments } from './tezcheck.service';
const router=Router();
const id=z.object({id:z.string().regex(/^[a-f\d]{24}$/i)});
router.post('/',validateRequest({body:createManualPaymentSchema.extend({requestKey:z.string().min(1).max(128)})}),asyncHandler(async(req,res)=>sendSuccess(res,await tezcheckPayments.create(req.body))));
router.post('/:id/bill',validateRequest({params:id,body:z.object({telegramUserId:z.string().regex(/^\d+$/),billId:z.string().regex(/^link_[\w-]+$/),payUrl:z.string().url()})}),asyncHandler(async(req,res)=>sendSuccess(res,await tezcheckPayments.bind(String(req.params.id),req.body))));
// Only the trusted bot calls this after signature verification AND provider readback.
router.post('/:id/settle',validateRequest({params:id,body:z.object({
 billId:z.string().regex(/^link_[\w-]+$/),paymentId:z.string().regex(/^pay_[\w-]+$/),
 eventId:z.string().max(128).optional(),amountMinor:z.number().int().positive().safe(),netMinor:z.number().int().nonnegative().safe(),feeMinor:z.number().int().nonnegative().safe(),
 currency:z.literal('UZS'),environment:z.literal('live'),state:z.enum(['succeeded','partially_refunded','refunded','disputed','charged_back']),
 refundedMinor:z.number().int().nonnegative().safe(),
})}),asyncHandler(async(req,res)=>sendSuccess(res,await tezcheckPayments.settle(String(req.params.id),req.body))));
export const tezcheckRoutes=router;
