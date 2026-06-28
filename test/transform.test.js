// test/transform.test.js
// transform.js 순수 함수 단위 테스트.
// 외부 API/DOM 의존 없이 입력→출력을 검증한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTransform } from "./_loader.js";

const f = loadTransform();

/* ============================================================
   jusoToBldCandidates — 단일 juso 결과 → 건축HUB 파라미터 후보
   ============================================================ */
test("jusoToBldCandidates: bdMgtSn과 lnbr가 같으면 1개 후보(중복 제거)", () => {
  // 운림길 57-12: bdMgtSn(19자리), lnbr 모두 558-2
  const j = {
    admCd: "2911012100", bdMgtSn: "2911012100005580002",
    mtYn: "0", lnbrMnnm: 558, lnbrSlno: 2,
  };
  const out = f.jusoToBldCandidates(j);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0],
    { sigunguCd: "29110", bjdongCd: "12100", platGbCd: "0", bun: "0558", ji: "0002" });
});

test("jusoToBldCandidates: bdMgtSn과 lnbr가 다르면 2개 후보(A 먼저, B 나중)", () => {
  // 중흥로 223: bdMgtSn → 576-16, lnbr → 576-16 (같음). 대신 다른 사례 인위 구성
  const j = {
    admCd: "2911010900",
    bdMgtSn: "2911010900105760016018174",   // bun=0576 ji=0016
    mtYn: "0", lnbrMnnm: 576, lnbrSlno: 13, // candB: 0576-0013
  };
  const out = f.jusoToBldCandidates(j);
  assert.equal(out.length, 2);
  assert.equal(out[0].bun + "-" + out[0].ji, "0576-0016"); // candA 먼저
  assert.equal(out[1].bun + "-" + out[1].ji, "0576-0013"); // candB 나중
});

test("jusoToBldCandidates: 동구 외(admCd 기준)는 빈 배열", () => {
  // admCd(주소의 법정동)가 대전(30110)이면 candA·candB 모두 거부
  const j = { admCd: "3011010900", bdMgtSn: "3011010900105760016", lnbrMnnm: 576, lnbrSlno: 16 };
  assert.deepEqual(f.jusoToBldCandidates(j), []);
});

test("jusoToBldCandidates: bdMgtSn 없으면 candB(lnbr)만", () => {
  const j = { admCd: "2911010900", mtYn: "0", lnbrMnnm: 100, lnbrSlno: 5 };
  const out = f.jusoToBldCandidates(j);
  assert.equal(out.length, 1);
  assert.equal(out[0].bun + "-" + out[0].ji, "0100-0005");
});

test("jusoToBldCandidates: 산(mtYn=1)은 platGbCd=1", () => {
  const j = { admCd: "2911010900", mtYn: "1", lnbrMnnm: 10, lnbrSlno: 0 };
  const out = f.jusoToBldCandidates(j);
  assert.equal(out[0].platGbCd, "1");
});

/* ============================================================
   jusoToBldGroup — 같은 건물군 필지 묶기 (부속지번 대응)
   ============================================================ */
test("jusoToBldGroup: 같은 도로명+본번+법정동은 모두 후보 (중흥로 223)", () => {
  // 중흥로 223 검색 → 223(576-16), 223-1(576-13) 함께 반환
  const jusoList = [
    { rn: "중흥로", buldMnnm: "223", buldSlno: "0", emdNm: "계림동", admCd: "2911010900", bdMgtSn: "2911010900105760016018174", mtYn: "0", lnbrMnnm: 576, lnbrSlno: 16 },
    { rn: "중흥로", buldMnnm: "223", buldSlno: "1", emdNm: "계림동", admCd: "2911010900", bdMgtSn: "2911010900105760013018172", mtYn: "0", lnbrMnnm: 576, lnbrSlno: 13 },
  ];
  const out = f.jusoToBldGroup(jusoList);
  assert.equal(out.length, 2);
  const jis = out.map(p => p.bun + "-" + p.ji).sort();
  assert.deepEqual(jis, ["0576-0013", "0576-0016"]);
});

test("jusoToBldGroup: 다른 도로명(건물군)은 제외", () => {
  const jusoList = [
    { rn: "중흥로", buldMnnm: "223", buldSlno: "0", emdNm: "계림동", admCd: "2911010900", bdMgtSn: "2911010900105760016018174", mtYn: "0", lnbrMnnm: 576, lnbrSlno: 16 },
    { rn: "무등로", buldMnnm: "100", buldSlno: "0", emdNm: "계림동", admCd: "2911010900", bdMgtSn: "2911010900109990010000000", mtYn: "0", lnbrMnnm: 999, lnbrSlno: 10 },
  ];
  const out = f.jusoToBldGroup(jusoList);
  assert.equal(out.length, 1);
  assert.equal(out[0].bun + "-" + out[0].ji, "0576-0016");
});

