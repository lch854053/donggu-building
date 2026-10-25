import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import XLSX from 'xlsx';
import gisHandler from '../api/vworld-bld.js';
import parcelHandler from '../api/vworld-parcel.js';

const page = readFileSync(new URL('../index.html', import.meta.url),'utf8');
function deferred(){ let resolve; const promise = new Promise(r=>{ resolve=r; }); return {promise,resolve}; }
function app(){
  const nodes = new Map();
  const node = id=>{
    if(!nodes.has(id)) nodes.set(id,{ id, innerHTML:'', textContent:'', value:'', isConnected:true,
      disabled:false, style:{}, classList:{add(){},remove(){},toggle(){}}, addEventListener(){},
      children:[], parentElement:{after(){}}, contains(){return false;},
      querySelectorAll(){ return []; }, append(...items){this.children.push(...items);}, after(){}, remove(){ this.isConnected=false; } });
    return nodes.get(id);
  };
  const document = {getElementById:node, querySelectorAll:()=>[], addEventListener(){}, lastModified:'2026-10-25',
    createElement:()=>node(Math.random()), createTextNode:s=>s, createDocumentFragment:()=>({appendChild(){}})};
  const context = vm.createContext({ document, URLSearchParams, setTimeout, clearTimeout, console:{warn(){},error(){}},
    fetch:async()=>{throw Error('not mocked');}, XLSX, alert(){}, location:{}, window:{} });
  for(const file of ['transform.js','vacant-model.js','app-api.js','reliability.js','result-format.js']) vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
  vm.runInContext(page.match(/<script>\s*([\s\S]*?)<\/script>/)[1],context);
  return {c:context,node,run:s=>vm.runInContext(s,context)};
}

test('detail reversed tab responses cannot overwrite selection; successful parcel cache is reused',async()=>{
  const {c,node,run}=app(), slow=deferred();
  run("D_CAND={sigunguCd:'29110',bjdongCd:'11800',bun:'0031',ji:'0000'}");
  c.fetchOpAll=()=>slow.promise;
  const first=c.loadSubtab('flr','1');
  await c.loadSubtab('park','1');
  const selected=node('dPanel').innerHTML;
  slow.resolve({items:[{dongNm:'1',flrNo:1,flrNoNm:'1층'}]}); await first;
  assert.equal(node('dPanel').innerHTML,selected);
  c.fetchOpAll=()=>{throw Error('cache not reused');};
  await c.loadSubtab('flr','1');
  assert.match(node('dPanel').innerHTML,/1층/);
});

test('old detail response cannot pollute a new address cache or reappear after reset',async()=>{
  const {c,node,run}=app(), slow=deferred();
  run("D_CAND={sigunguCd:'29110',bjdongCd:'11800',bun:'0031',ji:'0000'}");
  c.fetchOpAll=()=>slow.promise;
  const first=c.loadSubtab('flr','');
  c.clearDetail();
  node('dPanel').innerHTML='reset';
  slow.resolve({items:[{flrNoNm:'OLD'}]}); await first;
  assert.equal(node('dPanel').innerHTML,'reset');
  assert.equal(run('Object.keys(D_CACHE).length'),0);
});

test('history and temporary requests have the same tab ownership guard',async()=>{
  const {c,node,run}=app(), slow=deferred();
  run("D_CAND={sigunguCd:'29110',bjdongCd:'11800',bun:'0031',ji:'0000'}");
  c.api=()=>slow.promise;
  c.fetchOpAll=async()=>({items:[]});
  const history=c.loadSubtab('hist','');
  c.api=async()=>({ok:true,data:{items:[]}});
  await c.loadSubtab('tmphdcr','');
  slow.resolve({ok:true,data:{items:[]}}); await history;
  assert.match(node('dPanel').innerHTML,/가설건축물·공작물 정보가 없습니다/);
  assert.doesNotMatch(node('dPanel').innerHTML,/유지점검/);
});

