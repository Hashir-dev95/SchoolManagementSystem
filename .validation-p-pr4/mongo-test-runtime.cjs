// Validation-only launch settings for this memory-constrained Windows host.
// Production code and test assertions remain untouched.
const {MongoMemoryReplSet,MongoMemoryServer}=require('../backend/node_modules/mongodb-memory-server');
const original=MongoMemoryServer.create;
MongoMemoryServer.create=function(options={}) {return original.call(this,{...options,instance:{...options.instance,launchTimeout:60000,args:[...(options.instance?.args||[]),'--wiredTigerCacheSizeGB','0.25']}})};
const repl=MongoMemoryReplSet.create;
MongoMemoryReplSet.create=function(options={}) {return repl.call(this,{...options,instanceOpts:(options.instanceOpts?.length?options.instanceOpts:[{}]).map(instance=>({...instance,launchTimeout:60000,args:[...(instance.args||[]),'--wiredTigerCacheSizeGB','0.25']}))})};

// Retain owned Mongo stdout/stderr/exit evidence when the host terminates it.
const fs=require('node:fs'),path=require('node:path');
const {MongoInstance}=require('../backend/node_modules/mongodb-memory-server-core/lib/util/MongoInstance');
const destination=path.join(__dirname,'mongo-'+process.pid+'.log');
for(const method of ['stdoutHandler','stderrHandler','closeHandler']){
 const original=MongoInstance.prototype[method];
 if(typeof original==='function')MongoInstance.prototype[method]=function(...args){fs.appendFileSync(destination,method+': '+args.map(String).join(' ')+'\n');return original.apply(this,args)};
}
