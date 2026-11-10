import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// 철거멸실대장이 "처음엔 0건, 여러 번 조회하면 나오는" 증상의 원인:
// 상류(공공데이터포털) 지연으로 프록시가 504를 내는데 프론트가 이를 빈 결과로 삼켰다.
// 성공 응답만 엣지에 캐시되므로 재조회를 반복할수록 결과가 채워지는 것처럼 보였다.
function loadApiLayer(fetchImpl) {
  const context = vm.createContext({
    URLSearchParams, fetch: fetchImpl, setTimeout, Math, console,
  });
  vm.runInContext(readFileSync(new URL("../transform.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(new URL("../app-api.js", import.meta.url), "utf8"), context);
  return context;
}

test("apiRetry recovers from a transient upstream timeout", async () => {
  let calls = 0;
  const context = loadApiLayer(async () => {
    calls++;
    if (calls < 3) return { ok: false, status: 504, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ items: [{ platPlc: "동구 1-1" }], totalCount: 1 }) };
  });

  const result = await context.apiRetry("archpms", { op: "getApDemolExtngMgmRgstInfo" }, { retries: 3, baseDelay: 1 });
  assert.equal(calls, 3);
  assert.equal(result.ok, true);
  assert.equal(result.data.totalCount, 1);
});

test("apiRetry gives up on a permanent error without retrying", async () => {
  let calls = 0;
  const context = loadApiLayer(async () => {
    calls++;
    return { ok: false, status: 403, json: async () => ({}) };
  });

  const result = await context.apiRetry("archpms", { op: "getApDemolExtngMgmRgstInfo" }, { retries: 3, baseDelay: 1 });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("apiRetry surfaces the failure after exhausting retries", async () => {
  let calls = 0;
  const context = loadApiLayer(async () => {
    calls++;
    return { ok: false, status: 504, json: async () => ({}) };
  });

  const result = await context.apiRetry("archpms", {}, { retries: 2, baseDelay: 1 });
  assert.equal(calls, 3);
  assert.equal(result.ok, false);
  assert.equal(result.status, 504);
});

test("demolition scan retries, counts failed pages and never fakes an empty result", () => {
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const scan = page.slice(page.indexOf("async function fetchDemolDong"), page.indexOf("function hdongOfBjd"));

  // 실패를 무음 처리하지 않는다: 재시도 → error 전달 → 실패 집계 → 안내
  assert.match(scan, /apiRetry\("archpms"/);
  assert.match(scan, /failedPages\+\+/);
  assert.match(scan, /일부 조회 실패/);
  // 1페이지가 비면 잔여 페이지를 만들지 않는다(pageSize=1 헛요청 폭주 방지)
  assert.match(scan, /const pageSize = r\.items\.length;/);
  assert.doesNotMatch(scan, /Math\.max\(r\.items\.length, 1\)/);
});
