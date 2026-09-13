/* =========================================================
   FIXED49 — JRA OFFICIAL HISTORY FALLBACK (NO-HINDSIGHT SAFE)
   2026-09-14
   - Bypass failing netkeiba historical result fetches for recent JRA dates.
   - Discover meetings from JRA official calendar through the existing Worker proxy.
   - Read FINAL win odds only from JRA official 出馬表.
   - Read finish/payout only from JRA official レース結果.
   - Never derive selection odds from payouts/results.
   - FINAL_ODDS_VIRTUAL remains protected by FIXED46 result-blind shield.
   ========================================================= */
(()=>{
  'use strict';
  if(window.__FIXED49_JRA_OFFICIAL_HISTORY__) return;
  window.__FIXED49_JRA_OFFICIAL_HISTORY__=true;

  const TRACKS49={
    '01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京',
    '06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉'
  };
  const CODES49=Object.fromEntries(Object.entries(TRACKS49).map(([k,v])=>[v,k]));
  const STATIC49={
    '2026-09-06':[
      {venueCode:'01',track:'札幌',kai:2,day:6,count:12},
      {venueCode:'06',track:'中山',kai:4,day:2,count:12},
      {venueCode:'09',track:'阪神',kai:4,day:2,count:12}
    ],
    '2026-09-12':[
      {venueCode:'06',track:'中山',kai:4,day:3,count:12},
      {venueCode:'09',track:'阪神',kai:4,day:3,count:12}
    ],
    '2026-09-13':[
      {venueCode:'06',track:'中山',kai:4,day:4,count:12},
      {venueCode:'09',track:'阪神',kai:4,day:4,count:12}
    ]
  };

  const flat49=s=>String(s??'').replace(/\u00a0/g,' ').replace(/[\s　]+/g,' ').trim();
  const clean49=s=>flat49(s).replace(/^[-|｜]+|[-|｜]+$/g,'').trim();
  const sleep49=ms=>new Promise(r=>setTimeout(r,ms));
  const base49=()=>String(window.engine?.settings?.apiBase||'https://houserace.nitta-katsuhiko.workers.dev').replace(/\/$/,'');
  const log49=(msg,type='ok')=>{try{window.UI?.addLog?.(msg,type)}catch(_){}};

  async function fetchText49(url,timeoutMs=22000){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
    try{
      const r=await fetch(url,{cache:'no-store',mode:'cors',signal:ctrl.signal});
      const text=await r.text();
      if(!r.ok){
        let msg=`HTTP ${r.status}`;
        try{const j=JSON.parse(text);msg=j?.message||j?.error||msg}catch(_){ }
        throw new Error(msg);
      }
      if(/^\s*\{/.test(text)){
        try{
          const j=JSON.parse(text);
          if(j?.needBridge) throw new Error('Worker直取得がBridge要求になりました');
          if(j?.ok===false) throw new Error(j?.message||j?.error||'Worker応答エラー');
        }catch(e){
          if(e instanceof SyntaxError){} else throw e;
        }
      }
      return text;
    }catch(e){
      if(e?.name==='AbortError') throw new Error(`タイムアウト ${timeoutMs}ms`);
      throw e;
    }finally{clearTimeout(timer)}
  }

  function calendarUrl49(date){
    const d=String(date).replace(/\D/g,'').slice(0,8);
    const y=d.slice(0,4),m=String(Number(d.slice(4,6))),md=d.slice(4,8);
    return `https://www.jra.go.jp/keiba/calendar${y}/${y}/${m}/${md}.html`;
  }

  async function proxyHtml49(target){
    const u=`${base49()}/?url=${encodeURIComponent(target)}&bridge=off&timeout=18000&_=${Date.now()}`;
    return await fetchText49(u,22000);
  }

  function parseCalendar49(html){
    const doc=new DOMParser().parseFromString(String(html||''),'text/html');
    const text=flat49(doc.body?.innerText||doc.body?.textContent||'');
    const re=/(\d{1,2})回\s*(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\s*(\d{1,2})日/g;
    const heads=[];let m;
    while((m=re.exec(text))){
      heads.push({index:m.index,kai:Number(m[1]),track:m[2],venueCode:CODES49[m[2]],day:Number(m[3])});
    }
    const out=[];
    for(let i=0;i<heads.length;i++){
      const h=heads[i];
      if(!h.venueCode||!(h.kai>=1&&h.kai<=12)||!(h.day>=1&&h.day<=12))continue;
      const end=i+1<heads.length?heads[i+1].index:text.length;
      const block=text.slice(h.index,end);
      let count=0,rm;
      const rr=/(\d{1,2})\s*レース/g;
      while((rm=rr.exec(block))){const n=Number(rm[1]);if(n>=1&&n<=12)count=Math.max(count,n)}
      out.push({...h,count:count||12});
    }
    const seen=new Set();
    return out.filter(x=>{const k=`${x.venueCode}-${x.kai}-${x.day}`;if(seen.has(k))return false;seen.add(k);return true});
  }

  async function meetings49(date){
    try{
      const html=await proxyHtml49(calendarUrl49(date));
      const ms=parseCalendar49(html);
      if(ms.length)return {meetings:ms,source:'JRA公式開催カレンダー'};
    }catch(e){log49(`JRA ${date}: 公式カレンダー取得補助 ${e?.message||e}`,'warn')}
    if(STATIC49[date])return {meetings:STATIC49[date].map(x=>({...x})),source:'検証済み開催フォールバック'};
    throw new Error('JRA公式カレンダーから開催を特定できません');
  }

  function raceId49(date,m,no){
    const y=String(date).slice(0,4);
    return y+String(m.venueCode).padStart(2,'0')+String(Number(m.kai)).padStart(2,'0')+String(Number(m.day)).padStart(2,'0')+String(no).padStart(2,'0');
  }

  async function officialRaw49(id,date,type){
    const d=String(date).replace(/\D/g,'').slice(0,8);
    const u=`${base49()}/?source=jra&jra=official&type=${encodeURIComponent(type)}&race_id=${encodeURIComponent(id)}&date=${encodeURIComponent(d)}&timeout=20000&_=${Date.now()}`;
    return await fetchText49(u,24000);
  }

  function exactHorseNo49(row){
    for(const sel of ['td.num','th.num','[class~="num"]','[class*="Umaban"]','[class*="umaban"]','[class*="HorseNum"]','[class*="horse_num"]']){
      const el=row.querySelector(sel);if(!el)continue;
      const s=clean49(el.textContent);if(/^(?:[1-9]|1[0-8])$/.test(s))return Number(s);
    }
    const cells=[...row.querySelectorAll('th,td')].slice(0,4).map(x=>clean49(x.textContent));
    const nums=cells.filter(x=>/^(?:[1-9]|1[0-8])$/.test(x)).map(Number);
    return nums.length?nums[nums.length-1]:0;
  }

  function parseShutuba49(html,id,date){
    const doc=new DOMParser().parseFromString(String(html||''),'text/html');
    const body=flat49(doc.body?.innerText||doc.body?.textContent||'');
    if(/掲載は終了|出馬表の掲載は終了/.test(body))throw new Error('JRA公式出馬表の掲載終了（確定オッズ取得不可）');
    if(!/単勝オッズ|出馬表/.test(body))throw new Error('JRA公式出馬表本文を確認できません');
    const horses=[],seen=new Set();
    for(const row of doc.querySelectorAll('tr')){
      const txt=flat49(row.innerText||row.textContent||'');
      const om=txt.match(/(\d{1,4}(?:\.\d+)?)\s*\(\s*(\d{1,2})\s*番人気\s*\)/);
      if(!om)continue;
      const a=row.querySelector('a[href*="/JRADB/accessU.html"],a[href*="accessU.html"]');
      const name=clean49(a?.textContent||'');
      const no=exactHorseNo49(row);
      const odds=Number(om[1]),pop=Number(om[2]);
      if(!(no>=1&&no<=18)||!(odds>=1&&odds<10000)||seen.has(no))continue;
      seen.add(no);horses.push({no,name:name||`馬${no}`,odds:Math.round(odds*10)/10,pop:(pop>=1&&pop<=18)?pop:0});
    }
    horses.sort((a,b)=>a.no-b.no);
    if(horses.length<5)throw new Error(`JRA公式出馬表オッズ解析不足 horses=${horses.length}`);
    horses.slice().sort((a,b)=>a.odds-b.odds||a.no-b.no).forEach((h,i)=>{if(!h.pop)h.pop=i+1});
    const tm=body.match(/発走時刻[：:]?\s*(\d{1,2})時\s*(\d{2})分/);
    const h2=[...doc.querySelectorAll('h2,h3')].map(x=>clean49(x.textContent)).find(x=>x&&!/関連メニュー|検索/.test(x));
    return {
      horses,
      start:tm?[Number(tm[1]),Number(tm[2])]:null,
      title:h2||`${TRACKS49[id.slice(4,6)]||'JRA'} ${Number(id.slice(10,12))}R`,
      body
    };
  }

  function emptyPayout49(){return {win:{},place:{},frame:{},quinella:{},wide:{},exacta:{},trio:{},trifecta:{}}}
  const pair49=(a,b)=>[Number(a),Number(b)].sort((x,y)=>x-y).join('-');
  const trio49=(a,b,c)=>[Number(a),Number(b),Number(c)].sort((x,y)=>x-y).join('-');
  function rawYen49(s){return Number(String(s||'').replace(/[\s,]/g,''))||0}
  function parsePayoutText49(text){
    const clean=flat49(String(text||'').replace(/,/g,' '));
    const p=emptyPayout49();let m;
    const win=/単勝\s+(\d{1,2})\s+([\d ]+)円/.exec(clean);if(win)p.win[win[1]]=rawYen49(win[2]);
    const placePos=clean.indexOf('複勝');if(placePos>=0){const sec=clean.slice(placePos,placePos+700),re=/(\d{1,2})\s+([\d ]+)円/g;while((m=re.exec(sec)))p.place[m[1]]=rawYen49(m[2])}
    const frame=/(?:枠連(?:複)?)([\s\S]{0,550})/.exec(clean);if(frame){const re=/([1-8])[-－](\d)\s+([\d ]+)円/g;while((m=re.exec(frame[1])))p.frame[pair49(m[1],m[2])]=rawYen49(m[3])}
    const quin=/(?:馬連(?:複)?)([\s\S]{0,600})/.exec(clean);if(quin){const re=/(\d{1,2})[-－](\d{1,2})\s+([\d ]+)円/g;while((m=re.exec(quin[1])))p.quinella[pair49(m[1],m[2])]=rawYen49(m[3])}
    const wp=clean.indexOf('ワイド');if(wp>=0){const sec=clean.slice(wp,wp+900),re=/(\d{1,2})[-－](\d{1,2})\s+([\d ]+)円/g;while((m=re.exec(sec)))p.wide[pair49(m[1],m[2])]=rawYen49(m[3])}
    const ex=/馬単([\s\S]{0,600})/.exec(clean);if(ex){const re=/(\d{1,2})[-－](\d{1,2})\s+([\d ]+)円/g;while((m=re.exec(ex[1])))p.exacta[`${Number(m[1])}-${Number(m[2])}`]=rawYen49(m[3])}
    const tr=/(?:三連複|3連複)([\s\S]{0,700})/.exec(clean);if(tr){const re=/(\d{1,2})[-－](\d{1,2})[-－](\d{1,2})\s+([\d ]+)円/g;while((m=re.exec(tr[1])))p.trio[trio49(m[1],m[2],m[3])]=rawYen49(m[4])}
    const tf=/(?:三連単|3連単)([\s\S]{0,700})/.exec(clean);if(tf){const re=/(\d{1,2})[-－](\d{1,2})[-－](\d{1,2})\s+([\d ]+)円/g;while((m=re.exec(tf[1])))p.trifecta[`${Number(m[1])}-${Number(m[2])}-${Number(m[3])}`]=rawYen49(m[4])}
    return p;
  }

  function parseResult49(html){
    const doc=new DOMParser().parseFromString(String(html||''),'text/html');
    const body=flat49(doc.body?.innerText||doc.body?.textContent||'');
    if(!/着順|レース結果/.test(body))throw new Error('JRA公式結果本文を確認できません');
    const finish=[],seen=new Set();
    for(const row of doc.querySelectorAll('tr')){
      let rank=0,no=0;
      const pe=row.querySelector('td.place,th.place,[class~="place"]');
      const ne=row.querySelector('td.num,th.num,[class~="num"]');
      if(pe)rank=Number((clean49(pe.textContent).match(/\d{1,2}/)||[])[0]||0);
      if(ne)no=Number((clean49(ne.textContent).match(/(?:[1-9]|1[0-8])/ )||[])[0]||0);
      if(!(rank>=1&&rank<=50)){
        const cells=[...row.querySelectorAll('th,td')].map(x=>clean49(x.textContent));
        rank=Number((cells[0]?.match(/^\d{1,2}$/)||[])[0]||0);
        if(!(no>=1&&no<=18)&&/^(?:[1-9]|1[0-8])$/.test(cells[2]||''))no=Number(cells[2]);
      }
      if(!(rank>=1&&rank<=50&&no>=1&&no<=18)||seen.has(rank))continue;
      const a=row.querySelector('a[href*="/JRADB/accessU.html"],a[href*="accessU.html"]');
      const name=clean49(a?.textContent||'');
      seen.add(rank);finish.push({rank,no,name});
    }
    finish.sort((a,b)=>a.rank-b.rank);
    const top3=finish.slice(0,3).map(x=>x.no);
    if(top3.length<3)throw new Error(`JRA公式結果解析不足 finish=${finish.length}`);
    return {finish,top3,payouts:parsePayoutText49(body)};
  }

  async function loadRace49(date,meeting,no){
    const id=raceId49(date,meeting,no);
    const [shutubaHtml,resultHtml]=await Promise.all([
      officialRaw49(id,date,'shutuba'),officialRaw49(id,date,'result')
    ]);
    const s=parseShutuba49(shutubaHtml,id,date);
    const r=parseResult49(resultHtml);
    const startTime=s.start?`${date}T${String(s.start[0]).padStart(2,'0')}:${String(s.start[1]).padStart(2,'0')}:00+09:00`:null;
    return {
      id,date,org:'JRA',track:meeting.track||TRACKS49[id.slice(4,6)]||'JRA',no:Number(no),
      title:s.title,startTime,oddsTiming:'FINAL',horses:s.horses,
      result:{
        winner:r.top3[0],top3:r.top3,finish:r.finish,payouts:r.payouts,
        payoutMeta:{source:'jra.go.jp official',officialSource:'jra.go.jp',trusted:true,strict:true,unit:'yen_per_100'}
      },
      source:'jra.go.jp official 出馬表 FINAL単勝オッズ + 公式結果',
      oddsSource:'jra.go.jp official 出馬表',
      resultSource:'jra.go.jp official レース結果',
      historySafe:true,
      resultBlindSafe:true
    };
  }

  async function historyOfficial49(date){
    const disc=await meetings49(date),jobs=[];
    for(const m of disc.meetings){
      const count=Math.min(12,Math.max(1,Number(m.count||12)));
      for(let no=1;no<=count;no++)jobs.push({m,no});
    }
    if(!jobs.length)throw new Error('JRA開催レース0件');
    const races=[],errors=[];const concurrency=3;
    for(let i=0;i<jobs.length;i+=concurrency){
      const batch=jobs.slice(i,i+concurrency);
      const got=await Promise.all(batch.map(async j=>{
        const id=raceId49(date,j.m,j.no);
        try{return await loadRace49(date,j.m,j.no)}
        catch(e){errors.push({raceId:id,track:j.m.track,no:j.no,error:String(e?.message||e)});return null}
      }));
      got.forEach(x=>{if(x)races.push(x)});
      const pr=document.getElementById('btProgress');
      if(pr)pr.textContent=`JRA公式履歴取得中… ${Math.min(i+batch.length,jobs.length)}/${jobs.length} / 成功${races.length}`;
      await sleep49(40);
    }
    races.sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||'')||a.track.localeCompare(b.track)||a.no-b.no);
    const requested=jobs.length,minimum=Math.max(1,Math.ceil(requested*.75));
    if(races.length<minimum){
      throw new Error(`JRA公式履歴が不足 ${races.length}/${requested}（最低${minimum}） / ${errors.slice(0,3).map(e=>e.raceId+':'+e.error).join(' / ')}`);
    }
    return {
      ok:true,date,org:'JRA',oddsTiming:'FINAL',races,count:races.length,
      warning:'FINAL odds from JRA official shutuba. Results/payouts are settlement-only; never used to synthesize selection odds.',
      diagnostics:{meetingSource:`${disc.source}+official-shutuba-final-v49`,meetings:disc.meetings,requestedRaces:requested,loadedRaces:races.length,failedRaces:errors.length,errors:errors.slice(0,20)},
      diagnosticSummary:{meetingSource:'jra-official-shutuba-final-v49',requestedRaces:requested,loadedRaces:races.length,failedRaces:errors.length,firstErrors:errors.slice(0,5)},
      source:'JRA公式 出馬表FINAL単勝オッズ + 公式結果 / FIXED49'
    };
  }

  const previousFetchHistoryDay49=window.fetchHistoryDay||fetchHistoryDay;
  const wrapped49=async function(date,org,options={}){
    const kind=String(org||'').toUpperCase();
    if(kind!=='JRA')return await previousFetchHistoryDay49(date,org,options);

    log49(`JRA ${date}: FIXED49 公式出馬表FINALオッズ経路を使用`,'ok');
    try{
      const d=await historyOfficial49(date);
      log49(`JRA ${date}: JRA公式 ${d.races.length}/${d.diagnostics.requestedRaces}レース取得`,'ok');
      return d;
    }catch(e){
      log49(`JRA ${date}: 公式履歴Fallback失敗 ${e?.message||e} → 従来経路を試行`,'warn');
      const d=await previousFetchHistoryDay49(date,org,options);
      if(Array.isArray(d?.races)&&d.races.length)return d;
      throw new Error(`JRA履歴取得失敗: ${e?.message||e}${d?.diagnostics?.errors?.length?` / 従来経路: ${d.diagnostics.errors.slice(0,2).map(x=>x.error||x).join(' | ')}`:''}`);
    }
  };
  window.fetchHistoryDay=wrapped49;
  try{fetchHistoryDay=wrapped49}catch(_){ }

  function badge49(){
    const host=document.getElementById('btFetchDiag')||document.getElementById('btProgress');
    if(host&&!document.getElementById('fixed49JraBadge')){
      const e=document.createElement('div');e.id='fixed49JraBadge';e.className='muted';e.style.marginTop='4px';
      e.innerHTML='<b>FIXED49:</b> JRA過去レースは公式出馬表のFINAL単勝オッズを選択入力に使用。着順・払戻からオッズを逆算しません。公式結果は精算専用。';
      host.insertAdjacentElement('afterend',e);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(badge49,2200),{once:true});else setTimeout(badge49,2200);
  console.log('✅ FIXED49 JRA official history fallback loaded');
})();
