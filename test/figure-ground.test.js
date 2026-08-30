import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  approvalYear,
  buildingFloors,
  boundsIntersect,
  FIGURE_GROUND_PURPOSES,
  floorAreaRatio,
  figureGroundPurpose,
  geometryBounds,
  mergeRegistryFootprints,
  mergeRoadApartmentFootprints,
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

test("footprint normalization reads a building purpose code from source properties", () => {
  const feature = normalizeFeature({
    properties: { gis_idntfc_no: "purpose-coded", pnu: "1221010100100010001", USABILITY: "04000" },
    geometry: polygon([[126.91, 35.15], [126.911, 35.15], [126.911, 35.151], [126.91, 35.15]]),
  });
  assert.equal(feature.properties.purpose, "제2종 근린생활시설");
});

test("footprint approval year accepts official dates and rejects implausible values", () => {
  assert.equal(approvalYear("2022-10-06"), 2022);
  assert.equal(approvalYear("19730706"), 1973);
  assert.equal(approvalYear(""), null);
  assert.equal(approvalYear("2028"), null);
  const feature = normalizeFeature({
    properties: { gis_idntfc_no: "dated", pnu: "1221010100100010001", useAprDay: "20060522" },
    geometry: polygon([[126.91, 35.15], [126.911, 35.15], [126.911, 35.151], [126.91, 35.15]]),
  });
  assert.equal(feature.properties.year, 2006);
});

test("footprint floor-area ratio keeps positive registry values and treats zero as unknown", () => {
  assert.equal(floorAreaRatio("515.928400000"), 515.9284);
  assert.equal(floorAreaRatio("1,250.5"), 1250.5);
  assert.equal(floorAreaRatio("0"), null);
  assert.equal(floorAreaRatio("-1"), null);
  assert.equal(floorAreaRatio(""), null);
  const feature = normalizeFeature({
    properties: { gis_idntfc_no: "far-coded", pnu: "1221010100100010001", far: "245.678" },
    geometry: polygon([[126.91, 35.15], [126.911, 35.15], [126.911, 35.151], [126.91, 35.15]]),
  });
  assert.equal(feature.properties.far, 245.678);
});

test("footprint ground-floor count keeps positive integers and treats zero as unknown", () => {
  assert.equal(buildingFloors("12"), 12);
  assert.equal(buildingFloors("2.0"), 2);
  assert.equal(buildingFloors("0"), null);
  assert.equal(buildingFloors("-1"), null);
  assert.equal(buildingFloors(""), null);
  const feature = normalizeFeature({
    properties: { gis_idntfc_no: "floors-coded", pnu: "1221010100100010001", floors: "5" },
    geometry: polygon([[126.91, 35.15], [126.911, 35.15], [126.911, 35.151], [126.91, 35.15]]),
  });
  assert.equal(feature.properties.floors, 5);
});