test('closed register reversed responses and close isolate both panel and cache',async()=>{
  const {c,node,run}=app(), slow=deferred();
  run("MRESULTS=[{bjd:'11000',bun:'0543',ji:'0002'}]; M_DET_IDX=0;");
  c.fetchShtOpAll=()=>slow.promise;
  const first=c.loadDemolSubtab('flr');
  await c.loadDemolSubtab('park');
  const selected=node('mPanel').innerHTML;
  c.closeDemolDetail();
  slow.resolve({items:[{flrNoNm:'OLD'}]}); await first;
  assert.equal(node('mPanel').innerHTML,selected);
  assert.equal(run('Object.keys(M_DET_CACHE).length'),0);
});

test('partial pages retry only failures, retain success, and merge without duplicates',async()=>{
  const {run,c}=app(); let failing=true; const calls=[];
  c.pageFetch=async t=>{
    calls.push(t.pg);
    if(t.pg===2 && failing) return {error:'timeout'};
    return {titles:t.pg===1 ? [{id:1},{id:2}] : [{id:2},{id:3}],totalCount:4};
  };
  const ledger=run("new QueryLedger('계림2동',pageFetch,'titles')");
  await ledger.collect([{bjd:'10900',pg:1}]);
  assert.equal(ledger.status(),'부분 조회'); assert.equal(ledger.rows().length,2);
  failing=false; await ledger.retry();
  assert.deepEqual(calls,[1,2,2]); assert.equal(ledger.rows().length,3); assert.equal(ledger.status(),'전체 성공');
});

test('failed first page, unknown totals, inconsistent emptiness and normal zero are distinct',async()=>{
  const {run,c}=app();
  for(const [result,status] of [[{error:'timeout'},'전체 실패'],[{titles:[],totalCount:0},'정상 0건'],
    [{titles:[],totalCount:10},'전체 실패'],[{titles:[]},'전체 실패']]){
    c.pageFetch=async()=>result;
    const ledger=run("new QueryLedger('test',pageFetch,'titles')");
    await ledger.collect([{bjd:'10900',pg:1}]); assert.equal(ledger.status(),status);
  }
});

test('partial export preserves data columns and embeds query status/ranges in a real xlsx workbook',async()=>{
  const {run,c}=app();
  c.pageFetch=async t=>t.bjd==='10900' ? {error:'timeout'} : {titles:[],totalCount:0};
  const ledger=run("new QueryLedger('행정동=계림2동; 연도=전체',pageFetch,'titles')");
  await ledger.collect([{bjd:'10900',pg:1},{bjd:'11000',pg:1}]);
  c.ledger=ledger;
  run("QUERY_SESSIONS.set('condition',{ledger}); CRESULTS=[{platPlc:'계림동 1',useAprDay:''}];");
  let exported;
  c.XLSX={...XLSX,writeFile:wb=>{exported=XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});}};
  c.exportConditionExcel();
  assert.deepEqual(exported.SheetNames,['조건검색','조회정보']);
  const info=JSON.stringify(XLSX.utils.sheet_to_json(exported.Sheets['조회정보'],{header:1}));
  assert.match(info,/부분 조회/); assert.match(info,/10900/); assert.match(info,/보장할 수 없습니다/);
  assert.equal(XLSX.utils.sheet_to_json(exported.Sheets['조건검색'])[0]['지번주소'],'계림동 1');
});

test('GIS parcel common values never claim selected-dong violation and missing seismic is unknown',()=>{
  const {c,run}=app();
  run("D_BLDGIS={state:'success',properties:{hg:15.7,violt_bild:'N',last_updt_dt:'2026-10-05Z'},violtAny:true};");
  const html=c.cardHTML({dongNm:'부속동'},'일반');
  assert.match(html,/필지 대표건물 높이/); assert.match(html,/선택 동과 매칭 미확인/);
  assert.match(html,/선택 동 판정 아님/); assert.match(html,/미확인/);
  for(const value of [null,undefined,'',' ','Y','2']) assert.equal(c.seismicLabel(value),'미확인');
  assert.equal(c.seismicLabel('1'),'적용'); assert.equal(c.seismicLabel('0'),'미적용');
  assert.equal(c.fmt(' '),'-'); assert.equal(c.fmt(0),'0');
});

