import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stats = JSON.parse(readFileSync(new URL("../stats_donggu.json", import.meta.url), "utf8"));
const sgis = JSON.parse(readFileSync(new URL("../sgis_stats_donggu.json", import.meta.url), "utf8"));
const start = page.indexOf("function stLineChart(series){");
const end = page.indexOf("\n}\n\nfunction renderStats", start) + 2;
assert.ok(start >= 0 && end > start, "stLineChart source not found");

const stLineChart = new Function(
  "stFmt", "esc",
  `${page.slice(start, end)}\nreturn stLineChart;`
)(value => String(value), value => String(value));

const sgisStart = page.indexOf("function renderSgisStats(d){");
const sgisEnd = page.indexOf("\n}\n\n\n/*", sgisStart) + 2;
assert.ok(sgisStart >= 0 && sgisEnd > sgisStart, "renderSgisStats source not found");
const renderSgisStats = new Function(
  "fmt", "stFmt", "esc", "stLineChart",
  `${page.slice(sgisStart, sgisEnd)}\nreturn renderSgisStats;`
)(value => Number(value).toLocaleString("ko-KR"), value => String(value), value => String(value), stLineChart);

test("stLineChart renders a value label for every available year", () => {
  for (const indicator of stats.indicators) {
    const series = indicator.series;
    const expected = series.filter(row => row.donggu != null).length;
    const chart = stLineChart(series);
    const actual = (chart.match(/<text class="pv"/g) || []).length;
    assert.equal(actual, expected, indicator.id);
  }
});

test("renderSgisStats renders housing series and dwelling composition", () => {
  const html = renderSgisStats(sgis);
  assert.match(html, /인구주택총조사 통계/);
  assert.match(html, /거처 유형 구성/);
  assert.match(html, /28,366가구/);
  assert.equal((html.match(/<text class="pv"/g) || []).length, sgis.houseSeries.length);
});