test("footprint purpose keeps the five common categories and folds the rest into 기타", () => {
  assert.equal(figureGroundPurpose("01000"), "단독주택");
  assert.equal(figureGroundPurpose("02000"), "공동주택");
  assert.equal(figureGroundPurpose("03000"), "제1종 근린생활시설");
  assert.equal(figureGroundPurpose("4000"), "제2종 근린생활시설");
  assert.equal(figureGroundPurpose("15000"), "숙박시설");
  assert.equal(figureGroundPurpose("교육연구시설"), "기타");
  assert.equal(figureGroundPurpose(""), "기타");
  assert.ok(FIGURE_GROUND_PURPOSES.includes("기타"));
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

test("road-address footprints replace stale buildings only for missing apartment PNUs", () => {
  const stale = normalizeFeature({
    properties: { gis_idntfc_no: "stale", pnu: "1221010900113400000" },
    geometry: polygon([[126.924, 35.16], [126.925, 35.16], [126.925, 35.161], [126.924, 35.16]]),
  });
  const retained = normalizeFeature({
    properties: { gis_idntfc_no: "retained", pnu: "1221011000100010000" },
    geometry: polygon([[126.94, 35.17], [126.941, 35.17], [126.941, 35.171], [126.94, 35.17]]),
  });
  const currentApartment = normalizeFeature({
    properties: { gis_idntfc_no: "current", pnu: "1221011000100020000" },
    geometry: polygon([[126.95, 35.17], [126.951, 35.17], [126.951, 35.171], [126.95, 35.17]]),
  });
  const replacement = normalizeFeature({
    properties: { gis_idntfc_no: "road:new", pnu: "1221010900118690000" },
    geometry: polygon([[126.9242, 35.1602], [126.9248, 35.1602], [126.9248, 35.1608], [126.9242, 35.1602]]),
  });
  const ignored = normalizeFeature({
    properties: { gis_idntfc_no: "road:existing", pnu: "1221011000100020000" },
    geometry: polygon([[126.9502, 35.1702], [126.9508, 35.1702], [126.9508, 35.1708], [126.9502, 35.1702]]),
  });
  const apartments = [
    { pnu: "2911010900118690000", useAprDay: "20221006", geometry: polygon([[126.923, 35.159], [126.926, 35.159], [126.926, 35.162], [126.923, 35.162], [126.923, 35.159]]) },
    { pnu: "2911011000100020000", geometry: polygon([[126.949, 35.169], [126.952, 35.169], [126.952, 35.172], [126.949, 35.172], [126.949, 35.169]]) },
  ];
  const merged = mergeRoadApartmentFootprints([stale, retained, currentApartment], [replacement, ignored], apartments);
  assert.equal(merged.replacementCount, 1);
  assert.equal(merged.removedCount, 1);
  assert.equal(merged.addedCount, 1);
  assert.deepEqual(merged.features.map(feature => feature.id).sort(), ["current", "retained", "road:new"]);
  assert.equal(merged.features.find(feature => feature.id === "road:new").properties.year, 2022);
  assert.equal(merged.features.find(feature => feature.id === "road:new").properties.purpose, "공동주택");
  const repeated = mergeRoadApartmentFootprints(merged.features, [replacement, ignored], apartments);
  assert.deepEqual(repeated.features, merged.features);
});

test("registry footprints add only unseen GIS IDs", () => {
  const current = [{ id: "existing", properties: { id: "existing" } }];
  const registry = [
    { id: "missing", properties: { id: "missing", source: "registry" } },
    { id: "existing", properties: { id: "existing", source: "registry" } },
  ];
  const merged = mergeRegistryFootprints(current, registry);
  assert.equal(merged.addedCount, 1);
  assert.equal(merged.skippedCount, 1);
  assert.deepEqual(merged.features.map(feature => feature.id), ["existing", "missing"]);
  assert.equal(merged.features.find(feature => feature.id === "missing").properties.source, "registry");
});

test("generated Figure-Ground dataset is internally consistent when present", () => {
  const manifestUrl = new URL("../data/figure-ground/manifest.json", import.meta.url);
  if (!existsSync(manifestUrl)) return;
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  assert.ok(manifest.featureCount >= 1000);
  assert.ok(Array.isArray(manifest.cells) && manifest.cells.length > 0);
  assert.equal(manifest.cells.reduce((sum, cell) => sum + cell.count, 0), manifest.featureCount);
  assert.equal(manifest.ageKnownCount + manifest.ageUnknownCount, manifest.featureCount);
  assert.equal(Object.values(manifest.purposeCounts).reduce((sum, count) => sum + count, 0), manifest.featureCount);
  assert.equal(typeof manifest.registrySupplementCount, "number");
  assert.equal(typeof manifest.farKnownCount, "number");
  assert.equal(typeof manifest.farUnknownCount, "number");
  assert.equal(typeof manifest.floorKnownCount, "number");
  assert.equal(typeof manifest.floorUnknownCount, "number");
  assert.ok(manifest.ageKnownCount / manifest.featureCount >= 0.6);
  const ids = new Set();
  let registryCount = 0;
  let farCount = 0;
  let floorCount = 0;
  for (const cell of manifest.cells) {
    const collection = JSON.parse(readFileSync(new URL(`../data/figure-ground/${cell.file}`, import.meta.url), "utf8"));
    assert.equal(collection.type, "FeatureCollection");
    assert.equal(collection.features.length, cell.count);
    assert.ok(collection.features.every(feature => ["Polygon", "MultiPolygon"].includes(feature.geometry?.type)));
    for (const feature of collection.features) {
      assert.ok(!ids.has(feature.id), `duplicate building id: ${feature.id}`);
      ids.add(feature.id);
      assert.match(feature.properties.pnu, /^(12210|29110)\d{14}$/);
      assert.ok(FIGURE_GROUND_PURPOSES.includes(feature.properties.purpose));
      if (feature.properties.source === "registry") registryCount++;
      if (feature.properties.far !== undefined) {
        farCount++;
        assert.equal(floorAreaRatio(feature.properties.far), feature.properties.far);
      }
      if (feature.properties.floors !== undefined) {
        floorCount++;
        assert.equal(buildingFloors(feature.properties.floors), feature.properties.floors);
      }
      if (feature.properties.year !== undefined) assert.equal(approvalYear(feature.properties.year), feature.properties.year);
    }
  }
  assert.equal(ids.size, manifest.featureCount);
  assert.equal(registryCount, manifest.registrySupplementCount);
  assert.equal(farCount, manifest.farKnownCount);
  assert.equal(farCount + manifest.farUnknownCount, manifest.featureCount);
  assert.equal(floorCount, manifest.floorKnownCount);
  assert.equal(floorCount + manifest.floorUnknownCount, manifest.featureCount);
});

test("map page exposes a lazy-loaded Figure-Ground subtab", () => {
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(page, /data-map-sub="figure"/);
  assert.match(page, />건물윤곽지도</);
  assert.doesNotMatch(page, />테마지도 조회</);
  assert.match(page, /figureGroundMap/);
  assert.match(page, /figure-ground\/manifest\.json/);
  assert.match(page, /L\.canvas\(/);
  assert.match(page, /loadFigureGroundViewport/);
  assert.match(page, /manifest\.sourceDate/);
  assert.match(page, /saveFigureGroundPng/);
  assert.match(page, /saveFigureGroundJpg/);
  assert.match(page, /fgAgeToggle/);
  assert.match(page, /setFigureGroundAgeMode/);
  assert.match(page, /fgPurposeToggle/);
  assert.match(page, /setFigureGroundPurposeMode/);
  assert.match(page, /fgFarToggle/);
  assert.match(page, /setFigureGroundFarMode/);
  assert.match(page, /FG_FAR_BUCKETS/);
  assert.match(page, /farKnownCount/);
  assert.match(page, /fgFloorToggle/);
  assert.match(page, /setFigureGroundFloorMode/);
  assert.match(page, /FG_FLOOR_BUCKETS/);
  assert.match(page, /floorKnownCount/);
  assert.match(page, /FG_PURPOSE_BUCKETS/);
  assert.match(page, /purposeCounts/);
  assert.match(page, /setFigureGroundShape/);
  assert.match(page, /stage\.classList\.toggle\("is-square"/);
  assert.match(page, /name="fgShape" value="circle"/);
  assert.match(page, /name="fgShape" value="square"/);
  assert.match(page, /disc\.classList\.contains\("is-square"\)/);
  assert.match(styles, /\.fg-shape-picker span\{[^}]*white-space:nowrap/);
  assert.match(styles, /\.fg-far-scale\{[^}]*minmax\(0,1fr\)/);
  assert.match(styles, /\.fg-far-scale b\{[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /\.fg-stage\{position:relative/);
  assert.match(page, /fgFeatureStyle/);
  assert.match(page, /"image\/png"/);
  assert.match(page, /"image\/jpeg"/);
  assert.match(page, />PNG 저장</);
  assert.match(page, />JPG 저장</);
  assert.match(page, />건물 윤곽</);
  assert.match(page, /10년 간격/);
  assert.doesNotMatch(page, /건물 footprint/);
  assert.doesNotMatch(page, /투명 PNG 저장/);
  assert.doesNotMatch(page, />전체 건물</);
  assert.doesNotMatch(page, />화면 표시</);
  assert.doesNotMatch(page, />데이터 기준</);
  assert.doesNotMatch(page, />동구 중심으로</);
});
