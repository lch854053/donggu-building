import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stats = JSON.parse(readFileSync(new URL("../reb_stats_donggu.json", import.meta.url), "utf8"));
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const normalizedPage = page.replace(/\r\n/g, "\n");
const rebStart = normalizedPage.indexOf("function rebFmt(v, unit){");
const rebEnd = normalizedPage.indexOf("\nfunction renderStats", rebStart);
assert.ok(rebStart >= 0 && rebEnd > rebStart, "REB renderer source not found");
const renderRebStats = new Function(
  "stFmt", "esc",
  `${normalizedPage.slice(rebStart, rebEnd)}\nreturn renderRebStats;`
)(value => Number(value).toLocaleString("ko-KR"), value => String(value));

test("REB 동구 통계는 시장동향 지표와 시계열을 포함한다", () => {
  const ids = new Set(stats.indicators.map(indicator => indicator.id));
  assert.equal(stats.classPath, "광주>동구");
  assert.equal(stats.indicators.length, 17);
  assert.ok(ids.has("apt_sale_index"));
  assert.ok(ids.has("apt_avg_sale_price"));
  assert.ok(ids.has("apt_jeonse_ratio"));
  assert.ok(ids.has("apt_transactions"));
  assert.ok(stats.indicators.every(indicator => indicator.series.length > 0));
});

test("REB 동구 통계에는 토지 지표를 포함하지 않는다", () => {
  const tableIds = stats.indicators.map(indicator => indicator.statblId);
  assert.doesNotMatch(JSON.stringify(tableIds), /A_2024_(00532|00901|00902)/);
  assert.doesNotMatch(JSON.stringify(stats.indicators), /토지/);
});

test("통계 탭은 REB 정적 데이터와 시장동향 렌더러를 연결한다", () => {
  assert.match(page, /fetch\("\/reb_stats_donggu\.json"\)/);
  assert.match(page, /renderRebStats\(reb\)/);
  assert.match(page, /function rebLineChart\(/);
  const html = renderRebStats(stats);
  assert.match(html, /부동산 시장동향/);
  assert.match(html, /아파트 매매가격/);
  assert.match(html, /viewBox="0 0 320 126"/);
  assert.doesNotMatch(html, /토지/);
  const statsRenderer = normalizedPage.slice(
    normalizedPage.indexOf("function renderStats"),
    normalizedPage.indexOf("\nfunction renderSgisStats")
  );
  assert.ok(
    statsRenderer.indexOf("renderSgisStats(sgis)") < statsRenderer.indexOf("renderRebStats(reb)"),
    "SGIS 통계가 REB 시장동향보다 먼저 렌더링되어야 한다"
  );
});
