/* =========================================================
   FIXED50 — UNIFIED WEB HISTORY: JRA + NAR
   2026-09-14
   - JRA: keep FIXED49 official-history path.
   - NAR: fetch historical races/results directly from Worker /history,
          whose source is keiba.go.jp RaceMarkTable + RefundMoneyList.
   - No Bridge is required for historical NAR WEB acquisition.
   - If JRA+NAR is selected on a day with confirmed no JRA meeting
     (meeting=none, requested=0), continue the period battle with NAR
     instead of treating JRA 0 as an acquisition failure.
   - Never synthesize selection odds from refunds/results.
   ========================================================= */
(()=>{
  'use strict';
  if(window.__FIXED50_WEB_BOTH__) return;
  window.__FIXED50_WEB_BOTH__=true;

  const sleep50=ms=>new Promise(r=>setTimeout(r,ms));
  const base50=()=>String(window.engine?.settings?.apiBase||'https://houserace.nitta-katsuhiko.workers.dev').replace(/\/$/,'');
  const SOURCE50='keiba.go.jp-worker-history-v50';

  function log50(msg,type='ok'){
    try{window.UI?.addLog?.(msg,type)}catch(_){ }
  }

  function tagRefund50(v){
    if(v==null||v==='')return v;
    if(typeof v==='object'&&!Array.isArray(v)){
      const n=Number(v.refundYen??v.payoutYen??v.refund??v.payout??v.amount??v.value);
      if(!Number.isFinite(n)||n<=0)return v;
      return {...v,refundYen:n,unit:'yen_per_100',source:v.source||SOURCE50,
        officialSource:v.officialSource||'keiba.go.jp',trusted:true,strict:true,
        parser:v.parser||'worker-history-v50'};
    }
    const n=Number(v);
    if(!Number.isFinite(n)||n<=0)return v;
    return {refundYen:n,unit:'yen_per_100',source:SOURCE50,officialSource:'keiba.go.jp',
      trusted:true,strict:true,parser:'worker-history-v50'};
  }

  function normalizePayouts50(p){
    const src=p&&typeof p==='object'?p:{};
    const out={};
    for(const bucket of ['win','place','frame','quinella','wide','exacta','trio','trifecta']){
      const m=src[bucket]&&typeof src[bucket]==='object'?src[bucket]:{};
      out[bucket]={};
      for(const [k,v] of Object.entries(m))out[bucket][k]=tagRefund50(v);
    }
    return out;
  }

  function normalizeNarBlock50(d,date){
    if(!d||typeof d!=='object')d={};
    if(!Array.isArray(d.races))d.races=[];
    let payoutLoaded=0;
    for(const race of d.races){
      race.org='NAR';race.date=race.date||date;
      race.source=race.source||'keiba.go.jp RaceMarkTable + RefundMoneyList';
      race.result=race.result||{};
      race.result.payouts=normalizePayouts50(race.result.payouts||{});
      const p=race.result.payouts;
      const has=Object.keys(p.win||{}).length>0&&Object.keys(p.place||{}).length>0;
      if(has)payoutLoaded++;
      race.result.payoutMeta={trusted:has,strict:true,unit:'yen_per_100',source:SOURCE50,
        officialSource:'keiba.go.jp',parser:'worker-history-v50'};
    }
    d.date=d.date||date;d.org='NAR';d.oddsTiming=d.oddsTiming||'FINAL';d.count=d.races.length;
    d.source='地方競馬公式 keiba.go.jp WEB / Worker history / FIXED50';
    d.warning='Historical NAR data fetched from keiba.go.jp. Refunds/results are settlement-only and are not used to synthesize selection odds.';
    d.narPayoutContract={version:21,strict:true,partial:true,loaded:payoutLoaded,
      failed:Math.max(0,d.races.length-payoutLoaded),unit:'yen_per_100',source:SOURCE50,
      officialSource:'keiba.go.jp',parser:'worker-history-v50'};
    d.diagnostics=d.diagnostics||{};
    d.diagnostics.narWeb50={source:'keiba.go.jp',races:d.races.length,payoutLoaded};
    d._fetchMeta={...(d._fetchMeta||{}),fetchedAt:new Date().toISOString(),mode:'NAR_WEB_OFFICIAL_V50'};
    return d;
  }

  async function fetchNarWeb50(date,options={}){
    const retries=Math.max(1,Number(options.retries||3));
    const timeoutMs=Math.max(6000,Number(options.timeoutMs||22000));
    let last=null;
    for(let attempt=1;attempt<=retries;attempt++){
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
      try{
        const u=`${base50()}/history?date=${encodeURIComponent(date)}&org=NAR&_=${Date.now()}_${attempt}_fixed50`;
        const r=await fetch(u,{cache:'no-store',signal:ctrl.signal,mode:'cors'});
        const text=await r.text();let d={};
        try{d=text?JSON.parse(text):{}}catch(_){throw new Error(`NAR WEB JSON解析失敗 HTTP ${r.status}: ${text.slice(0,100)}`)}
        if(!r.ok||d.error||d.ok===false)throw new Error(d.message||d.error||`HTTP ${r.status}`);
        d=normalizeNarBlock50(d,date);
        log50(`NAR ${date}: keiba.go.jp WEB ${d.races.length}レース取得`,'ok');
        return d;
      }catch(e){
        last=e?.name==='AbortError'?new Error(`NAR WEB タイムアウト ${timeoutMs}ms`):e;
        if(attempt<retries)await sleep50(350*attempt);
      }finally{clearTimeout(timer)}
    }
    throw last||new Error('NAR WEB取得失敗');
  }

  const previousFetch50=window.fetchHistoryDay || (typeof fetchHistoryDay==='function'?fetchHistoryDay:null);
  const fetch50=async function(date,org,options={}){
    const kind=String(org||'').toUpperCase();
    if(kind==='NAR')return await fetchNarWeb50(date,options);
    if(!previousFetch50)throw new Error('JRA履歴取得関数がありません');
    return await previousFetch50(date,org,options);
  };
  window.fetchHistoryDay=fetch50;
  try{fetchHistoryDay=fetch50}catch(_){ }

  const previousGet50=window.getHistoryBlock || (typeof getHistoryBlock==='function'?getHistoryBlock:null);
  const get50=async function(date,org,options={}){
    const kind=String(org||'').toUpperCase();
    if(kind!=='NAR'){
      if(!previousGet50) return await fetch50(date,org,options);
      return await previousGet50(date,org,options);
    }
    const cached=(Array.isArray(window.webHistory)?window.webHistory:(typeof webHistory!=='undefined'&&Array.isArray(webHistory)?webHistory:[]))
      .find(x=>x.date===date&&String(x.org||'').toUpperCase()==='NAR');
    if(!options.force&&cached&&Array.isArray(cached.races)&&cached.races.length&&cached._fetchMeta?.mode==='NAR_WEB_OFFICIAL_V50')return cached;
    const d=await fetchNarWeb50(date,{...options,retries:options.retries||3,timeoutMs:options.timeoutMs||22000});
    try{
      if(typeof webHistory!=='undefined'){
        webHistory=webHistory.filter(x=>!(x.date===date&&String(x.org||'').toUpperCase()==='NAR'));
        webHistory.push(d);saveWebHistoryCache?.();
      }
    }catch(_){ }
    return d;
  };
  window.getHistoryBlock=get50;
  try{getHistoryBlock=get50}catch(_){ }

  function confirmedNoJraMeeting50(){
    const diag=document.getElementById('btFetchDiag');
    const t=String(diag?.textContent||'');
    return /JRA\s*0レース/.test(t)&&/meeting\s*=\s*none/i.test(t)&&/requested\s*=\s*0/i.test(t)&&!/JRA取得エラー:[^]*エラー\d*[1-9]/.test(t);
  }

  function wrapRun50(){
    const btn=document.getElementById('runWebBacktest');
    if(!btn||btn.dataset.fixed50Wrapped)return;
    const old=btn.onclick;if(typeof old!=='function')return;
    btn.dataset.fixed50Wrapped='1';
    btn.onclick=async function(ev){
      const sel=document.getElementById('btOrg');
      const requested=sel?.value||'';
      await old.call(this,ev);
      const progress=document.getElementById('btProgress');
      const stopped=/停止:\s*JRA\s*0レース/.test(String(progress?.textContent||''));
      if(!stopped||!confirmedNoJraMeeting50())return;

      if(requested==='BOTH'){
        log50('JRA開催なしを確認（meeting=none / requested=0）。NAR WEBデータだけで期間仮想対戦を継続します。','ok');
        const keep=sel.value;sel.value='NAR';
        try{
          await old.call(this,ev);
          if(progress)progress.textContent=String(progress.textContent||'')+' / JRA開催なし→NARのみ';
          const diag=document.getElementById('btFetchDiag');
          if(diag)diag.insertAdjacentHTML('beforeend','<div style="margin-top:6px;color:#9ee37d"><b>FIXED50:</b> この期間はJRA開催なしを確認したため、NAR公式WEB取得分で対戦を継続しました。</div>');
        }finally{sel.value=keep;}
      }else if(requested==='JRA'){
        if(progress)progress.textContent='完了: 指定期間にJRA開催はありません（取得失敗ではありません）。';
        log50('指定期間はJRA開催なし（meeting=none / requested=0）','ok');
      }
    };
  }

  function badge50(){
    const host=document.getElementById('btFetchDiag')||document.getElementById('btProgress');
    if(host&&!document.getElementById('fixed50WebBothBadge')){
      const e=document.createElement('div');e.id='fixed50WebBothBadge';e.className='muted';e.style.marginTop='4px';
      e.innerHTML='<b>FIXED50 WEB取得:</b> JRA=公式履歴経路 / NAR=地方競馬公式 keiba.go.jp（Worker /history）。JRA開催なし日はNARのみで継続。';
      host.insertAdjacentElement('afterend',e);
    }
  }

  const init50=()=>{wrapRun50();badge50()};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init50,3200),{once:true});
  else setTimeout(init50,3200);
  console.log('✅ FIXED50 unified JRA+NAR web history loaded');
})();