test("jusoToBldGroup: 빈 입력은 빈 배열", () => {
  assert.deepEqual(f.jusoToBldGroup([]), []);
  assert.deepEqual(f.jusoToBldGroup(null), []);
});

/* ============================================================
   pickTop — 입력 건물번호에 맞는 juso 결과를 top으로 보정
   (증심사길 85 검색 시 juso [0]=81 문제 대응)
   ============================================================ */
test("pickTop: 입력 본번이 [0]과 다르면 일치 항목을 [0]으로 (증심사길 85)", () => {
  // juso가 81을 먼저 반환한 경우 → 85를 [0]으로 끌어올림
  const cands = [
    { rn:"증심사길", buldMnnm:"81", buldSlno:"0", emdNm:"운림동" },
    { rn:"증심사길", buldMnnm:"85", buldSlno:"0", emdNm:"운림동" },
  ];
  const out = f.pickTop("증심사길 85", cands);
  assert.equal(out[0].buldMnnm, "85");
  assert.equal(out.length, cands.length);   // 원소 유지, 순서만
});

test("pickTop: 이미 [0]이 입력 본번과 같으면 순서 유지", () => {
  const cands = [
    { rn:"운림길", buldMnnm:"57", buldSlno:"16", emdNm:"운림동" },
    { rn:"운림길", buldMnnm:"59", buldSlno:"0", emdNm:"운림동" },
  ];
  const out = f.pickTop("운림길 57-16", cands);
  assert.deepEqual(out, cands);             // 변경 없음
});

test("pickTop: 동 번호 입력이면 보정 금지 (무등로 108동)", () => {
  // '108'은 동번호이므로 도로명 본번으로 오인하지 않는다
  const cands = [
    { rn:"무등로", buldMnnm:"110", buldSlno:"0", emdNm:"계림동" },
    { rn:"무등로", buldMnnm:"108", buldSlno:"0", emdNm:"계림동" },
  ];
  const out = f.pickTop("무등로 108동", cands);
  assert.deepEqual(out, cands);             // 원 순서 유지
});

test("pickTop: 지번주소(번지)는 보정 금지 (계림동 521-58번지)", () => {
  // 도로명+본번 형태가 아니므로 보정하지 않는다
  const cands = [
    { rn:"", buldMnnm:"", emdNm:"계림동", lnbrMnnm:521, lnbrSlno:58 },
  ];
  const out = f.pickTop("계림동 521-58번지", cands);
  assert.deepEqual(out, cands);
});

test("pickTop: 다필지 부번 입력은 본번 기준이라 유실 없음 (중흥로 223-1)", () => {
  // 223/223-1 은 같은 본번 → top이 223이면 그대로. jusoToBldGroup은 본번 기준이라
  // 둘 다 후보로 남는다(아래 통합 테스트에서 검증).
  const cands = [
    { rn:"중흥로", buldMnnm:"223", buldSlno:"0", emdNm:"계림동" },
    { rn:"중흥로", buldMnnm:"223", buldSlno:"1", emdNm:"계림동" },
  ];
  const out = f.pickTop("중흥로 223-1", cands);
  assert.equal(out[0].buldMnnm, "223");     // 본번 같으므로 [0] 유지
  assert.equal(out.length, 2);
});

test("pickTop: 다른 도로명(rn)은 무시 (중앙로 254)", () => {
  const cands = [
    { rn:"중앙로", buldMnnm:"250", buldSlno:"0", emdNm:"충장동" },
    { rn:"중앙로", buldMnnm:"254", buldSlno:"0", emdNm:"충장동" },
    { rn:"무등로", buldMnnm:"254", buldSlno:"0", emdNm:"계림동" },  // 다른 도로명
  ];
  const out = f.pickTop("중앙로 254", cands);
  assert.equal(out[0].buldMnnm, "254");
  assert.equal(out[0].rn, "중앙로");        // 무등로 254가 아닌 중앙로 254
});

test("pickTop: 일치 항목 없으면 원 순서 유지", () => {
  const cands = [
    { rn:"증심사길", buldMnnm:"81", buldSlno:"0", emdNm:"운림동" },
    { rn:"증심사길", buldMnnm:"83", buldSlno:"0", emdNm:"운림동" },
  ];
  // 85번 결과가 아예 없으면 85를 강제로 만들지 않고 원 순서 유지
  const out = f.pickTop("증심사길 85", cands);
  assert.deepEqual(out, cands);
});

test("pickTop: 빈/_null 입력은 빈 배열", () => {
  assert.deepEqual(f.pickTop("아무거나", []), []);
  assert.deepEqual(f.pickTop("아무거나", null), []);
});

