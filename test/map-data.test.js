import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const aptGeo = JSON.parse(readFileSync(new URL("../apt_geo.json", import.meta.url), "utf8"));
const aptList = JSON.parse(readFileSync(new URL("../aptlist_donggu.json", import.meta.url), "utf8"));
const aptByPnu = new Map(aptList.map(row => [row.pnu, row]));

test("map K-apt records preserve the positive household count from hoCnt", () => {
  const mismatches = [];

  for (const geo of aptGeo.filter(row => row.source === "kapt")) {
    const source = aptByPnu.get(geo.pnu);
    assert.ok(source, `missing K-apt source for ${geo.complexNm} (${geo.pnu})`);

    const expected = Number(source.bass?.hoCnt || 0) || Number(source.bass?.kaptdaCnt || 0);
    if (expected > 0 && geo.hhld !== expected) {
      mismatches.push(`${geo.complexNm}: expected ${expected}, got ${geo.hhld}`);
    }
  }

  assert.deepEqual(mismatches, []);
});
