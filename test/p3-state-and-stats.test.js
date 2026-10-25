import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const scope={};for(const file of ['search-state.js','stats-metadata.js'])new Function('globalThis',readFileSync(new URL('../'+file,import.meta.url),'utf8'))(scope);
const S=scope.SearchState,M=scope.StatsMetadata,base='https://donggu-building.vercel.app/';
test('versioned conditions round-trip Korean, punctuation, whitespace and empty addresses',()=>{
  for(const input of ['서남로 1 (본관) & <문> # + / ? % 😀','', '  동구\n계림동 1-2  ']){
    const s={v:1,f:{input}};assert.deepEqual(S.parse(S.encode(s,base)).state,s);
  }
  assert.deepEqual(S.parse(S.encode({v:1,tab:'cond',f:{'dual-area':[123.45,2000],'c-yearunknown':false}},base)).state,{v:1,tab:'cond',f:{'dual-area':[123.45,2000],'c-yearunknown':false}});
});
test('invalid versions, range/page types, unsafe field names, view and malformed encoding are rejected',()=>{
  for(const s of [{v:2},{v:1,menu:'<script>'},{v:1,page:0},{v:1,page:'2'},{v:1,tab:'cond',f:{'dual-flr':[10,1]}},{v:1,f:{serviceKey:'secret'}},{v:1,apiResponse:{}},{v:1,pick:{id:'a',token:'secret'}},{v:1,view:[0,0,15]},{v:1,f:{input:null}}])assert.throws(()=>S.validate(s));
  assert.equal(S.parse(base+'#q=%XX').ok,false);assert.equal(S.parse(base+'#q=%7B').ok,false);assert.equal(S.parse(base).state,null);
});
test('overlong bulk links reject rather than truncate; bounded JSON file preserves addresses',()=>{
  const s={v:1,f:{input:Array(500).fill('광주 동구 서남로 1').join('\n')}};
  assert.throws(()=>S.encode(s,base),/JSON/);assert.equal(S.validate(s,{file:true}).f.input,s.f.input);
  assert.throws(()=>S.encode({v:1,f:{input:'a'.repeat(12000)}},base),/JSON/);
  assert.throws(()=>S.validate({v:1,f:{input:'a'.repeat(200001)}},{file:true}));
});
test('only active allowlisted filters are accepted and irrelevant credentials cannot survive encoding',()=>{
  assert.throws(()=>S.validate({v:1,menu:'housing',f:{'v-hdong':'학동'}}));
  const url=S.encode({v:1},base+'?serviceKey=secret#old');assert.doesNotMatch(url,/secret|serviceKey/);
  assert.equal(S.encode({v:1,page:1,sort:'default'},base),S.encode({v:1},base));
});
test('recent searches tolerate storage faults and invalid records; bulk is never read as recent',()=>{
  assert.deepEqual(S.readRecent({getItem(){throw Error();}}),[]);assert.equal(S.saveRecent({setItem(){throw Error();}},[]),false);
  for(const raw of ['{','null','{}'])assert.deepEqual(S.readRecent({getItem:()=>raw}),[]);
  const rows=[{state:{v:1,tab:'detail',f:{dInput:'서남로 1'}},at:'2026-10-25'}, {state:{v:1,f:{input:'addresses'}},at:'date'},{state:{v:9},at:'date'}];
  assert.equal(S.readRecent({getItem:()=>JSON.stringify(rows)}).length,1);
  let saved;S.saveRecent({setItem(k,v){saved=JSON.parse(v);}},Array(20).fill(rows[0]));assert.equal(saved.length,10);
});
test('all current KOSIS and REB indicators expose units, periods, collection and official links',()=>{
  for(const [file,kind] of [['stats_donggu.json','kosis'],['reb_stats_donggu.json','reb']]){
    const data=JSON.parse(readFileSync(new URL('../'+file,import.meta.url),'utf8'));
    for(const ind of data.indicators){const m=M.metadata(kind,ind,data);assert.ok(m.name&&m.population&&m.description&&m.unit&&m.period&&m.region&&m.collected&&m.cycle&&m.provider);assert.match(m.url,/^https:\/\/(kosis\.kr|www\.reb\.or\.kr)\//);assert.match(M.details(kind,ind,data),/자료 기준시점/);}
  }
});
test('SGIS requested year and collection year cannot be claimed as the summary reference year',()=>{
  const m=M.metadata('sgis',{}, {summaryYear:'2024',generatedAt:'2026-08-03'});assert.match(m.period,/확인 필요/);assert.doesNotMatch(m.period,/2024|2026/);assert.match(m.unit,/가구/);
});
test('index base is explicit unknown for stored data and price units are retained',()=>{
  const m=M.metadata('reb',{id:'apt_sale_index',unit:'지수'},{generatedAt:'date'});assert.match(m.indexBase,/확인 필요/);assert.match(m.indexBase,/2026.6=100/);
  assert.match(M.comparison(),/일시적인 미거주/);assert.match(M.comparison(),/원본 레코드/);
  assert.doesNotMatch(M.details('kosis',{id:'houses',name:'<script>'},{}),/<script>/);
});
test('metadata collectors use shared definitions without secret fields',()=>{
  for(const file of ['update-stats.mjs','update-sgis-stats.mjs','update-reb-stats.mjs'])assert.match(readFileSync(new URL('../scripts/'+file,import.meta.url),'utf8'),/statsMetadata\(/);
  assert.doesNotMatch(JSON.stringify(M.metadata('reb',{unit:'천원'},{})),/API_KEY|accessToken|serviceKey/);
});
