import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  boundsIntersect,
  geometryBounds,
  normalizeFeature,
  normalizeGeometry,
  partitionFeatures,
  ringsToGeometry,
  splitBounds,
} from "../scripts/collect-building-footprints.mjs";

const polygon = coordinates => ({ type: "Polygon", coordinates: [coordinates] });

test("footprint geometry normalization closes rings and rounds coordinates", () => {
  const geometry = normalizeGeometry(polygon([
    [126.91234567, 35.15123456],
    [126.913, 35.151],
    [126.913, 35.152],
  ]));
  assert.deepEqual(geometry.coordinates[0][0], [126.912346, 35.151235]);
  assert.deepEqual(geometry.coordinates[0].at(-1), geometry.coordinates[0][0]);
});

test("footprint normalization rejects non-polygon and out-of-district geometry", () => {
  assert.equal(normalizeFeature({ geometry: { type: "Point", coordinates: [126.92, 35.15] } }), null);
  assert.equal(normalizeFeature({ geometry: polygon([[127, 36], [127.1, 36], [127.1, 36.1], [127, 36]]) }), null);
  assert.ok(normalizeFeature({ geometry: polygon([[126.982, 35.13], [126.983, 35.13], [126.983, 35.131], [126.982, 35.13]]) }));
});

test("footprint feature keeps only stable map properties", () => {
  const feature = normalizeFeature({
    properties: { gis_idntfc_no: "building-1", pnu: "1221010100100010001", buld_nm: "비공개 속성" },
    geometry: polygon([[126.91, 35.15], [126.911, 35.15], [126.911, 35.151], [126.91, 35.15]]),
  });
  assert.equal(feature.id, "building-1");
  assert.deepEqual(feature.properties, { id: "building-1", pnu: "1221010100100010001" });
  assert.deepEqual(geometryBounds(feature.geometry), [126.91, 35.15, 126.911, 35.151]);
});

test("BBOX splitting covers four quadrants and intersection includes touching edges", () => {
  const parts = splitBounds([0, 0, 2, 2]);
  assert.deepEqual(parts, [[0, 0, 1, 1], [1, 0, 2, 1], [0, 1, 1, 2], [1, 1, 2, 2]]);
  assert.equal(boundsIntersect(parts[0], parts[3]), true);
  assert.equal(boundsIntersect(parts[0], [1.1, 1.1, 2, 2]), false);
});

test("shapefile rings are grouped into multipolygons with holes", () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[2, 2], [2, 4], [4, 4], [4, 2], [2, 2]];
  const separate = [[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]];
  const geometry = ringsToGeometry([hole, separate, outer]);
  assert.equal(geometry.type, "MultiPolygon");
  assert.equal(geometry.coordinates.length, 2);
  assert.equal(geometry.coordinates[0].length, 2);
});

test("features are deterministically partitioned into viewport cells", () => {
  const features = [
    normalizeFeature({ properties: { gis_idntfc_no: "a" }, geometry: polygon([[126.89, 35.07], [126.891, 35.07], [126.891, 35.071], [126.89, 35.07]]) }),
    normalizeFeature({ properties: { gis_idntfc_no: "b" }, geometry: polygon([[126.92, 35.15], [126.921, 35.15], [126.921, 35.151], [126.92, 35.15]]) }),
  ];
  const cells = partitionFeatures(features);
  assert.equal(cells.length, 2);
  assert.deepEqual(cells.map(cell => cell.features.length), [1, 1]);
  assert.deepEqual(cells.map(cell => cell.id), [...cells.map(cell => cell.id)].sort());
});

test("generated Figure-Ground dataset is internally consistent when present", () => {
  const manifestUrl = new URL("../data/figure-ground/manifest.json", import.meta.url);
  if (!existsSync(manifestUrl)) return;
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.featureCount >= 1000);
  assert.ok(Array.isArray(manifest.cells) && manifest.cells.length > 0);
  assert.equal(manifest.cells.reduce((sum, cell) => sum + cell.count, 0), manifest.featureCount);
  const ids = new Set();
  for (const cell of manifest.cells) {
    const collection = JSON.parse(readFileSync(new URL(`../data/figure-ground/${cell.file}`, import.meta.url), "utf8"));
    assert.equal(collection.type, "FeatureCollection");
    assert.equal(collection.features.length, cell.count);
    assert.ok(collection.features.every(feature => ["Polygon", "MultiPolygon"].includes(feature.geometry?.type)));
    for (const feature of collection.features) {
      assert.ok(!ids.has(feature.id), `duplicate building id: ${feature.id}`);
      ids.add(feature.id);
      assert.match(feature.properties.pnu, /^(12210|29110)\d{14}$/);
    }
  }
  assert.equal(ids.size, manifest.featureCount);
});

test("map page exposes a lazy-loaded Figure-Ground subtab", () => {
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(page, /data-map-sub="figure"/);
  assert.match(page, /figureGroundMap/);
  assert.match(page, /figure-ground\/manifest\.json/);
  assert.match(page, /L\.canvas\(/);
  assert.match(page, /loadFigureGroundViewport/);
  assert.match(page, /manifest\.sourceDate/);
  assert.match(page, /saveFigureGroundPng/);
  assert.match(page, /toBlob\(resolve, "image\/png"/);
  assert.match(page, /투명 PNG 저장/);
  assert.doesNotMatch(page, /output\.toBlob\(resolve, "image\/jpeg"/);
  assert.doesNotMatch(page, />전체 건물</);
  assert.doesNotMatch(page, />화면 표시</);
  assert.doesNotMatch(page, />데이터 기준</);
  assert.doesNotMatch(page, />동구 중심으로</);
});
