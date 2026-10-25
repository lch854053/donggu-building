import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const scope={};new Function('globalThis',readFileSync(new URL('../result-format.js',import.meta.url),'utf8'))(scope);const F=scope.ResultFormat;
test('display precision keeps zero distinct from missing/nonfinite/invalid counts and raw values intact',()=>{
  const raw=123.456789;assert.equal(F.scalar(raw),'123.46');assert.equal(raw,123.456789);assert.equal(F.scalar(0),'0');assert.equal(F.scalar('0','floor'),'0');assert.equal(F.scalar(null),'미확인');assert.equal(F.scalar(''),'미확인');assert.equal(F.scalar(false),'미확인');assert.equal(F.scalar(NaN),'미확인');assert.equal(F.scalar(-1),'미확인');assert.equal(F.scalar(1.5,'count'),'미확인');assert.equal(F.scalar(-1.235,'change'),'-1.24');assert.equal(F.scalar('해당 없음'),'해당 없음');
});
test('verified money units produce one representative display, with overflow and unknown units rejected',()=>{
  assert.equal(F.price(314507.575757576,'천원'),'약 3억 1,451만원');assert.equal(F.price(314507575.757576,'원'),'약 3억 1,451만원');assert.equal(F.price(0,'천원'),'0원');assert.equal(F.price(610,'천원'),'약 61만원');assert.equal(F.price(null,'원'),'미확인');assert.equal(F.price(-1,'천원'),'미확인');assert.equal(F.price(100,'지수'),'단위 확인 필요');assert.equal(F.price(Number.MAX_VALUE,'천원'),'미확인');
});
test('calendar precision and completed years do not fabricate dates or future ages',()=>{
  assert.equal(F.date('2022'),'2022년');assert.equal(F.date('202210'),'2022.10');assert.equal(F.date('20221006'),'2022.10.06');assert.equal(F.date('2022-10-06'),'2022.10.06');assert.equal(F.date('20230229'),'미확인');assert.equal(F.date('20240229'),'2024.02.29');assert.equal(F.date('00000000'),'미확인');
  assert.deepEqual(F.age('20221006',new Date(2026,9,5)),{label:'2022.10.06',age:3,approximate:false});assert.equal(F.age('20221006',new Date(2026,9,6)).age,4);assert.equal(F.age('2022',new Date(2026,9,5)).approximate,true);assert.equal(F.age('20271006',new Date(2026,9,5)).age,null);
});
test('request outcomes are different from building attributes, empty or data accuracy guarantees',()=>{
  for(const [s,key]of [['전체 조회 완료','complete'],['정상 0건','empty'],['부분 조회 · 보강 실패 있음','partial'],['전체 실패','failed'],['취소됨 · 미완료','cancelled'],['보강 중','loading']])assert.equal(F.state(s).key,key);
  assert.equal(F.state('전체 실패',{count:0}).key,'failed');assert.equal(F.state('전체 조회 완료',{count:0}).key,'empty');assert.match(F.state('전체 조회 완료').warning,/보증하지 않/);
});
test('unknown designation is not silently labelled main building and identification columns remain mandatory',()=>{
  assert.equal(F.designation({}),'주·부속 구분 미확인');assert.equal(F.designation({mainAtchGbCd:'1'}),'부속건축물');assert.equal(F.designation({mainAtchGbCdNm:'주건축물'}),'주건축물');
  for(const c of Object.values(F.columns))for(const i of c.required)assert.ok(c.basic.includes(i));
});
