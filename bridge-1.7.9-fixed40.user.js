// ==UserScript==
// @name         LIVE KEIBA SIM Bridge 1.7.9 FIXED40
// @namespace    https://yamase-takiyoshi.github.io/houserace/
// @version      1.7.9
// @description  FIXED40: NAR live odds prefer official sp.keiba.go.jp; netkeiba is fallback. JRA/NAR bridge protocol compatible with houserace.
// @match        https://yamase-takiyoshi.github.io/houserace/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      netkeiba.com
// @connect      *.netkeiba.com
// @connect      jra.go.jp
// @connect      *.jra.go.jp
// @connect      keiba.go.jp
// @connect      *.keiba.go.jp
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '1.7.9';
  const SITE_ORIGIN = location.origin;
  const REQUEST_TIMEOUT = 18000;
  const ALLOWED_ROOTS = ['netkeiba.com', 'jra.go.jp', 'keiba.go.jp'];

  function isAllowedHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return ALLOWED_ROOTS.some(root => h === root || h.endsWith('.' + root));
  }

  function validateTarget(value) {
    const u = new URL(String(value));
    if (u.protocol !== 'https:' || u.username || u.password || !isAllowedHost(u.hostname)) {
      throw new Error('取得対象URLが競馬データの許可範囲外です');
    }
    return u;
  }

  function isNarNetkeibaOdds(u) {
    const h = u.hostname.toLowerCase();
    if (!(h === 'nar.netkeiba.com' || h === 'nar.sp.netkeiba.com')) return false;
    if (/api_get_nar_odds\.html$/i.test(u.pathname)) return false;
    return /^\/odds(?:\/|$)/i.test(u.pathname);
  }

  function isNarOfficial(u) {
    const h = u.hostname.toLowerCase();
    if (!(h === 'keiba.go.jp' || h.endsWith('.keiba.go.jp'))) return false;
    return /^\/(?:KeibaWeb|KeibaWebSP)\/TodayRaceInfo\//i.test(u.pathname);
  }

  function canonicalNarNetkeiba(value) {
    const u = validateTarget(value);
    if (!isNarNetkeibaOdds(u)) return u.href;
    u.hostname = 'nar.netkeiba.com';
    u.pathname = '/odds/index.html';
    u.hash = '';
    return u.href;
  }

  function candidates(value) {
    const original = validateTarget(value).href;
    const u = new URL(original);
    if (isNarOfficial(u)) return [original];
    if (!isNarNetkeibaOdds(u)) return [original];
    const canonical = canonicalNarNetkeiba(original);
    const alt = new URL(canonical);
    alt.pathname = '/odds/';
    return [...new Set([canonical, alt.href, original])];
  }

  function blockedPage(text) {
    const s = String(text || '').slice(0, 120000);
    const heading = (s.match(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/i) || [,''])[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (/access denied|forbidden|just a moment|service unavailable|temporarily unavailable/i.test(heading)) return true;
    if (/アクセス.{0,10}(?:制限|拒否)|ただいまアクセスが集中|ご利用いただけません|エラーページ/i.test(heading)) return true;
    if (/cf-chl-|cloudflare.*challenge|captcha/i.test(s.slice(0, 20000))) return true;
    return false;
  }

  function gmGet(url, timeout = REQUEST_TIMEOUT) {
    const u = validateTarget(url);
    const official = isNarOfficial(u);
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = fn => value => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      try {
        const headers = {
          'Accept': 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
          'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        };
        if (official) headers['Referer'] = 'https://sp.keiba.go.jp/';
        GM_xmlhttpRequest({
          method: 'GET',
          url: u.href,
          timeout,
          responseType: 'text',
          anonymous: false,
          headers,
          onload: done(res => resolve({
            status: Number(res.status || 0),
            text: String(res.responseText ?? res.response ?? ''),
            finalUrl: String(res.finalUrl || u.href),
            statusText: String(res.statusText || '')
          })),
          onerror: done(err => reject(new Error('Bridge通信エラー: ' + String(err?.error || err?.statusText || 'network error')))),
          ontimeout: done(() => reject(new Error('Bridge応答タイムアウト')),
          onabort: done(() => reject(new Error('Bridge通信中断'))
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function fetchWithFallback(input) {
    const urls = candidates(input);
    const errors = [];
    let lastStatus = 0;

    for (const url of urls) {
      try {
        const u = new URL(url);
        const r = await gmGet(url);
        lastStatus = r.status;
        if (!(r.status >= 200 && r.status < 300)) {
          errors.push(`${u.hostname} HTTP ${r.status || 0}`);
          continue;
        }
        if (!r.text || r.text.trim().length < 10) {
          errors.push(`${u.hostname} HTTP ${r.status} 本文不足`);
          continue;
        }
        if (blockedPage(r.text)) {
          errors.push(`${u.hostname} HTTP ${r.status} 遮断ページ`);
          continue;
        }
        const via = isNarOfficial(u)
          ? '住宅IP Bridge 1.7.9 / NAR公式SP優先'
          : isNarNetkeibaOdds(u)
            ? '住宅IP Bridge 1.7.9 / netkeiba予備'
            : '住宅IP Bridge 1.7.9';
        return {
          status: r.status,
          text: r.text,
          finalUrl: r.finalUrl || url,
          charset: '',
          version: VERSION,
          via
        };
      } catch (e) {
        let host = '';
        try { host = new URL(url).hostname; } catch (_) { host = 'URL'; }
        errors.push(`${host}: ${String(e?.message || e)}`);
      }
    }

    return {
      status: lastStatus >= 400 ? lastStatus : 0,
      text: '',
      finalUrl: urls[0] || String(input),
      error: errors.join(' / ') || 'Bridge取得失敗',
      version: VERSION,
      via: '住宅IP Bridge 1.7.9'
    };
  }

  function reply(payload) {
    try { window.postMessage(payload, SITE_ORIGIN); }
    catch (_) { window.postMessage(payload, '*'); }
  }

  function ready(kind = 'ready') {
    reply({
      __narBridge: kind,
      ready: true,
      ok: true,
      version: VERSION,
      bridgeVersion: VERSION,
      source: 'Bridge-1.7.9-FIXED40',
      ts: Date.now()
    });
  }

  window.addEventListener('message', async ev => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || typeof d !== 'object') return;

    if (d.__narBridge === 'ping' || d.__narBridge === 'hello') {
      ready(d.__narBridge === 'ping' ? 'pong' : 'ready');
      return;
    }
    if (d.__narBridge !== 'request' || !d.id || !d.url) return;

    try {
      validateTarget(d.url);
      const r = await fetchWithFallback(d.url);
      reply({
        __narBridge: 'response',
        id: d.id,
        status: Number(r.status || 0),
        text: String(r.text || ''),
        finalUrl: String(r.finalUrl || d.url),
        charset: String(r.charset || ''),
        error: String(r.error || ''),
        via: String(r.via || '住宅IP Bridge 1.7.9'),
        version: VERSION,
        bridgeVersion: VERSION,
        source: 'Bridge-1.7.9-FIXED40',
        ts: Date.now()
      });
    } catch (e) {
      reply({
        __narBridge: 'response',
        id: d.id,
        status: 0,
        text: '',
        finalUrl: String(d.url || ''),
        error: String(e?.message || e),
        version: VERSION,
        bridgeVersion: VERSION,
        source: 'Bridge-1.7.9-FIXED40',
        ts: Date.now()
      });
    }
  }, false);

  // FIXED40 page patch: NAR official desktop/mobile pages always go through
  // the residential userscript bridge first. netkeiba remains a fallback.
  function injectPagePatch() {
    const code = `(() => {
      'use strict';
      if (window.__FIXED40_OFFICIAL_FIRST__) return;
      window.__FIXED40_OFFICIAL_FIRST__ = true;
      const VERSION = '1.7.9';
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      function isNarNetkeiba(u){
        const h=u.hostname.toLowerCase();
        return (h==='nar.netkeiba.com'||h==='nar.sp.netkeiba.com') && /^\\/odds(?:\\/|$)/i.test(u.pathname) && !/api_get_nar_odds\\.html$/i.test(u.pathname);
      }
      function isNarOfficial(u){
        const h=u.hostname.toLowerCase();
        return (h==='keiba.go.jp'||h.endsWith('.keiba.go.jp')) && /^\\/(?:KeibaWeb|KeibaWebSP)\\/TodayRaceInfo\\//i.test(u.pathname);
      }
      function canonicalNetkeiba(value){
        const u=new URL(String(value));
        if(isNarNetkeiba(u)){
          u.hostname='nar.netkeiba.com';
          u.pathname='/odds/index.html';
          u.hash='';
        }
        return u.href;
      }
      async function install(){
        for(let i=0;i<160;i++){
          if(typeof window.__oneFileBridgeFetch==='function' && typeof window.__residentialBridgeFetch38==='function') break;
          await sleep(50);
        }
        if(typeof window.__oneFileBridgeFetch!=='function' || typeof window.__residentialBridgeFetch38!=='function') return;
        if(window.__oneFileBridgeFetch.__fixed40) return;
        const original=window.__oneFileBridgeFetch.bind(window);
        const wrapped=async function(url){
          let u; try{u=new URL(String(url))}catch(_){return original(url)}
          if(!isNarOfficial(u) && !isNarNetkeiba(u)) return original(url);
          const target=isNarNetkeiba(u)?canonicalNetkeiba(url):u.href;
          try{return await window.__residentialBridgeFetch38(target)}
          catch(e){
            console.warn('[FIXED40] residential-first failed; fallback normal route',target,e);
            return original(target);
          }
        };
        wrapped.__fixed40=true;
        wrapped.__original=original;
        window.__oneFileBridgeFetch=wrapped;
        window.__narBridgeVersion=VERSION;
        const detail=document.getElementById('bridgeDetail38');
        if(detail)detail.textContent='FIXED40: NAR公式SP→住宅IP Bridge優先 / netkeibaは予備';
        try{window.postMessage({__narBridge:'status',ready:true,ok:true,version:VERSION,bridgeVersion:VERSION,source:'FIXED40-page-patch',ts:Date.now()},location.origin)}catch(_){ }
        console.log('✅ FIXED40 official-first page patch loaded / Bridge '+VERSION);
      }
      install();
    })();`;
    const s = document.createElement('script');
    s.textContent = code;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.remove();
  }

  try { injectPagePatch(); } catch (e) { console.warn('FIXED40 page patch injection failed', e); }

  ready('ready');
  setTimeout(() => ready('status'), 400);
  setTimeout(() => ready('status'), 1400);
  console.log('✅ LIVE KEIBA SIM Bridge 1.7.9 FIXED40 loaded');
})();