test('API error, abort, successful empty and temporary partial error stay distinct and safe',async()=>{
  const {c}=app();
  c.fetch=async()=>({ok:false,status:503});
  await assert.rejects(c.searchJuso('주소'),/불러오지 못/);
  assert.equal((await c.bldgisFromPNU('2911011800100310000')).state,'error');
  c.fetch=async()=>{throw Object.assign(Error('secret-key'),{name:'AbortError'});};
  const aborted=await c.api('building',{}); assert.equal(aborted.cancelled,true); assert.doesNotMatch(aborted.error,/secret/);
  c.fetch=async()=>({ok:true,status:200,json:async()=>({juso:[],found:false})});
  assert.equal((await c.searchJuso('주소')).length,0);
  assert.equal((await c.bldgisFromPNU('2911011800100310000')).state,'empty');
  assert.match(c.renderTmpHdcr({tmp:[],hdcr:[],errors:['공작물']}),/불러오지 못함/);
  assert.doesNotMatch(c.renderTmpHdcr({tmp:[],hdcr:[],errors:['공작물']}),/정보가 없습니다/);
});

test('GIS proxy does not turn HTTP failure or malformed response into found:false',async()=>{
  const original=globalThis.fetch, key=process.env.VWORLD_KEY;
  process.env.VWORLD_KEY='secret-for-test';
  try{
    for(const response of [new Response('{}',{status:503}), new Response('{"error":"bad key"}')]){
      globalThis.fetch=async()=>response.clone();
      const state={}; const res={setHeader(){},status(n){state.status=n;return this;},json(d){state.body=d;return this;}};
      await gisHandler({method:'GET',headers:{origin:'http://localhost:3000'},query:{pnu:'2911011800100310000'}},res);
      assert.ok(state.status>=400); assert.doesNotMatch(JSON.stringify(state.body),/secret-for-test/);
    }
  }finally{ globalThis.fetch=original; if(key===undefined) delete process.env.VWORLD_KEY; else process.env.VWORLD_KEY=key; }
});

test('condition and demolition searches refilter, sort, recount and export recovered pages',async()=>{
  for(const kind of ['condition','demol']){
    const {c,node,run}=app(); let failing=true; const calls=[];
    run(`HJ={hdong2bjd:{'계림2동':['10900']},jibun2hdong:{'1090000010000':'계림2동'}};
      ALL_BJD=['10900']; Object.assign(MS,{purps:{selected:()=>[]},strct:{selected:()=>[]}});
      const dual={values:()=>[0,99999],atCap:()=>true,isFull:()=>true};
      Object.assign(DUAL,{flr:dual,uflr:dual,area:dual,year:dual});
      M_FILTERS_READY=true; M_GB={selected:()=>[]}; M_DUAL_year=dual;`);
    node('c-hdong').value='계림2동'; node('m-hdong').value='계림2동';
    node('c-yearunknown').checked=true; node('m-yearunknown').checked=true;
    const fetcher=async(bjd,pg)=>{
      calls.push(pg); if(pg===2&&failing) return {error:'timeout'};
      const row={bjdongCd:bjd,bun:'0001',ji:'0000',bldNm:'건물'+pg,platPlc:'계림동 1',totArea:pg,
        demolExtngGbCdNm:'멸실',demolExtngDay:'20200'+pg+'01'};
      return {[kind==='condition'?'titles':'items']:[row],totalCount:2};
    };
    c.fetchDongPage=fetcher; c.fetchDemolDong=fetcher;
    c.renderConditionResults=()=>{}; c.renderDemolResults=()=>{};
    await c[kind==='condition'?'runConditionSearch':'runDemolSearch']();
    const session=run(`QUERY_SESSIONS.get('${kind}')`);
    assert.equal(session.ledger.status(),'부분 조회');
    failing=false;
    await node('query-status-'+kind).children.find(x=>x?.textContent==='실패 요청만 재시도').onclick();
    assert.deepEqual(calls,[1,2,2]);
    assert.equal(run(kind==='condition'?'CRESULTS.length':'MRESULTS.length'),2);
    assert.equal(session.ledger.status(),'전체 성공');
    if(kind==='demol'){
      assert.equal(run('MRESULTS[0].extngDay'),'20200201');
      let wb; c.XLSX={...XLSX,writeFile:value=>{wb=value;}}; c.exportDemolExcel();
      assert.ok(wb.Sheets['조회정보']); assert.ok(wb.Sheets['철거멸실대장']);
    }
  }
});

