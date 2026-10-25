import assert from 'node:assert/strict';
import express from '../backend/node_modules/express';
import mongoose from '../backend/node_modules/mongoose';
import {MongoMemoryReplSet} from '../backend/node_modules/mongodb-memory-server';
import {principalResultRouter} from './original-result.routes';
import User from '../backend/src/models/user';
import Branch from '../backend/src/models/branch';
import {AcademicResult} from '../backend/src/models/academicResult';
import {generateAccessToken} from '../backend/src/services/jwt.service';
import {registerSession} from '../backend/src/services/session.service';
async function main(){
 process.env.JWT_SECRET='isolated-original-queue-reproduction';
 const db=await MongoMemoryReplSet.create({replSet:{count:1}});
 const app=express();app.use('/principal/results',principalResultRouter);const server=app.listen(0,'127.0.0.1');
 try{
  await mongoose.connect(db.getUri());await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve));
  const branch=await Branch.create({name:'Queue reproduction',code:'REPRO',address:'fixture',city:'fixture'});
  const actor=await User.create({fullName:'Principal',email:'repro@fixture.invalid',password:'fixture',role:'principal',branchId:branch._id});
  const token=generateAccessToken(String(actor._id),'principal');await registerSession(String(actor._id),token,'principal');
  await AcademicResult.collection.insertOne({branchId:branch._id,status:'moderated_approved',publishedAt:null,publishedRevision:null});
  const port=(server.address() as {port:number}).port;
  const response=await fetch('http://127.0.0.1:'+port+'/principal/results?state=awaiting_publication',{headers:{Authorization:'Bearer '+token}});
  console.log(JSON.stringify({originalQueueStatus:response.status,expectedQueueStatus:200,approvedUnpublishedRows:await AcademicResult.countDocuments({status:'moderated_approved'})}));
  assert.equal(response.status,200,'Original Principal router has no result return queue');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await mongoose.disconnect();await db.stop()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
