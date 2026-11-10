import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// 조건조회가 "처음엔 0건, 몇 번 더 조회하면 정상 건수"로 보이던 원인:
// 동단위 스캔이 동시 5건을 연달아 던져 상류(공공데이터포털)의 초당 요청 한도
// (LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR)와 응답 지연
// (SERVICETIMEOUT_ERROR)에 걸리면 프록시가 502/504를 내는데, 프론트가 이를 빈 결과로
// 삼켰다. 성공 응답만 엣지에 캐시되므로 재조회를 반복할수록 결과가 채워졌다.
// (2026-08 운영 로그 확인: /api/building 502 100건, 위 두 상류 오류)
const PAGE = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// index.html 의 fetchDongPage / fetchParcel 만 떼어내 샌드박스에서 평가한다.
// (두 함수는 DOM 의존이 없고 SIGUNGU·apiRetry·BUILDING_PAGE_CACHE 만 참조)
function loadFetchers(fetchImpl) {
  const src = PAGE.slice(
    PAGE.indexOf("// 동 단위 페이지 조회 (프록시)"),
    PAGE.indexOf("async function runConditionSearch()")
  );
  const context = vm.createContext({ URLSearchParams, fetch: fetchImpl, setTimeout, Math, console });
  vm.runInContext(readFileSync(new URL("../transform.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(new URL("../app-api.js", import.meta.url), "utf8"), context);
  vm.runInContext(`const BUILDING_PAGE_CACHE = new Map();\n${src}`, context);
  return context;
}

const okPage = (n) => ({
  ok: true, status: 200,
  json: async () => ({ titles: Array.from({ length: n }, (_, i) => ({ bjdongCd: "11000", bun: String(i) })), totalCount: n }),
});
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

test("동단위 페이지: 일시적 502(초당 한도)를 재시도로 복구해 빈 결과로 삼키지 않는다", async () => {
  let calls = 0;
  const ctx = loadFetchers(async () => (++calls < 3 ? fail(502) : okPage(3)));
  const r = await ctx.fetchDongPage("11000", 1);
  assert.equal(calls, 3);
  assert.ok(!r.error);
  assert.equal(r.titles.length, 3);
  assert.equal(r.totalCount, 3);
});

test("동단위 페이지: 재시도까지 실패하면 error 를 전달하고 실패를 캐시하지 않는다", async () => {
  let calls = 0;
  const ctx = loadFetchers(async () => (++calls <= 4 ? fail(504) : okPage(2)));
  const bad = await ctx.fetchDongPage("11000", 1);
  assert.ok(bad.error, "실패는 error 로 드러나야 한다(0건으로 위장 금지)");
  assert.equal(bad.titles.length, 0);
  // 실패 응답이 캐시에 남으면 다시 검색해도 계속 0건이 된다
  const good = await ctx.fetchDongPage("11000", 1);
  assert.ok(!good.error);
  assert.equal(good.titles.length, 2);
});

test("번지 단건: 재시도 후에도 실패하면 error 를 담아 돌려준다", async () => {
  let calls = 0;
  const ctx = loadFetchers(async () => (++calls < 2 ? fail(429) : okPage(1)));
  const r = await ctx.fetchParcel("11000", "0001", "0000");
  assert.ok(!r.error);
  assert.equal(r.titles.length, 1);

  const ctx2 = loadFetchers(async () => fail(502));
  const bad = await ctx2.fetchParcel("11000", "0001", "0000");
  assert.ok(bad.error);
  assert.equal(bad.titles.length, 0);
});

test("조건조회 수집 루프: 실패를 집계·안내하고 빈 1페이지로 헛요청을 만들지 않는다", () => {
  const scan = PAGE.slice(
    PAGE.indexOf("async function runConditionSearch()"),
    PAGE.indexOf("function cUpdate(done,total)")
  );
  assert.match(scan, /failedPages\+\+/);
  assert.match(scan, /일부 조회 실패/);
  // 1페이지가 비면 실측 페이지 크기가 없다 → 잔여 페이지를 만들지 않는다
  assert.match(scan, /const pageSize = r\.titles\.length;/);
  assert.doesNotMatch(scan, /Math\.max\(r\.titles\.length, 1\)/);
});
