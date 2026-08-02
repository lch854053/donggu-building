import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stats = JSON.parse(readFileSync(new URL("../stats_donggu.json", import.meta.url), "utf8"));
const start = page.indexOf("function stLineChart(series){");
const end = page.indexOf("\n}\n\nfunction renderStats", start) + 2;
assert.ok(start >= 0 && end > start, "stLineChart source not found");

const stLineChart = new Function(
  "stFmt", "esc",
  `${page.slice(start, end)}\nreturn stLineChart;`
)(value => String(value), value => String(value));

test("stLineChart renders a value label for every available year", () => {
  for (const indicator of stats.indicators) {
    const series = indicator.series;
    const expected = series.filter(row => row.donggu != null).length;
    const chart = stLineChart(series);
    const actual = (chart.match(/<text class="pv"/g) || []).length;
    assert.equal(actual, expected, indicator.id);
  }
});