test('a retry finishing after filter revision or a new search cannot change displayed rows or metadata',async()=>{
  for(const change of ['filter','new-search']){
    const {c,node,run}=app(), slow=deferred();
    c.pageFetch=async()=>({error:'timeout'});
    const session=run("startQuery('condition','cHint','tab-cond',pageFetch,'titles')");
    await session.ledger.collect([{bjd:'10900',pg:1}]);
    let applied=0; session.apply=()=>applied++;
    c.showQueryStatus(session);
    session.ledger.fetchPage=()=>slow.promise;
    const retry=node('query-status-condition').children.find(x=>x?.textContent==='실패 요청만 재시도').onclick();
    if(change==='filter') run("QUERY_REVISIONS.set('condition',1)");
    else run("startQuery('condition','cHint','tab-cond',pageFetch,'titles')");
    slow.resolve({titles:[{id:'old'}],totalCount:1}); await retry;
    assert.equal(applied,0); assert.equal(session.ledger.status(),'전체 실패');
  }
});

test('map building completeness warning survives geometry rendering and retry uses only failed page',async()=>{
  const {c,node,run}=app(); let failing=true; const calls=[];
  run("HJ={hdong2bjd:{'계림2동':['10900']},jibun2hdong:{}}; ALL_BJD=['10900']; M_LAYER.cond={clearLayers(){}};");
  c.fetchDongPage=async(bjd,pg)=>{
    calls.push(pg); if(pg===2&&failing)return {error:'timeout'};
    return {titles:[{bjdongCd:bjd,bun:'000'+pg,ji:'0000'}],totalCount:2};
  };
  await c.runCondForMap(null);
  const session=run("QUERY_SESSIONS.get('map')");
  assert.equal(session.ledger.status(),'부분 조회');
  // Empty viewport writes only transient mapHint, never the separate completeness element.
  run("M_MAP={getBounds:()=>({})}; M_RESULTS.cond=[];");
  c.redrawCondLayer=()=>{};
  await c.refreshCondViewport();
  assert.match(node('query-status-map').textContent,/일부 자료를 불러오지 못했습니다/);
  failing=false; session.afterRetry=async()=>{};
  await node('query-status-map').children.find(x=>x?.textContent==='실패 요청만 재시도').onclick();
  assert.deepEqual(calls,[1,2,2]); assert.equal(run('M_RESULTS.cond.length'),2);
});

test('reset during initial address and title loading cannot restore stale building state',async()=>{
  for(const stage of ['address','gis']){
    const {c,node,run}=app(), slow=deferred();
    run('HJ={}'); node('dInput').value='서남로 1';
    c.searchJuso=()=>stage==='address' ? slow.promise : Promise.resolve([]);
    c.resolveByCandidates=async()=>({titles:[{bldNm:'old'}],usedParams:{sigunguCd:'29110',bjdongCd:'11800',bun:'0031',ji:'0000'}});
    c.loadBldgis=()=>slow.promise;
    const pending=c.runDetail();
    await Promise.resolve(); await Promise.resolve();
    c.clearDetail();
    slow.resolve(stage==='address' ? [] : {state:'success',properties:{hg:15.7}});
    await pending;
    assert.equal(run('D_TITLES.length'),0); assert.equal(run('D_BLDGIS'),null);
    assert.equal(node('dResult').style.display,'none'); assert.equal(node('dRunBtn').disabled,false);
  }
});

