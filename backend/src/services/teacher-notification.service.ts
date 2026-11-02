import {createHash} from 'node:crypto';
import mongoose from 'mongoose';
import SchoolNotice from '../models/schoolNotice';
import Session from '../models/session';
import {Notification,NotificationReadOperation, NOTIFICATION_CATEGORIES} from '../models/notification';
import {TeacherNotificationPreference} from '../models/teacherNotificationPreference';
import {getTeacherScope} from './teacher-scope.service';
import {schoolTimezone} from './school-date.service';
import {objectBody, objectIdField, textField, RequestContractError} from '../utils/request-validation';
import {createInternalNotification,listOwnNotifications,notificationInboxQuery,getOwnNotification,markOwnNotificationRead} from './notification.service';
import type {JwtPayload} from './jwt.service';

type Identity=JwtPayload|undefined;
const optionalCategories=NOTIFICATION_CATEGORIES.filter(value=>value!=='system');
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const opId=(value:unknown)=>{const valueText=textField(value,'client operation ID',80,16);if(!/^[A-Za-z0-9_-]+$/.test(valueText))throw new RequestContractError(400,'Invalid client operation ID');return valueText;};
const expectedRevision=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new RequestContractError(400,'Invalid preference revision');return value;};
const clock=(value:unknown,name:string)=>{if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new RequestContractError(400,`Invalid ${name}`);return value;};

const teacherContext=async(identity:Identity)=>{const scope=await getTeacherScope(identity);return{teacherId:scope.actorId,branchId:scope.branchId};};
export {createInternalNotification} from './notification.service';

export const reconcileTeacherNotifications=async(identity:Identity)=>{const ctx=await teacherContext(identity);const now=new Date();const notices:any[]=await (SchoolNotice as any).find({branchId:ctx.branchId,status:'published',audienceRoles:'teacher',publishedAt:{$lte:now},$or:[{expiresAt:{$exists:false}},{expiresAt:null},{expiresAt:{$gt:now}}]}).sort({publishedAt:-1}).limit(100).read('primary');
  for(const notice of notices){const availableAt=notice.publishedAt??notice.createdAt;if(await Notification.exists({recipientUserId:ctx.teacherId,sourceType:'school_notice',sourceId:notice._id,sourceRevision:Math.max(1,availableAt.getTime()),eventType:'school_notice_published'}).read('primary'))continue;await createInternalNotification({recipientUserId:ctx.teacherId,branchId:ctx.branchId,sourceType:'school_notice',sourceId:String(notice._id),sourceRevision:Math.max(1,availableAt.getTime()),eventType:'school_notice_published',category:'notice',title:notice.title,body:notice.message,deepLinkType:'inbox_notice',deepLinkTargetId:String(notice._id),priority:notice.priority,availableAt});}
};

export const listTeacherNotifications=async(identity:Identity,query:unknown)=>{
  // Preserve the existing notice producer and fixed-50 default for legacy clients.
  const input=notificationInboxQuery(query,50);
  await reconcileTeacherNotifications(identity);
  return listOwnNotifications(identity,input);
};
export const getTeacherNotification=async(identity:Identity,id:unknown)=>{await teacherContext(identity);return getOwnNotification(identity,id);};
export const markTeacherNotificationRead=async(identity:Identity,id:unknown,body:unknown,token:string)=>{await teacherContext(identity);return markOwnNotificationRead(identity,id,body,token);};

