import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const scope={};new Function('globalThis',readFileSync(new URL('../ui-labels.js',import.meta.url),'utf8'))(scope);
const labels=scope.UiLabels;
const code=readFileSync(new URL('../transform.js',import.meta.url),'utf8');
const pick=new Function(code+'\nreturn pickDetailTitle;')();
const source=JSON.parse(readFileSync(new URL('./fixtures/ui-stage1-seonam-titles.json',import.meta.url),'utf8'));
test('actual Seonam-ro 1 response defaults to first designated main, not the 44.78㎡ auxiliary',()=>{
  const original=source.titles.slice();assert.equal(pick(original).mgmBldrgstPk,1065124168);assert.deepEqual(original,source.titles);
  assert.equal(pick(original,'2').mgmBldrgstPk,1065124169);
});
test('explicit dong and main designation beat area and purpose completeness; ties preserve order',()=>{
  const aux={dongNm:'101동',mainAtchGbCdNm:'부속건축물',mainPurpsCdNm:'업무시설',totArea:999999},main={dongNm:'102동',mainAtchGbCdNm:'주건축물',totArea:1};
  assert.equal(pick([aux,main]),main);assert.equal(pick([aux,main],'101'),aux);
  assert.equal(pick([{...main,mainAtchGbCdNm:'',mainAtchGbCd:'0'},aux]).dongNm,'102동');
  assert.equal(pick([main,{...main,totArea:1000}]),main);assert.equal(pick([]),null);assert.equal(pick(null),null);
});
test('unknown designation safely retains a candidate without dropping rows',()=>{const rows=[{},{}];assert.equal(pick(rows),rows[0]);});
test('legacy recent states display Korean summaries without changing persisted keys or guessing filters',()=>{
  assert.equal(labels.recent({v:1,tab:'detail',f:{dInput:'서남로 1'}}),'서남로 1 · 건물 상세');
  assert.equal(labels.recent({v:1,menu:'map',f:{'map-hdong':'계림2동',mapSourceGrid:['vacant']}}),'계림2동 · 빈집 지도');
  assert.equal(labels.recent({v:1,menu:'demol',f:{'m-hdong':'계림2동'}}),'계림2동 · 철거·멸실 조회');
  assert.equal(labels.recent({v:1,menu:'vacant'}),'동구 전체 · 빈집 조회');
  assert.match(labels.recent({v:1,menu:'map'}),/빈집·공동주택 지도/);
});
test('different stored filters are distinguishable and full addresses are not truncated in labels',()=>{
  const a={v:1,menu:'vacant',f:{'v-hdong':'학동','vms-grade':['3등급']}};
  assert.notEqual(labels.recent(a),labels.recent({...a,f:{...a.f,'vms-grade':['4등급']}}));
  const address='매우 긴 한글 주소 '.repeat(20);assert.ok(labels.recent({v:1,tab:'detail',f:{dInput:address}}).includes(address));
});
test('v1 omitted tab still means bulk; first-visit presentation does not change the codec default',()=>{
  const stateScope={};new Function('globalThis',readFileSync(new URL('../search-state.js',import.meta.url),'utf8'))(stateScope);
  const url=stateScope.SearchState.encode({v:1,f:{input:'서남로 1'}},'https://donggu-building.vercel.app');
  assert.deepEqual(stateScope.SearchState.parse(url).state,{v:1,f:{input:'서남로 1'}});
  assert.match(readFileSync(new URL('../search-navigation.js',import.meta.url),'utf8'),/menu==='building'\?'bulk'/);
});