test('vacant failure is not normal zero and can recover on the next search',async()=>{
  const {c,node,run}=app();
  c.fetch=async()=>({ok:false,status:503});
  await c.runVacantSearch();
  assert.equal(run('V_LOAD_STATE'),'error'); assert.match(node('vHint').textContent,/불러오지 못/);
  c.fetch=async()=>({ok:true,json:async()=>[]});
  await c.loadVacantData(); assert.equal(run('V_LOAD_STATE'),'success'); assert.equal(run('V_DATA.length'),0);
});

test('missing page tails and capped scans remain incomplete; concurrency is bounded',async()=>{
  const {c,run}=app(); let active=0,max=0;
  c.pageFetch=async t=>{
    active++; max=Math.max(max,active); await Promise.resolve(); active--;
    return {titles:t.pg===1 ? [{id:t.bjd}] : [],totalCount:2};
  };
  const ledger=run("new QueryLedger('test',pageFetch,'titles')");
  await ledger.collect([{bjd:'a',pg:1},{bjd:'b',pg:1},{bjd:'c',pg:1}]);
  assert.ok(max<=2); assert.equal(ledger.status(),'부분 조회'); assert.equal(ledger.failed().length,3);
  let count=0;
  c.pageFetch=async t=>{count++; return {titles:[{id:t.pg}],totalCount:101};};
  const capped=run("new QueryLedger('cap',pageFetch,'titles')");
  await capped.collect([{bjd:'a',pg:1}]);
  assert.equal(count,100); assert.equal(capped.status(),'부분 조회'); assert.equal(capped.failed()[0].limit,true);
});

test('dong switch keeps parcel cache but renders only the currently selected dong',async()=>{
  const {c,node,run}=app(), slow=deferred();
  run("D_CAND={sigunguCd:'29110',bjdongCd:'11800',bun:'0031',ji:'0000'}; D_DONGS=[{dongNm:'1동'},{dongNm:'2동'}]; D_TITLES=D_DONGS;");
  c.selectDong(0); c.fetchOpAll=()=>slow.promise;
  const pending=c.loadSubtab('flr','1동');
  c.selectDong(1); node('dPanel').innerHTML='선택 2동';
  slow.resolve({items:[{dongNm:'1동',flrNoNm:'FIRST'},{dongNm:'2동',flrNoNm:'SECOND'}]}); await pending;
  assert.equal(node('dPanel').innerHTML,'선택 2동');
  c.fetchOpAll=()=>{throw Error('parcel cache lost');};
  await c.loadSubtab('flr','2동');
  assert.match(node('dPanel').innerHTML,/SECOND/); assert.doesNotMatch(node('dPanel').innerHTML,/FIRST/);
});

test('temporary supplementary retry preserves success and fetches only the failed operation',async()=>{
  const {c,node,run}=app(); let failing=true; const calls=[];
  run("D_CAND={sigunguCd:'29110',bjdongCd:'11800',bun:'0031',ji:'0000'}");
  c.api=async(path,p)=>{
    calls.push(p.op);
    return p.op==='getApHdcrMgmRgstInfo' && failing ? {ok:false} : {ok:true,data:{items:[]}};
  };
  await c.loadSubtab('tmphdcr',''); assert.match(node('dPanel').innerHTML,/공작물 불러오지 못함/);
  failing=false; await c.loadSubtab('tmphdcr','');
  assert.deepEqual(calls,['getApTmpBldInfo','getApHdcrMgmRgstInfo','getApHdcrMgmRgstInfo']);
  assert.match(node('dPanel').innerHTML,/정보가 없습니다/);
});

