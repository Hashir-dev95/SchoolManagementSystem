const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const suites=['principal-commit-authority','principal-authorization','principal-write','approval-authority','student-admission','student-enrollment','academic-setup','class-subject','teacher-assignment-admin','teacher-timetable','teacher-attendance','attendance-amendment','academic-foundation','academic','academic-work','academic-evidence','lesson-delivery','catch-up','teacher-provisioning','teacher-communications','staff-self-service','academic-result'];
const results=[];
for(const suite of suites){
 const file='tests/'+suite+'.security.test.ts';
 const priorPath='.validation-p-pr4/'+suite+'.log';
 if(fs.existsSync(priorPath)){const prior=fs.readFileSync(priorPath,'utf8');const pass=Number(prior.match(/pass ([0-9]+)/)?.[1]||0);if(pass>0&&/fail 0/.test(prior)&&/cancelled 0/.test(prior)&&/skipped 0/.test(prior)){const record={suite,exit:0,pass,fail:0,skipped:0};results.push(record);fs.writeFileSync('.validation-p-pr4/backend-results.json',JSON.stringify(results,null,2));process.stdout.write(JSON.stringify(record)+'\n');continue;}}
 const destination='.validation-p-pr4/'+suite+'.log';
 const fd=fs.openSync(destination,'w');
 const result=spawnSync(process.execPath,['--require',path.resolve('.validation-p-pr4/mongo-test-runtime.cjs'),'--import','./node_modules/tsx/dist/loader.mjs','--test',file],{cwd:path.resolve('backend'),stdio:['ignore',fd,fd],timeout:600000,env:{...process.env,GOMAXPROCS:'2',MONGOMS_VERSION:'7.0.14',TEMP:path.resolve('.validation-p-pr4/tmp'),TMP:path.resolve('.validation-p-pr4/tmp')}});
 fs.closeSync(fd);
 const output=fs.readFileSync(destination,'utf8');
 const count=name=>Number(output.match(new RegExp(name+' ([0-9]+)'))?.[1]||0);
 const record={suite,exit:result.status,pass:count('pass'),fail:count('fail'),skipped:count('skipped'),error:result.error?.message};results.push(record);
 fs.writeFileSync('.validation-p-pr4/backend-results.json',JSON.stringify(results,null,2));process.stdout.write(JSON.stringify(record)+'\n');
}
process.exitCode=results.some(r=>r.exit!==0||r.fail>0||r.pass===0)?1:0;
