import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const scope={};new Function('globalThis',readFileSync(new URL('../filter-model.js',import.meta.url),'utf8'))(scope);const M=scope.FilterModel;
test('range summaries match finite years and unbounded caps without changing filter meaning',()=>{
  assert.equal(M.rangeText('dual-flr',[0,30],[0,30]),'전체');assert.equal(M.rangeText('dual-flr',[5,30],[0,30]),'5층 이상');assert.equal(M.rangeText('dual-flr',[5,10],[0,30]),'5~10층');
  assert.equal(M.rangeText('dual-year',[1900,2000],[1900,2026]),'2000년 이하');assert.equal(M.rangeText('dual-year',[2000,2026],[1900,2026]),'2000~2026년');assert.equal(M.rangeText('h-dual-year',[2000,2026],[1900,2026]),'2000년 이상');
});
test('group count counts each range/multiselect/unknown toggle independently, not selected values',()=>{
  const defaults={'c-hdong':'__ALL__','ms-purps':[],'dual-year':[1900,2026],'c-yearunknown':true};const f={...defaults,'ms-purps':['공동주택','업무시설'],'dual-year':[1900,1996],'c-yearunknown':false};
  assert.equal(M.groups(f,defaults).length,3);assert.ok(M.summary(f,defaults).includes('공동주택·업무시설'));
  assert.equal(M.groups({...f,'dual-year':defaults['dual-year']},defaults).length,2);
  assert.match(M.summary({...f,'c-yearunknown':true},defaults),/미확인 포함/);assert.match(M.summary(f,defaults),/연도 미확인 제외/);
});
test('semantic equality ignores ordering and inactive map filters, not changed active conditions',()=>{
  const a={mapSourceGrid:['apt','vacant'],'map-ms-vgrade':['3등급'],'map-ms-purps':['업무시설']};
  assert.equal(M.fingerprint(a),M.fingerprint({...a,mapSourceGrid:['vacant','apt'],'map-ms-purps':[]}));
  assert.notEqual(M.fingerprint(a),M.fingerprint({...a,'map-ms-vgrade':[]}));
  assert.notEqual(M.fingerprint(a),M.fingerprint({...a,mapSourceGrid:['apt','vacant','cond']}));
});
test('year presets use specified calendar year boundaries and explicitly exclude unknowns',()=>{
  const d={'dual-year':[1900,2030],'mdual-year':[1990,2030]};
  const old=M.presets('cond',2030,d).find(p=>p.id==='age30');assert.deepEqual(old.values,{'dual-year':[1900,2000],'c-yearunknown':false});assert.match(old.note,/날짜 경과·안전등급 아님/);
  const five=M.presets('demol',2030,d)[0];assert.deepEqual(five.values,{'mdual-year':[2026,2030],'m-yearunknown':false});assert.match(five.note,/올해 포함/);
});
test('presets own only declared fields and may be combined without replacing region',()=>{
  const d={'h-dual-hhld':[0,2000]},p=M.presets('housing',2026,d);const f={'h-hdong':'계림2동',...p[0].values,...p[1].values};
  assert.deepEqual(f,{'h-hdong':'계림2동','h-ms-kind':['아파트'],'h-dual-hhld':[300,2000]});
  assert.deepEqual(M.presets('vacant',2026,{})[0].values,{'vms-grade':['3등급']});assert.equal(M.presets('general',2026,{}).length,0);
});
