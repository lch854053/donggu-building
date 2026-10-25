import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {identifyVacantRows,createVacantDataset,vacantCounts,groupVacantGeometry,vacantFingerprint} from '../scripts/lib/vacant-model.mjs';
const source=JSON.parse(readFileSync(new URL('../vacantlist_donggu.json',import.meta.url)));
const geo=JSON.parse(readFileSync(new URL('../vacant_geo.json',import.meta.url)));
const shape={type:'Polygon',coordinates:[[[126,35],[126.1,35],[126.1,35.1],[126,35]]]};
const row={dong:'계림동',hdong:'계림2동',jibun:'광주광역시 동구 계림동241-15',doro:'중앙로290번길1-8',kind:'단독',year:1985,struct:'벽돌구조',tarea:39.18,grade:'3등급',baseDate:'2025-07-16',x:1,y:2};
function context(fetchImpl,clock={now:()=>Date.now()}){
  const DateProxy=class extends Date{static now(){return clock.now();}};
  const ctx=vm.createContext({URLSearchParams,fetch:fetchImpl,Date:DateProxy,setTimeout,clearTimeout,console:{warn(){}}});
  for(const file of ['transform.js','vacant-model.js','app-api.js','reliability.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx);
  return ctx;
}
const success=data=>({ok:true,status:200,json:async()=>data});

test('current vacant source rows are all preserved and traceable in the shared list/map dataset',()=>{
  const rows=createVacantDataset(source,geo),counts=vacantCounts(rows);
  assert.equal(rows.length,source.length);assert.equal(new Set(rows.map(r=>r.recordId)).size,source.length);
  assert.equal(counts.located+counts.unknown,source.length);
  for(let i=0;i<source.length;i++)for(const key of Object.keys(source[i]))assert.deepEqual(rows[i][key],source[i][key]);
  const target=rows.find(r=>r.jibun.includes('241-15'));
  assert.equal(target.baseDate,'2025-07-16');assert.ok(target.geometry);assert.ok(target.recordId);
  assert.notEqual(target.recordId,target.parcelId);assert.equal(target.collectedAt,null);
});

test('same address, different buildings/rows and exact duplicate copies are never merged',()=>{
  const input=[row,{...row,year:1970,x:3},row];
  const records=createVacantDataset(input,[{...row,pnu:'1221010900102410015',geometry:shape}]);
  assert.equal(records.length,3);assert.equal(new Set(records.map(r=>r.recordId)).size,3);
  assert.equal(records[1].geometry,null);assert.equal(records[1].geometryStatus,'unknown');
  assert.equal(groupVacantGeometry(records)[0].members.length,2);
  assert.equal(vacantCounts(records).located,2);
});

test('stable record IDs survive input reorder, source ID zero works, and parcel IDs remain separate',()=>{
  const rows=[row,{...row,x:4,year:2000},{...row,sourceId:0}];
  const a=identifyVacantRows(rows),b=identifyVacantRows(rows.slice().reverse()).reverse();
  assert.deepEqual(a.map(r=>r.recordId),b.map(r=>r.recordId));
  assert.match(a[2].recordId,/source:0/);
  assert.equal(identifyVacantRows(a)[0].recordId,a[0].recordId);
});

test('ambiguous legacy geometry and unrelated geometry rows do not create buildings or guessed positions',()=>{
  const records=createVacantDataset([row],[{...row,pnu:'a',geometry:shape},{...row,pnu:'b',geometry:{...shape,coordinates:[]}},
    {...row,jibun:'다른 주소',geometry:shape}]);
  assert.equal(records.length,1);assert.equal(records[0].geometry,null);
});

test('record-ID matched geometry from a different address or fingerprint is rejected',()=>{
  const [identified]=identifyVacantRows([row]);
  const records=createVacantDataset([identified],[{recordId:identified.recordId,recordFingerprint:vacantFingerprint({...row,x:99}),geometry:shape}]);
  assert.equal(records[0].geometry,null);
});

test('collector rejects ambiguous Excel keys instead of assigning the first address',()=>{
  const code=readFileSync(new URL('../scripts/update-vacant.mjs',import.meta.url),'utf8');
  const build=new Function(code.slice(code.indexOf('function buildExcelMap('),code.indexOf('function matchFromExcel('))+'return buildExcelMap;')();
  const a={dong:'계림동',hdong:'계림2동',jibun:'A',doro:'road',tarea:10,struct:'벽돌구조',grade:'2등급'};
  assert.equal(build([a,{...a,jibun:'B'}]).get('계림동|10|벽돌구조|2등급'),null);
  assert.equal(build([a,{...a}]).get('계림동|10|벽돌구조|2등급').jibun,'A');
});

test('collector geometry output retains IDs, dates and missing-location rows',async()=>{
  const code=readFileSync(new URL('../scripts/update-vacant.mjs',import.meta.url),'utf8');
  const collect=new Function('VWORLD_KEY','parcelForVacant','runPool','readFile','join','ROOT','console','vacantFingerprint',
    'const GEO_CONCURRENCY=2;'+code.slice(code.indexOf('async function collectVacantGeometry('),code.indexOf('async function main('))+'return collectVacantGeometry;')(
      true,async r=>r.x===9?null:{pnu:'1221010900102410015',geometry:shape,_viaGeo:true},
      (items,fn)=>Promise.all(items.map(fn)),async()=> '[]',(...parts)=>parts.join('/'),'.',{log(){}},vacantFingerprint);
  const rows=identifyVacantRows([row,{...row,x:9,jibun:'위치 미확인'}]);
  const out=await collect(rows);assert.equal(out.length,2);
  assert.equal(out[0].recordId,rows[0].recordId);assert.equal(out[0].baseDate,row.baseDate);
  assert.equal(out[1].geometry,null);assert.equal(out[1].geometryStatus,'unknown');
});

test('shared API requests coalesce, distinguish conditions, expire, and isolate caller mutations',async()=>{
  let calls=0,time=1000;const ctx=context(async()=>{calls++;await Promise.resolve();return success({titles:[{name:'original'}]});},{now:()=>time});
  const [a,b]=await Promise.all([ctx.apiShared('building',{bun:'1',op:'title'},{ttl:100}),ctx.apiShared('building',{op:'title',bun:'1'},{ttl:100})]);
  assert.equal(calls,1);a.data.titles[0].name='mutated';assert.equal(b.data.titles[0].name,'original');
  await ctx.apiShared('building',{bun:'2',op:'title'},{ttl:100});assert.equal(calls,2);
  time+=101;await ctx.apiShared('building',{bun:'1',op:'title'},{ttl:100});assert.equal(calls,3);
});

test('API error responses are not cached; successful empty responses expire after 30 seconds',async()=>{
  let calls=0,time=0;const ctx=context(async()=>{calls++;return calls===1?{ok:false,status:403}:success({titles:[],totalCount:0});},{now:()=>time});
  assert.equal((await ctx.apiShared('building',{})).ok,false);
  await ctx.apiShared('building',{});await ctx.apiShared('building',{});assert.equal(calls,2);
  time=30001;await ctx.apiShared('building',{});assert.equal(calls,3);
});

test('list and map share one dataset request, while geometry failure preserves source rows and is retried',async()=>{
  let calls=0,fail=true;const ctx=context(async path=>{
    calls++;if(path.includes('vacant_geo')&&fail)return {ok:false,status:503};
    return success(path.includes('vacant_geo')?[{...row,geometry:shape}]:[row]);
  });
  const [a,b]=await Promise.all([ctx.loadVacantDataset(),ctx.loadVacantDataset()]);
  assert.equal(calls,2);assert.equal(a.records.length,1);assert.equal(a.geometryState,'error');assert.equal(a,b);
  fail=false;const recovered=await ctx.loadVacantDataset();assert.equal(calls,4);assert.equal(recovered.geometryState,'success');assert.ok(recovered.records[0].geometry);
});

test('numeric range normalization handles reversed, blank, invalid, precise and out-of-range input',()=>{
  const ctx=context(async()=>success({}));
  const normalize=(...args)=>Array.from(ctx.normalizeRangePair(...args));
  assert.deepEqual(normalize(9,2,0,30),[2,9]);assert.deepEqual(normalize('','',0,30),[0,30]);
  assert.deepEqual(normalize(-1,999,0,30),[0,30]);assert.deepEqual(normalize('bad',null,1900,2026),[1900,2026]);
  assert.deepEqual(normalize('123.45','180.29',0,3000,0.01),[123.45,180.29]);
  assert.deepEqual(normalize(154,999,0,2000),[154,999]);
});

test('housing legal-dong scope includes every declared and parcel-mapped code, including split dongs',()=>{
  const ctx=context(async()=>success({}));
  const mapping={hdong2bjd:{'계림2동':['10900'],서남동:['11800']},jibun2hdong:{'1100000010000':'계림2동','1180000010000':'서남동'}};
  assert.deepEqual(Array.from(ctx.bjdScopeForHdong('계림2동',mapping)).sort(),['10900','11000']);
  assert.deepEqual(Array.from(ctx.bjdScopeForHdong('__ALL__',mapping)).sort(),['10900','11000','11800']);
});

test('legal-dong-only address fallback retains the record but cannot manufacture a specific map location',async()=>{
  const code=readFileSync(new URL('../scripts/update-vacant.mjs',import.meta.url),'utf8');
  let calls=0;
  const fn=new Function('geocodeJibun',code.slice(code.indexOf('async function parcelForVacant('),code.indexOf('// odcloud "빈집 현황" 데이터 좌표계'))+'return parcelForVacant;')(()=>{calls++;throw Error('must not geocode unverified dong fallback');});
  const result=await fn({...row,addressBasis:'법정동 단위 주소 폴백 · 개별 주소 미확인'});
  assert.equal(calls,0);assert.equal(result.state,'unknown');
});
