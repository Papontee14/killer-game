import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
function worker() {
 const handlers={},cached=[],deleted=[],notifications=[];
 const self={location:{origin:'https://game.test'},addEventListener:(type,fn)=>handlers[type]=fn,skipWaiting:()=>{},clients:{claim:async()=>{}},registration:{showNotification:async(...args)=>notifications.push(args)}};
 const caches={open:async()=>({addAll:async()=>{},put:async(request)=>cached.push(request.url)}),keys:async()=>['killer-shell-v2','killer-shell-v3','unrelated-app'],delete:async(key)=>deleted.push(key),match:async()=>undefined};
 vm.runInNewContext(source,{self,caches,URL,Response,fetch:async()=>new Response('ok')});
 return {handlers,cached,deleted,notifications};
}
test('service worker ignores APIs, room pages, Storage URLs and signed images; only shell/static assets are cached',async()=>{
 const {handlers,cached}=worker();
 for(const path of ['/room/ABCDEF','/rest/v1/rpc/get_room_view','/storage/v1/object/sign/evidence/a?token=private','/?secret=123','https://db.test/storage/v1/object/evidence/a']){
  let intercepted=false;
  handlers.fetch({request:{method:'GET',url:new URL(path,'https://game.test').href},respondWith:()=>{intercepted=true;}});
  assert.equal(intercepted,false,path);
 }
 for(const path of ['/','/manifest.webmanifest','/_next/static/app.js']) {
  let response;
  handlers.fetch({request:{method:'GET',url:'https://game.test'+path},respondWith:promise=>{response=promise;}});
  await response;
 }
 assert.equal(cached.length,3);
});
test('activation removes old evidence-containing shell cache; push notification stays generic',async()=>{
 const {handlers,deleted,notifications}=worker();
 let done;handlers.activate({waitUntil:promise=>done=promise});await done;
 assert.deepEqual(deleted,['killer-shell-v2']);
 handlers.push({data:{text:()=> 'secret target and hearts'},waitUntil:promise=>done=promise});await done;
 assert.equal(notifications[0][1].body,'มีเหตุการณ์ใหม่ในห้อง เปิดเว็บเพื่อดูรายละเอียด');
});
