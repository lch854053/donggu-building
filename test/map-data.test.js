import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const aptGeo = JSON.parse(readFileSync(new URL("../apt_geo.json", import.meta.url), "utf8"));
const aptList = JSON.parse(readFileSync(new URL("../aptlist_donggu.json", import.meta.url), "utf8"));
const aptByPnu = new Map(aptList.map(row => [row.pnu, row]));
const vacantGeo = JSON.parse(readFileSync(new URL("../vacant_geo.json", import.meta.url), "utf8"));

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

test("vacant map data keeps VWorld parcel geometry instead of raw-coordinate fallbacks", () => {
  const withPnu = vacantGeo.filter(row => row.pnu).length;
  assert.ok(withPnu >= vacantGeo.length * 0.5, `only ${withPnu}/${vacantGeo.length} vacant records have a PNU`);

  const gungdong = vacantGeo.find(row => row.jibun?.includes("궁동38-16"));
  assert.equal(gungdong?.pnu, "1221010600100380016");

  const ring = gungdong.geometry.coordinates[0][0];
  const center = ring.reduce((sum, [lon, lat]) => [sum[0] + lon, sum[1] + lat], [0, 0]).map(v => v / ring.length);
  assert.ok(center[0] > 126.919 && center[0] < 126.92, `unexpected longitude: ${center[0]}`);
  assert.ok(center[1] > 35.149 && center[1] < 35.151, `unexpected latitude: ${center[1]}`);
});
