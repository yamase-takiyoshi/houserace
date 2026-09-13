// ==UserScript==
// @name         LIVE KEIBA SIM Bridge 1.7.8 FIXED39
// @namespace    https://yamase-takiyoshi.github.io/houserace/
// @version      1.7.8
// @description  FIXED39: NAR odds use residential Bridge + desktop netkeiba first; keeps JRA/NAR bridge protocol compatible with houserace.
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

  const VERSION = '1.7.8';
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

  function isNarOddsUrl(u) {
    const h = u.hostname.toLowerCase();
    if (!(h === 'nar.netkeiba.com' || h === 'nar.sp.netkeiba.com')) return false;
    if (/api_get_nar_odds\.html$/i.test(u.pathname)) return false;
    return /^\/odds(?:\/|$)/i.test(u.pathname);
  }

  function canonicalNarOdds(value) {
    const u = validateTarget(value);
    if (!isNarOddsUrl(u)) return u.href;
    u.hostname = 'nar.netkeiba.com';
    u.pathname = '/odds/index.html';
    u.hash = '';
    return u.href;
  }

  function narCandidates(value) {
    const original = validateTarget(value).href;
    const u = new URL(original);
    if (!isNarOddsUrl(u)) return [original];

    const canonical = canonicalNarOdds(original);
    const alt = new URL(canonical);
    alt.pathname = '/odds/';

    const out = [canonical, alt.href, original];
    return [...new Set(out)];
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
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = fn => value => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout,
          responseType: 'text',
          anonymous: false,
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
            'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6'
          },
          onload: done(res => resolve({
            status: Number(res.status || 0),
            text: String(res.responseText ?? res.response ?? ''),
            finalUrl: String(res.finalUrl || url),
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
    const urls = narCandidates(input);
    const errors = [];
    let lastStatus = 0;

    for (const url of urls) {
      try {
        const r = await gmGet(url);
        lastStatus = r.status;
        if (!(r.status >= 200 && r.status < 300)) {
          errors.push(`${new URL(url).hostname} HTTP ${r.status || 0}`);
          continue;
        }
        if (!r.text || r.text.trim().length < 10) {
          errors.push(`${new URL(url).hostname} HTTP ${r.status} 本文不足`);
          continue;
        }
        if (blockedPage(r.text)) {
          errors.push(`${new URL(url).hostname} HTTP ${r.status} 遮断ページ`);
          continue;
        }
        return {
          status: r.status,
          text: r.text,
          finalUrl: r.finalUrl || url,
          charset: '',
          version: VERSION,
          via: isNarOddsUrl(new URL(url)) ? '住宅IP Bridge 1.7.8 / NAR PC優先' : '住宅IP Bridge 1.7.8'
        };
      } catch (e) {
        errors.push(`${new URL(url).hostname}: ${String(e?.message || e)}`);
      }
    }

    return {
      status: lastStatus >= 400 ? lastStatus : 0,
      text: '',
      finalUrl: urls[0] || String(input),
      error: errors.join(' / ') || 'Bridge取得失敗',
      version: VERSION,
      via: '住宅IP Bridge 1.7.8'
    };
  }

  function reply(payload) {
    try {
      window.postMessage(payload, SITE_ORIGIN);
    } catch (_) {
      window.postMessage(payload, '*');
    }
  }

  function ready(kind = 'ready') {
    reply({
      __narBridge: kind,
      ready: true,
      ok: true,
      version: VERSION,
      bridgeVersion: VERSION,
      source: 'Bridge-1.7.8-FIXED39',
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
        via: String(r.via || '住宅IP Bridge 1.7.8'),
        version: VERSION,
        bridgeVersion: VERSION,
        source: 'Bridge-1.7.8-FIXED39',
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
        source: 'Bridge-1.7.8-FIXED39',
        ts: Date.now()
      });
    }
  }, false);

  // Page-side FIXED39 patch:
  // NAR netkeiba odds and keiba.go.jp TodayRaceInfo are sent to the residential
  // bridge first, skipping a needless Cloudflare attempt. nar.sp odds URLs are
  // canonicalized to nar.netkeiba.com/odds/index.html.
  function injectPagePatch() {
    const code = `(() => {
      'use strict';
      if (window.__FIXED39_NATIVE_FIRST__) return;
      window.__FIXED39_NATIVE_FIRST__ = true;
      const VERSION = '1.7.8';
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      function isNarOdds(u){
        const h=u.hostname.toLowerCase();
        return (h==='nar.netkeiba.com'||h==='nar.sp.netkeiba.com') && /^\\/odds(?:\\/|$)/i.test(u.pathname) && !/api_get_nar_odds\\.html$/i.test(u.pathname);
      }
      function canonical(value){
        const u=new URL(String(value));
        if(isNarOdds(u)){
          u.hostname='nar.netkeiba.com';
          u.pathname='/odds/index.html';
          u.hash='';
        }
        return u.href;
      }
      function nativeFirst(value){
        try{
          const u=new URL(String(value));
          if(isNarOdds(u)) return true;
          return (u.hostname==='www.keiba.go.jp'||u.hostname==='keiba.go.jp') && /^\\/KeibaWeb\\/TodayRaceInfo\\//i.test(u.pathname);
        }catch(_){ return false; }
      }
      async function install(){
        for(let i=0;i<160;i++){
          if(typeof window.__oneFileBridgeFetch==='function' && typeof window.__residentialBridgeFetch38==='function') break;
          await sleep(50);
        }
        if(typeof window.__oneFileBridgeFetch!=='function' || typeof window.__residentialBridgeFetch38!=='function') return;
        if(window.__oneFileBridgeFetch.__fixed39) return;
        const original=window.__oneFileBridgeFetch.bind(window);
        const wrapped=async function(url){
          if(!nativeFirst(url)) return original(url);
          const target=canonical(url);
          try{
            return await window.__residentialBridgeFetch38(target);
          }catch(e){
            console.warn('[FIXED39] native-first failed; fallback original route', target, e);
            return original(target);
          }
        };
        wrapped.__fixed39=true;
        wrapped.__original=original;
        window.__oneFileBridgeFetch=wrapped;
        window.__narBridgeVersion=VERSION;
        const detail=document.getElementById('bridgeDetail38');
        if(detail && !/FIXED39/.test(detail.textContent||'')){
          detail.textContent='FIXED39: NARは住宅IP Bridge→PC版netkeiba優先';
        }
        try{window.postMessage({__narBridge:'status',ready:true,ok:true,version:VERSION,bridgeVersion:VERSION,source:'FIXED39-page-patch',ts:Date.now()},location.origin)}catch(_){ }
        console.log('✅ FIXED39 native-first page patch loaded / Bridge '+VERSION);
      }
      install();
    })();`;
    const s = document.createElement('script');
    s.textContent = code;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.remove();
  }

  try { injectPagePatch(); } catch (e) { console.warn('FIXED39 page patch injection failed', e); }

  ready('ready');
  setTimeout(() => ready('status'), 400);
  setTimeout(() => ready('status'), 1400);
  console.log('✅ LIVE KEIBA SIM Bridge 1.7.8 FIXED39 loaded');
})();
