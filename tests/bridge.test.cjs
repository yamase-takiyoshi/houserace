const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script id="oneFileBridge38">([\s\S]*?)<\/script>/)[1];
const pc='https://race.netkeiba.com/race/result.html?race_id=202606040201';
const sp='https://race.sp.netkeiba.com/?pid=race_result&race_id=202606040201';
const odds='https://race.netkeiba.com/api/api_get_jra_odds.html?race_id=202606040201&type=b1&action=update';
const body='<html><title>結果</title><table><tr><td>テスト用結果</td></tr></table></html>';

function harness(t,options={}){
  const listeners=[],timers=new Set(),requests=[],proxies=[],elements=new Map();
  const storage=new Map(Object.entries(options.storage||{}));
  for(const id of ['bridgeConnection38','bridgeDetail38','bridgeRetry38']) elements.set(id,{});
  const w={console,URL,AbortController,location:{origin:'https://yamase-takiyoshi.github.io'},
    document:{readyState:'complete',getElementById:id=>elements.get(id),addEventListener(){}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    setTimeout(fn,ms){const id=setTimeout(()=>{timers.delete(id);fn();},Math.max(1,ms/100));timers.add(id);return id;},
    clearTimeout(id){clearTimeout(id);timers.delete(id);},
    addEventListener(type,fn){if(type==='message')listeners.push(fn);},
    postMessage(data,targetOrigin){
      assert.equal(targetOrigin,w.location.origin);
      if(data.__narBridge==='request'){
        requests.push(data);
        if(options.request) options.request(data,emit);
        else queueMicrotask(()=>emit({__narBridge:'response',id:data.id,status:200,text:body,finalUrl:data.url,version:'1.7.7'}));
      }else if(options.ready!==false){
        queueMicrotask(()=>emit({__narBridge:'pong',version:'1.7.7'}));
      }
    },
    async fetch(url,init){
      proxies.push(url);
      if(options.proxy) return options.proxy(url,init);
      return new Response(body,{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
    }
  };
  let windowRef;
  function emit(data,source=windowRef,origin=w.location.origin){
    for(const listener of listeners) listener({data,source,origin});
  }
  if(options.direct) w.__narBridgeDirect=options.direct;
  if(options.existing) w.__narBridgeFetch=options.existing;
  w.window=w;
  const context=vm.createContext(w);
  windowRef=vm.runInContext('window',context);
  vm.runInContext(script,context,{filename:'oneFileBridge38.js'});
  t.after(()=>{for(const id of timers)clearTimeout(id);});
  return {w,emit,requests,proxies,elements,storage};
}

test('all inline scripts compile',()=>{
  let count=0;
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    if(match[1].trim()){new vm.Script(match[1]);count++;}
  }
  assert.equal(count,21);
});

test('existing postMessage Bridge handshakes and returns the correlated result',async t=>{
  const h=harness(t);
  const result=await h.w.__oneFileBridgeFetch(pc);
  assert.equal(result.status,200);
  assert.equal(result.text,body);
  assert.equal(result.via,'住宅IP Bridge');
  assert.equal(h.requests.length,1);
  assert.equal(h.proxies.length,0);
  assert.equal(h.w.__narBridgeVersion,'1.7.7');
  assert.match(h.elements.get('bridgeConnection38').textContent,/Bridge接続済み 1.7.7/);
});

test('out-of-order responses stay with their own request',async t=>{
  const queued=[];
  const h=harness(t,{request:(data,emit)=>{
    queued.push({data,emit});
    if(queued.length===2) for(const x of [...queued].reverse())
      x.emit({__narBridge:'response',id:x.data.id,status:200,text:body+x.data.url});
  }});
  const [a,b]=await Promise.all([h.w.__oneFileBridgeFetch(pc),h.w.__oneFileBridgeFetch(sp)]);
  assert.equal(a.text,body+pc);assert.equal(b.text,body+sp);
});

test('native absence does not disable Worker requests or claim a connection',async t=>{
  const h=harness(t,{ready:false});
  const first=await h.w.__oneFileBridgeFetch(pc);
  assert.equal(first.status,200);assert.equal(first.via,'Cloudflare');
  assert.equal(h.w.__bridgeAbsent,true);
  const second=await h.w.__oneFileBridgeFetch(odds);
  assert.equal(second.status,200);
  assert.equal(h.requests.length,0);
  assert.equal(h.w.__houseraceBridgeStatus.connected,false);
  assert.equal(h.elements.get('bridgeConnection38').textContent,'Bridge未検出');
});

test('late Bridge ready message recovers a previously absent connection',async t=>{
  const h=harness(t,{ready:false});
  await h.w.__oneFileBridgeFetch(pc);
  assert.equal(h.w.__bridgeAbsent,true);
  h.emit({__narBridge:'ready',version:'1.7.7'});
  const r=await h.w.__oneFileBridgeFetch(pc);
  assert.equal(h.w.__bridgeAbsent,false);assert.equal(r.via,'住宅IP Bridge');
});

test('existing direct client is preserved, including text, responseText and Response forms',async t=>{
  for(const raw of [body,{status:200,responseText:body},new Response(body)]){
    const existing=async url=>{assert.equal(url,pc);return raw;};
    const h=harness(t,{ready:false,existing});
    const r=await h.w.__oneFileBridgeFetch(pc);
    assert.equal(h.w.__narBridgeFetch,existing);
    assert.equal(r.text,body);assert.equal(r.via,'住宅IP Bridge');
  }
});

test('HTTP 400 remains an upstream error, not a disconnected Bridge or a false HTTP 200',async t=>{
  const h=harness(t,{
    request:(d,emit)=>emit({__narBridge:'response',id:d.id,status:400,text:'bad request'}),
    proxy:()=>new Response('unavailable',{status:503})
  });
  const r=await h.w.__oneFileBridgeFetch(pc);
  assert.notEqual(r.status,200);assert.equal(r.text,'');
  assert.match(r.error,/住宅IP Bridge HTTP 400/);
  assert.match(r.error,/Cloudflare HTTP 503/);
  assert.equal(h.w.__houseraceBridgeStatus.connected,true);
});

test('Worker bridge envelope falls back once and preserves the complete odds query',async t=>{
  const h=harness(t,{proxy:()=>new Response(JSON.stringify({ok:false,needBridge:true,error:'upstream failed'}),{status:200})});
  const r=await h.w.__oneFileBridgeFetch(odds);
  assert.equal(r.via,'住宅IP Bridge');
  assert.equal(h.requests[0].url,odds);assert.equal(h.proxies.length,1);
});

test('mobile fallback is actually requested without returning to the PC URL',async t=>{
  const h=harness(t);
  const r=await h.w.__oneFileBridgeFetch(sp);
  assert.equal(r.finalUrl,sp);assert.equal(h.requests[0].url,sp);
  assert.equal(h.requests.length,1);
});

test('parallel callers share one request, but later calls get fresh odds',async t=>{
  const h=harness(t);
  await Promise.all([h.w.__oneFileBridgeFetch(odds),h.w.__oneFileBridgeFetch(odds)]);
  assert.equal(h.proxies.length,1);
  await h.w.__oneFileBridgeFetch(odds);
  assert.equal(h.proxies.length,2);
});

test('HTTP-200 error pages are rejected without blocking ordinary text about errors',async t=>{
  const h=harness(t,{
    proxy:()=>new Response('<html><title>Access Denied</title>blocked</html>'),
    request:(d,emit)=>emit({__narBridge:'response',id:d.id,status:200,text:'<html><title>オッズ</title>エラーについてのヘルプ</html>'})
  });
  const r=await h.w.__oneFileBridgeFetch(odds);
  assert.equal(r.via,'住宅IP Bridge');assert.match(r.text,/ヘルプ/);
});

test('saved Worker setting is used without overwriting it',async t=>{
  const saved=JSON.stringify({netkeibaProxyUrl:'https://custom.example'});
  const h=harness(t,{storage:{'keibaSimClose3.settings':saved,'keibaNetkeibaProxyUrl':'https://old.example'}});
  await h.w.__oneFileBridgeFetch(odds);
  assert.equal(new URL(h.proxies[0]).origin,'https://custom.example');
  assert.equal(h.storage.get('keibaSimClose3.settings'),saved);
  assert.doesNotMatch(html,/localStorage\.setItem\("keibaNetkeibaProxyUrl",ONEFILE_WORKER\)/);
});

test('untrusted window messages and unapproved target domains are rejected',async t=>{
  const h=harness(t,{ready:false});
  h.emit({__narBridge:'ready'},{});
  h.emit({__narBridge:'ready'},h.w,'https://other.example');
  assert.equal(h.w.__houseraceBridgeStatus.connected,false);
  await assert.rejects(h.w.__oneFileBridgeFetch('https://netkeiba.com.example.org/'),/許可範囲外/);
  assert.equal(h.requests.length+h.proxies.length,0);
});

test('a missing response times out and recovers through Worker',async t=>{
  const h=harness(t,{request:()=>{}});
  const r=await h.w.__oneFileBridgeFetch(pc);
  assert.equal(r.status,200);assert.equal(r.via,'Cloudflare');
  assert.equal(h.requests.length,1);assert.equal(h.proxies.length,1);
});
