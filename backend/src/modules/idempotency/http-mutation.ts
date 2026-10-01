import type { Request, Response } from 'express';
import { withIdempotency } from './idempotency.service';
import { sendSuccess } from '../../utils/response';
export async function replyToMutation(req:Request,res:Response,owner:string,operation:string,work:()=>Promise<unknown>,status=200) {
  const key=req.get('Idempotency-Key')??req.body?.idempotencyKey;
  const result=await withIdempotency(owner,key,async()=>({status,data:await work()}),{
    operation,payload:{actor:req.auth?.userId,params:req.params,body:req.body,protocol:req.get('X-Client-Protocol')??'1'},
  });
  return sendSuccess(res,result.data,result.status);
}