const defaultPreference=(ctx:{teacherId:string;branchId:string})=>({teacherId:ctx.teacherId,branchId:ctx.branchId,enabledCategories:[...optionalCategories],quietHours:{enabled:false,start:'22:00',end:'07:00',timezone:schoolTimezone()},revision:0,updatedAt:null});
const preferenceDTO=(row:any,ctx:{teacherId:string;branchId:string})=>row?{enabledCategories:[...row.enabledCategories],quietHours:{enabled:row.quietHours.enabled,start:row.quietHours.start,end:row.quietHours.end,timezone:row.quietHours.timezone},revision:row.revision,updatedAt:row.updatedAt.toISOString()}:defaultPreference(ctx);
export const getTeacherNotificationPreferences=async(identity:Identity)=>{const ctx=await teacherContext(identity),row=await TeacherNotificationPreference.findOne({teacherId:ctx.teacherId,branchId:ctx.branchId}).read('primary');return preferenceDTO(row,ctx);};
export const saveTeacherNotificationPreferences=async(identity:Identity,body:unknown)=>{const input=objectBody(body,['enabledCategories','quietHours','revision','clientOperationId']);if(!Array.isArray(input.enabledCategories)||input.enabledCategories.some(value=>typeof value!=='string'||!optionalCategories.includes(value as any))||new Set(input.enabledCategories).size!==input.enabledCategories.length)throw new RequestContractError(400,'Invalid notification categories');if(!input.quietHours||typeof input.quietHours!=='object'||Array.isArray(input.quietHours))throw new RequestContractError(400,'Invalid quiet hours');const quiet=objectBody(input.quietHours,['enabled','start','end']);if(typeof quiet.enabled!=='boolean')throw new RequestContractError(400,'Invalid quiet hours');const start=clock(quiet.start,'quiet-hours start'),end=clock(quiet.end,'quiet-hours end');if(start===end)throw new RequestContractError(400,'Quiet-hours start and end must differ');const revision=expectedRevision(input.revision),operation=opId(input.clientOperationId),ctx=await teacherContext(identity),normalized={enabledCategories:[...(input.enabledCategories as string[])].sort(),quietHours:{enabled:quiet.enabled,start,end,timezone:schoolTimezone()}},fingerprint=hash(normalized),Preference:any=TeacherNotificationPreference;let prior:any=await Preference.findOne({teacherId:ctx.teacherId}).select('+history').read('primary');const replay=prior?.history.find((entry:any)=>entry.operationId===operation);if(replay){if(replay.fingerprint!==fingerprint)throw new RequestContractError(409,'Operation ID was reused');return preferenceDTO(prior,ctx);}if(prior&&String(prior.branchId)!==ctx.branchId)throw new RequestContractError(409,'Preference branch changed; refresh and retry');const now=new Date();try{if(!prior){if(revision!==0)throw new RequestContractError(409,'Preferences changed; refresh and retry');prior=await Preference.create({teacherId:ctx.teacherId,branchId:ctx.branchId,...normalized,revision:1,history:[{revision:1,actorId:ctx.teacherId,changedAt:now,operationId:operation,fingerprint}]});}else{prior=await Preference.findOneAndUpdate({_id:prior._id,teacherId:ctx.teacherId,branchId:ctx.branchId,revision},{$set:normalized,$inc:{revision:1},$push:{history:{revision:revision+1,actorId:ctx.teacherId,changedAt:now,operationId:operation,fingerprint}}},{returnDocument:'after',runValidators:true});if(!prior)throw new RequestContractError(409,'Preferences changed; refresh and retry');}}catch(error){if((error as{code?:number}).code===11000)throw new RequestContractError(409,'Preferences changed; refresh and retry');throw error;}return preferenceDTO(prior,ctx);};

const sessionDTO=(row:any,currentToken:string)=>({sessionId:String(row._id),label:'School app session',createdAt:row.createdAt.toISOString(),current:row.token===currentToken,revoked:row.isRevoked,revokedAt:row.revokedAt?.toISOString()??null});
export const listTeacherSessions=async(identity:Identity,currentToken:string)=>{const ctx=await teacherContext(identity),rows=await Session.find({userId:ctx.teacherId,role:'teacher'}).sort({createdAt:-1}).read('primary');return{items:rows.map(row=>sessionDTO(row,currentToken)),total:rows.length,currentSessionPolicy:'sign_out_only' as const};};
export const revokeOwnTeacherSession=async(identity:Identity,currentToken:string,id:unknown)=>{const ctx=await teacherContext(identity),sessionId=objectIdField(id,'session ID'),row=await Session.findOne({_id:sessionId,userId:ctx.teacherId,role:'teacher'}).read('primary');if(!row)throw new RequestContractError(404,'Session is unavailable');if(row.token===currentToken)throw new RequestContractError(409,'Use Log out to revoke the current session');if(!row.isRevoked){row.isRevoked=true;row.revokedAt=new Date();row.revokedBy=new mongoose.Types.ObjectId(ctx.teacherId);await row.save();}return sessionDTO(row,currentToken);};
export const ensureTeacherNotificationIndexes=async()=>{await Promise.all([Notification.createIndexes(),NotificationReadOperation.createIndexes(),TeacherNotificationPreference.createIndexes()]);};
