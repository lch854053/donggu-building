import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stats = JSON.parse(readFileSync(new URL("../stats_donggu.json", import.meta.url), "utf8"));
const sgis = JSON.parse(readFileSync(new URL("../sgis_stats_donggu.json", import.meta.url), "utf8"));
const start = page.indexOf("function stLineChart(series, tall=false){");
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

test("stLineChart renders the KOSIS housing chart taller", () => {
  const houses = stats.indicators.find(indicator => indicator.id === "houses");
  const chart = stLineChart(houses.series, true);
  assert.match(chart, /viewBox="0 0 320 170"/);
});

test("renderSgisStats omits the duplicate housing series and zero-value types", () => {
  const sgisWithZeroType = {
    ...sgis,
    houseTypeSeries: [],
    houseSummary: [
      ...sgis.houseSummary.filter(row => row.id !== "dormSocial"),
      { id: "dormSocial", name: "기숙사·사회시설", count: 0, ratio: 0 },
    ],
  };
  const html = renderSgisStats(sgisWithZeroType);
  assert.match(html, /인구주택총조사 통계/);
  assert.match(html, /거처 유형 구성/);
  assert.match(html, /28,366가구/);
  assert.doesNotMatch(html, /<div class="st-name">주택수<\/div>/);
  assert.doesNotMatch(html, /기숙사·사회시설/);
  assert.equal((html.match(/<div class="st-type-row">/g) || []).length, 5);
  assert.equal((html.match(/<text class="pv"/g) || []).length, 0);
});

test("renderSgisStats renders housing type time series", () => {
  const houseTypeSeries = ["단독주택", "아파트"].map((name, typeIndex) => ({
    id: typeIndex === 0 ? "detached" : "apart",
    code: typeIndex === 0 ? "01" : "02",
    name,
    series: sgis.houseSeries.map((row, yearIndex) => ({
      year: row.year,
      houseCnt: 1000 + typeIndex * 500 + yearIndex * 10,
    })),
  }));
  const html = renderSgisStats({ ...sgis, houseTypeSeries });
  assert.match(html, /2024년 기준/);
  assert.match(html, /주택 유형별 시계열/);
  assert.match(html, /단독주택/);
  assert.match(html, /아파트/);
  assert.equal((html.match(/<div class="st-type-series-card">/g) || []).length, 2);
  assert.equal((html.match(/<text class="pv"/g) || []).length, houseTypeSeries.length * sgis.houseSeries.length);
});