test('malformed JSON is not a transient retry and diagnostics omit URL credentials',async()=>{
  const {c}=app(); let calls=0; const logs=[];
  c.console={warn:(...args)=>logs.push(args)};
  c.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>{throw Error('https://example?key=SECRET');}};};
  const result=await c.apiRetry('building',{}, {baseDelay:1});
  assert.equal(result.kind,'format'); assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify([result,logs]),/SECRET/);
});

test('parcel batch records per-PNU success, empty and error without discarding valid geometry or caching failures',async()=>{
  const original=globalThis.fetch, key=process.env.VWORLD_KEY;
  process.env.VWORLD_KEY='test-key';
  try{
    globalThis.fetch=async url=>{
      const pnu=new URL(url).searchParams.get('attrFilter').split(':').at(-1);
      if(pnu.endsWith('0002')) return new Response('{}',{status:503});
      return new Response(JSON.stringify({response:{status:'OK',result:{featureCollection:{features:pnu.endsWith('0003')?[]:[{
        properties:{pnu},geometry:{type:'Point',coordinates:[126.9,35.1]}
      }]}}}}));
    };
    const state={headers:{}};
    const res={setHeader(k,v){state.headers[k]=v;},status(n){state.status=n;return this;},json(d){state.body=d;return this;}};
    await parcelHandler({method:'GET',headers:{origin:'http://localhost:3000'},query:{pnus:'2911011800100310001,2911011800100310002,2911011800100310003'}},res);
    assert.equal(state.body.features.length,1);
    assert.deepEqual(state.body.requests.map(r=>r.state),['success','error','empty']);
    assert.equal(state.headers['Cache-Control'],'no-store');
  }finally{globalThis.fetch=original;if(key===undefined)delete process.env.VWORLD_KEY;else process.env.VWORLD_KEY=key;}
});

test('new address search owns title, GIS and cache even when the old address finishes last',async()=>{
  const {c,node,run}=app(), slow=deferred();
  run('HJ={}');
  c.searchJuso=query=>query.includes('이전')?slow.promise:Promise.resolve([{marker:'new'}]);
  c.resolveByCandidates=async(candidates,top)=>({titles:[{bldNm:top.marker}],usedParams:{sigunguCd:'29110',bjdongCd:'11800',bun:top.marker==='new'?'0002':'0001',ji:'0000'}});
  c.loadBldgis=async pnu=>({state:'success',properties:{pnu}}); c.loadLdaData=async()=>null;
  c.renderDetail=()=>{};
  node('dInput').value='이전 주소'; const old=c.runDetail();
  node('dInput').value='새 주소'; await c.runDetail();
  run("D_CACHE.flr=[{marker:'new-cache'}]");
  slow.resolve([{marker:'old'}]); await old;
  assert.equal(run('D_CAND.bun'),'0002'); assert.equal(run('D_TITLES[0].bldNm'),'new');
  assert.equal(run('D_CACHE.flr[0].marker'),'new-cache');
  assert.equal(run('D_BLDGIS.properties.pnu'),'2911011800100020000');
});

test('stale map geocoding cannot create a map inside another selected tab',async()=>{
  const {c,node,run}=app(), slow=deferred();
  run("D_CAND={sigunguCd:'29110',bjdongCd:'11800',bun:'0031',ji:'0000'}; D_TITLES=[{newPlatPlc:'서남로 1'}]");
  c.geocodeAddr=()=>slow.promise;
  c.L={map(){throw Error('stale map created');}};
  const old=c.loadSubtab('map',''); await c.loadSubtab('park','');
  const selected=node('dPanel').innerHTML;
  slow.resolve({x:126.9,y:35.1}); await old;
  assert.equal(node('dPanel').innerHTML,selected);
});

test('malformed rows and blank page totals are failures, not successful empty data',async()=>{
  const {c,run}=app();
  for(const result of [{titles:[null],totalCount:1},{titles:[],totalCount:' '}]){
    c.pageFetch=async()=>result;
    const ledger=run("new QueryLedger('invalid',pageFetch,'titles')");
    await ledger.collect([{bjd:'10900',pg:1}]);
    assert.equal(ledger.status(),'전체 실패');
  }
});