// pickTop → jusoToBldGroup 통합: 보정된 top 기준으로 후보가 모이는지
test("통합: pickTop + jusoToBldGroup 으로 증심사길 85 후보 보존", () => {
  // lnbr 기반(candB)만 사용 — bdMgtSn은 두면 번지 구조가 복잡해지므로 제외.
  // admCd=2911025500(동구 운림동 계통), lnbr 85→bun 0085
  const cands = [
    { rn:"증심사길", buldMnnm:"81", buldSlno:"0", emdNm:"운림동",
      admCd:"2911025500", mtYn:"0", lnbrMnnm:81, lnbrSlno:0 },
    { rn:"증심사길", buldMnnm:"85", buldSlno:"0", emdNm:"운림동",
      admCd:"2911025500", mtYn:"0", lnbrMnnm:85, lnbrSlno:0 },
  ];
  // 보정 없이 cands 그대로 → 81 건물군만 후보 (85 배제 = 버그)
  const before = f.jusoToBldGroup(cands);
  assert.ok(!before.some(p => p.bun.endsWith("85")), "보정 전엔 85 후보가 없어야");
  // pickTop 적용 후 → 85 건물군 후보 등장
  const after = f.jusoToBldGroup(f.pickTop("증심사길 85", cands));
  assert.ok(after.some(p => p.bun.endsWith("85")), "보정 후엔 85 후보가 있어야");
});

/* ============================================================
   roadMatches — juso 도로명번호 ↔ 대장 newPlatPlc 일치 (bdMgtSn 오매핑 방지)
   ============================================================ */
test("roadMatches: 일치하면 true (운림길 57-16 정답)", () => {
  const j = { buldMnnm: "57", buldSlno: "16" };
  const t = { newPlatPlc: "광주광역시 동구 운림길 57-16 (운림동)" };
  assert.equal(f.roadMatches(j, t), true);
});

test("roadMatches: 불일치하면 false (운림길 57-16 ↔ 57-12 오매핑)", () => {
  const j = { buldMnnm: "57", buldSlno: "16" };
  const t = { newPlatPlc: "광주광역시 동구 운림길 57-12 (운림동)" };
  assert.equal(f.roadMatches(j, t), false);
});

test("roadMatches: buldMnnm 없으면 true(검사 생략, 무해)", () => {
  assert.equal(f.roadMatches({}, { newPlatPlc: "아무거나" }), true);
});

test("roadMatches: 부번 0은 생략 가능 ('223' ↔ '223-0')", () => {
  const j = { buldMnnm: "223", buldSlno: "0" };
  const t = { newPlatPlc: "광주광역시 동구 중흥로 223 (계림동)" };
  assert.equal(f.roadMatches(j, t), true);
});

/* ============================================================
   toPNU / hdongOf — PNU 생성, 행정동 조회
   ============================================================ */
test("toPNU: 대지(platGbCd=0) → san=1", () => {
  const p = { sigunguCd: "29110", bjdongCd: "10900", platGbCd: "0", bun: "576", ji: "13" };
  assert.equal(f.toPNU(p), "2911010900105760013");
});

test("toPNU: 산(platGbCd=1) → san=2", () => {
  const p = { sigunguCd: "29110", bjdongCd: "12100", platGbCd: "1", bun: "143", ji: "1" };
  assert.equal(f.toPNU(p), "2911012100201430001");
});

test("hdongOf: 매핑 존재 → 행정동명", () => {
  const HJ = { jibun2hdong: { "1090005760013": "계림1동" } };
  assert.equal(f.hdongOf({ bjdongCd: "10900", bun: "0576", ji: "0013" }, HJ), "계림1동");
});

test("hdongOf: 매핑 없음 → 빈 문자열", () => {
  const HJ = { jibun2hdong: {} };
  assert.equal(f.hdongOf({ bjdongCd: "10900", bun: "9999", ji: "9999" }, HJ), "");
});

test("hdongOf: null/빈 HJ → 빈 문자열", () => {
  assert.equal(f.hdongOf(null, { jibun2hdong: {} }), "");
  assert.equal(f.hdongOf({ bjdongCd: "10900", bun: "576", ji: "13" }, null), "");
});

/* ============================================================
   geomAreaM2 / geomContainsPoint — 필지 geometry (지도 필터용)
   ============================================================ */
test("geomAreaM2: 단위는 ㎡, 작은 사각형은 합리적 범위", () => {
  // 약 90m × 100m 사각형 (위경도 근사 — 위도 35°에선 경도 1°가 약 91km로 압축됨)
  const geom = { type: "Polygon", coordinates: [[
    [126.9693, 35.1283], [126.9704, 35.1283], [126.9704, 35.1292], [126.9693, 35.1292], [126.9693, 35.1283],
  ]]};
  const area = f.geomAreaM2(geom);
  assert.ok(area > 7000 && area < 10000, `예상 7천~1만㎡, 실제 ${area}`);
});

