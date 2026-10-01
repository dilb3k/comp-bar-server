import { Schema, model, models } from 'mongoose';
const schema = new Schema({
  paymentId:{type:String,required:true,unique:true}, userId:{type:String,required:true,index:true},
  subscriptionId:{type:String,required:true}, tier:{type:String,required:true}, durationMonths:{type:Number,required:true},
  previousEndDate:{type:Date,default:null}, endDate:{type:Date,required:true},
}, {collection:'subscription_grants',timestamps:true,versionKey:false});
export const SubscriptionGrantModel=models.SubscriptionGrant??model('SubscriptionGrant',schema);
