import { Schema, model, models } from 'mongoose';
// Receipt bytes are private DB documents. They are never put in the public
// product-image bucket or embedded in list responses.
const schema=new Schema({paymentId:{type:String,required:true,unique:true},userId:{type:String,required:true,index:true},contentType:{type:String,required:true},bytes:{type:Buffer,required:true,select:false}}, {collection:'payment_receipts',timestamps:true,versionKey:false});
export const PaymentReceiptModel=models.PaymentReceipt??model('PaymentReceipt',schema);
