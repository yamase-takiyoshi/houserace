/* =========================================================
   FIXED51 — PERIOD CHARACTER BATTLE = WEB AUTO ACQUIRE (JRA + NAR)
   2026-09-14
   - Pressing the period virtual-battle button itself fetches every selected
     date from the WEB. No prior manual history-download step is required.
   - JRA: FIXED49 official-history route.
   - NAR: FIXED50 keiba.go.jp /history route.
   - Force-refresh is applied to BOTH JRA and NAR while the period battle runs,
     so stale/empty local cache cannot suppress a fresh web acquisition.
   - Confirmed no-meeting days remain valid empty days; they are not fabricated.
   - Selection uses market odds only; result/refund remains settlement-only.
   ========================================================= */
(()=>{
  'use strict';
  if(window.__FIXED51_PERIOD_WEB_AUTO__)return;
  window.__FIXED51_PERIOD_WEB_AUTO__=true;

  let battleWebActive51=false;
  const log51=(msg,type='ok')=>{try{window.UI?.addLog?.(msg,type)}catch(_){}};

  function patchHistory51(){
    const prev=window.getHistoryBlock || (typeof getHistoryBlock==='function'?getHistoryBlock:null);
    if(!prev || prev.__fixed51WebForce)return;
    const wrapped=async function(date,org,options={}){
      const o=battleWebActive51?{...options,force:true,retries:Math.max(3,Number(options.retries||0)),timeoutMs:Math.max(22000,Number(options.timeoutMs||0))}:options;
      return await prev(date,org,o);
    };
    wrapped.__fixed51WebForce=true;
    wrapped.__fixed51Previous=prev;
    window.getHistoryBlock=wrapped;
    try{getHistoryBlock=wrapped}catch(_){ }
  }

  function badge51(){
    const host=document.getElementById('btFetchDiag')||document.getElementById('btProgress');
    if(host&&!document.getElementById('fixed51PeriodWebBadge')){
      const e=document.createElement('div');
      e.id='fixed51PeriodWebBadge';e.className='muted';e.style.marginTop='6px';
      e.innerHTML='<b>FIXED51 期間仮想対戦＝WEB自動取得:</b> STARTを押すだけで選択期間のJRA＋NARをWEBから再取得します。事前の「WEBから取得」は不要です。JRA=公式履歴 / NAR=keiba.go.jp。';
      host.insertAdjacentElement('afterend',e);
    }
  }

  function installButton51(){
    patchHistory51();badge51();
    const btn=document.getElementById('runWebBacktest');
    if(!btn)return false;
    if(btn.dataset.fixed51Installed==='1')return true;
    const old=btn.onclick;
    if(typeof old!=='function')return false;
    btn.dataset.fixed51Installed='1';
    btn.textContent='🌐 WEB自動取得＋期間仮想対戦 START';
    btn.onclick=async function(ev){
      if(battleWebActive51)return;
      battleWebActive51=true;
      this.textContent='🌐 JRA＋NAR WEB取得中…';
      const p=document.getElementById('btProgress');
      try{
        if(p)p.textContent='期間仮想対戦: 選択期間のJRA＋NARをWEBから自動取得します…';
        log51('期間仮想対戦: WEB自動取得開始（JRA公式履歴 + NAR keiba.go.jp）','ok');
        await old.call(this,ev);
      }catch(e){
        if(p)p.textContent='停止: '+String(e?.message||e);
        log51('期間仮想対戦 WEB取得エラー: '+String(e?.message||e),'error');
        throw e;
      }finally{
        battleWebActive51=false;
        this.textContent='🌐 WEB自動取得＋期間仮想対戦 START';
      }
    };
    return true;
  }

  const boot=()=>{installButton51();setTimeout(installButton51,1800);setTimeout(installButton51,3600)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,3900),{once:true});
  else setTimeout(boot,3900);
  console.log('✅ FIXED51 period battle web auto-acquire JRA+NAR loaded');
})();
