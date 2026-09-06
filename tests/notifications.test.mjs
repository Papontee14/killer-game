import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync('src/notifications.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function client({ok=true,key='AQID',existing=true}={}) {
 const requests=[];let subscriptions=0;
 const sub={toJSON:()=>({endpoint:'https://push.test/device',keys:{p256dh:'test',auth:'test'}})};
 const exports={};
 vm.runInNewContext(source,{exports,process:{env:{NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY:key}},window:{PushManager:{},atob:s=>Buffer.from(s,'base64').toString('binary')},navigator:{serviceWorker:{ready:Promise.resolve({pushManager:{getSubscription:async()=>existing?sub:null,subscribe:async()=>{subscriptions++;return sub;}}})}},fetch:async(url,options)=>{requests.push({url,options});return {ok};},AbortSignal,setTimeout,clearTimeout,Uint8Array});
 return {api:exports,requests,subscriptions:()=>subscriptions};
}
test('push setup reports backend failure instead of claiming it is ready',async()=>{
 const c=client({ok:false});assert.equal(await c.api.subscribeToWebPush('ABCDEF','token'),false);
});
test('push setup registers an existing device for the authenticated room',async()=>{
 const c=client();assert.equal(await c.api.subscribeToWebPush('ABCDEF','token'),true);
 assert.equal(c.subscriptions(),0);assert.equal(c.requests[0].options.headers.Authorization,'Bearer token');
 assert.equal(JSON.parse(c.requests[0].options.body).code,'ABCDEF');
});
test('push setup subscribes a new device; missing VAPID key reports failure',async()=>{
 const c=client({existing:false});assert.equal(await c.api.subscribeToWebPush('ABCDEF','token'),true);assert.equal(c.subscriptions(),1);
 const missing=client({key:''});assert.equal(await missing.api.subscribeToWebPush('ABCDEF','token'),false);assert.equal(missing.requests.length,0);
});
test('room push request survives page navigation',async()=>{
 const c=client();await c.api.notifyRoomParticipants('ABCDEF');assert.equal(c.requests[0].options.keepalive,true);
});
test('room push request can select a notification kind',async()=>{
 const c=client();await c.api.notifyRoomParticipants('ABCDEF',undefined,undefined,'evidence');
 assert.equal(JSON.parse(c.requests[0].options.body).kind,'evidence');
});
