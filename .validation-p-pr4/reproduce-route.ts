import assert from 'node:assert/strict';
import {principalResultRouter} from './original-result.routes';
const routes=(principalResultRouter as any).stack.filter((layer:any)=>layer.route).map((layer:any)=>({path:layer.route.path,methods:Object.keys(layer.route.methods)}));
console.log(JSON.stringify({originalPrincipalResultRoutes:routes,hasReturnQueue:routes.some((route:any)=>route.path==='/'&&route.methods.includes('get'))}));
assert.ok(routes.some((route:any)=>route.path==='/'&&route.methods.includes('get')),'Original router has no canonical return queue for approved/unpublished results');