test("geomAreaM2: 거대 산림(증심사 산143-1)은 10만㎡ 초과", () => {
  // 산143-1 bbox 약 1209m×963m → 수십만㎡. 간략 사각형으로 차수 검증
  const geom = { type: "Polygon", coordinates: [[
    [126.960, 35.125], [126.974, 35.125], [126.974, 35.134], [126.960, 35.134], [126.960, 35.125],
  ]]};
  assert.ok(f.geomAreaM2(geom) > 100000, "산림 필지는 10만㎡ 초과여야");
});

test("geomContainsPoint: 점이 폴리곤 안에 있으면 true", () => {
  const geom = { type: "Polygon", coordinates: [[
    [0,0],[10,0],[10,10],[0,10],[0,0],
  ]]};
  assert.equal(f.geomContainsPoint(geom, 5, 5), true);
  assert.equal(f.geomContainsPoint(geom, 15, 5), false); // 밖
});

test("geomContainsPoint: 거대 산림은 건물 좌표를 실제로 포함하지 않음", () => {
  // 증심사 산143-1은 건물 좌표(126.9696, 35.1288)를 bbox로 덮지만 폴리곤엔 미포함
  // (실제 데이터 기반 회귀는 scenario.test.js에서, 여기선 원리만)
  const geom = { type: "Polygon", coordinates: [[
    [126.965, 35.130],[126.973, 35.130],[126.973, 35.133],[126.965, 35.133],[126.965, 35.130],
  ]]};
  // 건물 좌표는 이 폴리곤(남쪽 높은 lat 영역) 밖
  assert.equal(f.geomContainsPoint(geom, 126.9696, 35.1288), false);
});

/* ============================================================
   문자열/포맷 유틸
   ============================================================ */
test("extractDong: '108동' → 108, '제108동' → 108, '108-1동' → 108", () => {
  assert.equal(f.extractDong("무등로 108동"), "108");
  assert.equal(f.extractDong("제108동"), "108");
  assert.equal(f.extractDong("108-1동"), "108");
  assert.equal(f.extractDong("번지 108"), null); // '동' 없음
});

test("cleanForSearch: 상세주소 제거 + 동구 보강", () => {
  // 시도/구 없으면 '광주광역시 동구' 보강 (동구 전용 도구)
  assert.equal(f.cleanForSearch("무등로307번길 4, 1층 신부헤어샵"), "광주광역시 동구 무등로307번길 4");
  assert.equal(f.cleanForSearch("계림동 521-58번지, 2층"), "광주광역시 동구 계림동 521-58");
  // 시도/구 없으면 '광주광역시 동구' 보강
  assert.equal(f.cleanForSearch("중앙로 254"), "광주광역시 동구 중앙로 254");
});

test("stripParens: 괄호 묶음 제거", () => {
  assert.equal(f.stripParens("계림동 521-58 (윤지애)"), "계림동 521-58");
  assert.equal(f.stripParens("무등로384번길 15 (계림동)"), "무등로384번길 15");
});

test("esc: HTML 특수문자 이스케이프", () => {
  assert.equal(f.esc("<b>\"x\"&'y'</b>"), "&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;");
  assert.equal(f.esc(null), "");
});

test("extractYear: 날짜에서 연도 추출", () => {
  assert.equal(f.extractYear("20150911"), 2015);
  assert.equal(f.extractYear("2015"), 2015);
  assert.equal(f.extractYear("-"), null);
  assert.equal(f.extractYear(""), null);
});

test("dongMatch: 숫자 동 표기차 흡수", () => {
  assert.equal(f.dongMatch("108동", "108"), true);
  assert.equal(f.dongMatch("제108동", "108"), true);
  assert.equal(f.dongMatch("108동", "109동"), false);
});

test("mergeBuilding: 표제부 정규화 + 총주차 합산 폴백", () => {
  // totPkngCnt 있으면 그대로
  assert.equal(f.mergeBuilding({ totPkngCnt: 10 }).totPkng, 10);
  // 없으면 4개 항목 합산
  const t = f.mergeBuilding({indrAutoUtcnt:2, oudrAutoUtcnt:3, indrMechUtcnt:1, oudrMechUtcnt:4});
  assert.equal(t.totPkng, 10);
});

test("dedupeBy: 키 기준 중복 제거, 순서 유지", () => {
  const out = f.dedupeBy([1,2,2,3,1], x=>x);
  assert.deepEqual(out, [1,2,3]);
});
