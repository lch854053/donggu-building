import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stats = JSON.parse(readFileSync(new URL("../sgis_stats_donggu.json", import.meta.url), "utf8"));

test("SGIS 동구 통계는 주택 시계열과 거처 유형 구성을 모두 포함한다", () => {
  assert.equal(stats.admCd, "24010");
  assert.equal(stats.summaryYear, "2024");
  assert.equal(stats.houseSeries.length, 10);
  assert.equal(stats.houseSeries[0].year, "2015");
  assert.equal(stats.houseSeries.at(-1).year, "2024");
  assert.ok(stats.houseSeries.every(row => Number.isFinite(row.houseCnt)));
  assert.equal(stats.houseTypeSeries.length, 3);
  assert.deepEqual(stats.houseTypeSeries.map(type => type.codes.join(",")), ["01", "02", "03,04"]);
  assert.ok(stats.houseTypeSeries.every(type =>
    type.series.length === 10 && type.series.every(row => Number.isFinite(row.houseCnt))
  ));
  assert.equal(stats.houseSummary.length, 6);
  assert.ok(stats.houseSummary.every(row => Number.isFinite(row.count) && Number.isFinite(row.ratio)));
  assert.equal(stats.houseSummary.reduce((sum, row) => sum + row.ratio, 0), 100);
});
