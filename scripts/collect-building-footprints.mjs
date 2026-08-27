// VWorld GIS건물통합정보(dt_d010)의 동구 건물 윤곽을 수집해
// Figure-Ground 지도용 격자 GeoJSON으로 저장한다.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unwrapGov } from "../api/_lib/govapi.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "data", "figure-ground");
const CACHE_DIR = join(ROOT, ".cache", "figure-ground", "pnu");
const BBOX_CACHE_DIR = join(ROOT, ".cache", "figure-ground", "bbox");
const VWORLD_WFS = "https://api.vworld.kr/ned/wfs/getBldgisSpceWFS";
const BLD_HUB = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";
const DOMAIN = "https://donggu-building.vercel.app";
const DONGGU_BOUNDS = [126.889, 35.068, 126.976, 35.185];
const PROBE_BOUNDS = [126.91, 35.145, 126.925, 35.158];
const ALL_BJD = Array.from({ length: 34 }, (_, i) => String(101 + i).padStart(3, "0") + "00");
const MAX_FEATURES = 100;
const MAX_BBOX_DEPTH = 9;
const COLLECTION_CELL_SIZE = 0.005;
const OUTPUT_CELL_SIZE = 0.01;
const PNU_CONCURRENCY = 3;
const MIN_FEATURES = Number(process.env.FG_MIN_FEATURES || 1000);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round6 = value => Math.round(Number(value) * 1e6) / 1e6;

function sameCoord(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
}

function normalizeRing(ring) {
  if (!Array.isArray(ring)) return null;
  const out = ring
    .filter(c => Array.isArray(c) && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])))
    .map(c => [round6(c[0]), round6(c[1])]);
  if (out.length < 3) return null;
  if (!sameCoord(out[0], out.at(-1))) out.push([...out[0]]);
  return out.length >= 4 ? out : null;
}

export function normalizeGeometry(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const normalized = [];
  for (const polygon of polygons || []) {
    if (!Array.isArray(polygon)) continue;
    const rings = polygon.map(normalizeRing).filter(Boolean);
    if (rings.length) normalized.push(rings);
  }
  if (!normalized.length) return null;
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: normalized[0] }
    : { type: "MultiPolygon", coordinates: normalized };
}

export function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = value => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
      return;
    }
    value.forEach(walk);
  };
  walk(geometry?.coordinates);
  return Number.isFinite(bounds[0]) ? bounds : null;
}

export function boundsIntersect(a, b) {
  return Boolean(a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]);
}

function featureId(properties, geometry) {
  const known = properties.gis_idntfc_no || properties.src_objectid || properties.buld_idntfc_no;
  if (known !== undefined && known !== null && String(known).trim()) return String(known).trim();
  return createHash("sha1").update(`${properties.pnu || ""}:${JSON.stringify(geometry)}`).digest("hex").slice(0, 20);
}

export function normalizeFeature(feature) {
  const geometry = normalizeGeometry(feature?.geometry);
  if (!geometry) return null;
  const bounds = geometryBounds(geometry);
  if (!boundsIntersect(bounds, DONGGU_BOUNDS)) return null;
  const properties = feature.properties || {};
  const id = featureId(properties, geometry);
  return {
    type: "Feature",
    id,
    properties: { id, pnu: String(properties.pnu || "") },
    geometry,
  };
}

function isDongguFeature(feature) {
  const pnu = String(feature?.properties?.pnu || "");
  return pnu.startsWith("12210") || pnu.startsWith("29110");
}

export function splitBounds(bounds) {
  const [minX, minY, maxX, maxY] = bounds;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return [
    [minX, minY, midX, midY], [midX, minY, maxX, midY],
    [minX, midY, midX, maxY], [midX, midY, maxX, maxY],
  ];
}

async function fetchWithRetry(url, { retries = 3, timeout = 20000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      // Connection close는 장시간 수집 중 유휴 소켓 누적을 막고 Windows Node의
      // undici 종료 지연도 피한다.
      const response = await fetch(url, { signal: controller.signal, headers: { Connection: "close" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(500 * (2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function wfsUrl(key, extra) {
  const params = new URLSearchParams({
    key, domain: DOMAIN,
    SERVICE: "WFS", VERSION: "1.1.0", REQUEST: "GetFeature",
    TYPENAME: "dt_d010", SRSNAME: "EPSG:4326",
    OUTPUT: "application/json", MAXFEATURES: String(MAX_FEATURES),
    ...extra,
  });
  return `${VWORLD_WFS}?${params}`;
}

async function queryWfs(key, extra) {
  const data = await fetchWithRetry(wfsUrl(key, extra));
  if (!Array.isArray(data?.features)) {
    const message = data?.ServiceExceptionReport?.ServiceException?._text
      || data?.exception?.text || "GeoJSON FeatureCollection이 아님";
    throw new Error(`VWorld WFS 응답 오류: ${message}`);
  }
  return data.features;
}

async function queryBBox(key, bounds) {
  const cacheKey = createHash("sha1").update(`${MAX_FEATURES}:${bounds.join(",")}`).digest("hex").slice(0, 20);
  const cachePath = join(BBOX_CACHE_DIR, `${cacheKey}.json`);
  try { return JSON.parse(await readFile(cachePath, "utf8")); }
  catch { /* 아직 수집하지 않은 셀 */ }
  const features = await queryWfs(key, { BBOX: bounds.join(",") });
  await mkdir(BBOX_CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(features), "utf8");
  return features;
}

export async function probeBBox(key) {
  if (!key) throw new Error("VWORLD_KEY가 필요합니다.");
  // 이 NED WFS는 BBOX에 CRS 접미사를 붙이면 0건을 반환한다. SRSNAME으로 좌표계를 지정하고
  // BBOX에는 네 좌표만 전달해야 실제 공간 필터가 적용된다.
  const bbox = PROBE_BOUNDS.join(",");
  const raw = await queryWfs(key, { BBOX: bbox, MAXFEATURES: "100" });
  const normalized = raw.filter(isDongguFeature).map(normalizeFeature).filter(Boolean);
  const intersecting = normalized.filter(f => boundsIntersect(geometryBounds(f.geometry), PROBE_BOUNDS));
  const ratio = normalized.length ? intersecting.length / normalized.length : 0;
  return {
    supported: normalized.length > 0 && ratio >= 0.9,
    returned: raw.length,
    valid: normalized.length,
    intersecting: intersecting.length,
    ratio,
    geometryTypes: [...new Set(normalized.map(f => f.geometry.type))],
  };
}

async function collectByBBox(key) {
  const collected = new Map();
  let requestCount = 0;

  async function collectCell(bounds, depth) {
    requestCount++;
    const raw = await queryBBox(key, bounds);
    const normalized = raw.filter(isDongguFeature).map(normalizeFeature).filter(Boolean);
    const intersecting = normalized.filter(f => boundsIntersect(geometryBounds(f.geometry), bounds));
    if (normalized.length && intersecting.length / normalized.length < 0.9) {
      throw new Error("VWorld WFS가 BBOX를 적용하지 않은 것으로 보입니다.");
    }
    if (raw.length >= MAX_FEATURES) {
      if (depth >= MAX_BBOX_DEPTH) throw new Error(`BBOX 최대 분할 깊이에서도 ${MAX_FEATURES}건 포화: ${bounds.join(",")}`);
      for (const child of splitBounds(bounds)) await collectCell(child, depth + 1);
      return;
    }
    for (const feature of intersecting) collected.set(feature.id, feature);
    if (requestCount % 10 === 0) console.log(`  BBOX ${requestCount}요청 / ${collected.size}건 수집`);
  }

  // 동구 전체를 한 번에 질의하면 상류 공간 인덱스 계산이 오래 걸린다. 출력 격자 크기부터
  // 병렬로 시작하고, 500건에 닿는 밀집 셀만 재귀 분할한다.
  const initialCells = [];
  for (let minY = DONGGU_BOUNDS[1]; minY < DONGGU_BOUNDS[3]; minY += COLLECTION_CELL_SIZE) {
    for (let minX = DONGGU_BOUNDS[0]; minX < DONGGU_BOUNDS[2]; minX += COLLECTION_CELL_SIZE) {
      initialCells.push([
        round6(minX), round6(minY),
        round6(Math.min(DONGGU_BOUNDS[2], minX + COLLECTION_CELL_SIZE)),
        round6(Math.min(DONGGU_BOUNDS[3], minY + COLLECTION_CELL_SIZE)),
      ]);
    }
  }
  await runPool(initialCells, bounds => collectCell(bounds, 0), 4);
  console.log(`BBOX 수집 완료: ${collected.size}건 / ${requestCount}요청`);
  return [...collected.values()];
}

function titleToPnu(row) {
  const bjd = String(row.bjdongCd || "").padStart(5, "0");
  const bun = String(row.bun || "").padStart(4, "0");
  const ji = String(row.ji || "").padStart(4, "0");
  if (!/^\d{5}$/.test(bjd) || !/^\d{4}$/.test(bun) || !/^\d{4}$/.test(ji)) return "";
  const land = String(row.platGbCd || "0") === "1" ? "2" : "1";
  return `12210${bjd}${land}${bun}${ji}`;
}

async function fetchTitlePage(key, bjdongCd, pageNo) {
  const params = new URLSearchParams({
    serviceKey: key, sigunguCd: "12210", bjdongCd,
    numOfRows: "1000", pageNo: String(pageNo), _type: "json",
  });
  const response = await fetchWithRetry(`${BLD_HUB}?${params}`, { timeout: 30000 });
  return unwrapGov(JSON.stringify(response), "getBrTitleInfo");
}

async function enumeratePnus(key) {
  if (!key) throw new Error("PNU 폴백에는 BLD_SERVICE_KEY가 필요합니다.");
  const pnus = new Set();
  for (const bjd of ALL_BJD) {
    const first = await fetchTitlePage(key, bjd, 1);
    const pages = Math.max(1, Math.ceil(first.totalCount / 1000));
    const rows = [...first.items];
    for (let page = 2; page <= pages; page++) rows.push(...(await fetchTitlePage(key, bjd, page)).items);
    for (const row of rows) {
      const pnu = titleToPnu(row);
      if (pnu) pnus.add(pnu);
    }
    console.log(`  표제부 ${bjd}: ${rows.length}행 / 누적 ${pnus.size} PNU`);
  }
  return [...pnus];
}

async function readCache(pnu) {
  try { return JSON.parse(await readFile(join(CACHE_DIR, `${pnu}.json`), "utf8")); }
  catch { return null; }
}

async function fetchPnuFeatures(key, pnu) {
  const cached = await readCache(pnu);
  if (cached) return cached;
  const candidates = [pnu, pnu.startsWith("12210") ? "29110" + pnu.slice(5) : pnu];
  let raw = [];
  for (const candidate of candidates) {
    raw = await queryWfs(key, { pnu: candidate });
    if (raw.length) break;
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${pnu}.json`), JSON.stringify(raw), "utf8");
  return raw;
}

async function runPool(items, worker, concurrency, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function runner() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function collectByPnu(vworldKey, buildingKey) {
  const pnus = await enumeratePnus(buildingKey);
  let lastReported = 0;
  const batches = await runPool(pnus, pnu => fetchPnuFeatures(vworldKey, pnu), PNU_CONCURRENCY, (done, total) => {
    if (done - lastReported >= 100 || done === total) {
      console.log(`  WFS PNU ${done}/${total}`);
      lastReported = done;
    }
  });
  const collected = new Map();
  for (const raw of batches) {
    for (const item of raw || []) {
      const feature = normalizeFeature(item);
      if (feature) collected.set(feature.id, feature);
    }
  }
  console.log(`PNU 수집 완료: ${collected.size}건 / ${pnus.length}필지`);
  return [...collected.values()];
}

export function partitionFeatures(features, cellSize = OUTPUT_CELL_SIZE) {
  const cells = new Map();
  const width = Math.ceil((DONGGU_BOUNDS[2] - DONGGU_BOUNDS[0]) / cellSize);
  const height = Math.ceil((DONGGU_BOUNDS[3] - DONGGU_BOUNDS[1]) / cellSize);
  for (const feature of features) {
    const bounds = geometryBounds(feature.geometry);
    const centerX = (bounds[0] + bounds[2]) / 2;
    const centerY = (bounds[1] + bounds[3]) / 2;
    const x = Math.max(0, Math.min(width - 1, Math.floor((centerX - DONGGU_BOUNDS[0]) / cellSize)));
    const y = Math.max(0, Math.min(height - 1, Math.floor((centerY - DONGGU_BOUNDS[1]) / cellSize)));
    const id = `x${String(x).padStart(2, "0")}-y${String(y).padStart(2, "0")}`;
    if (!cells.has(id)) {
      cells.set(id, {
        id,
        bounds: [
          round6(DONGGU_BOUNDS[0] + x * cellSize), round6(DONGGU_BOUNDS[1] + y * cellSize),
          round6(Math.min(DONGGU_BOUNDS[2], DONGGU_BOUNDS[0] + (x + 1) * cellSize)),
          round6(Math.min(DONGGU_BOUNDS[3], DONGGU_BOUNDS[1] + (y + 1) * cellSize)),
        ],
        features: [],
      });
    }
    cells.get(id).features.push(feature);
  }
  return [...cells.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function previousFeatureCount() {
  try {
    const manifest = JSON.parse(await readFile(join(OUTPUT_DIR, "manifest.json"), "utf8"));
    return Number(manifest.featureCount || 0);
  } catch { return 0; }
}

async function writeDataset(features, mode) {
  const unique = new Map(features.map(feature => [feature.id, feature]));
  const sorted = [...unique.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (sorted.length < MIN_FEATURES) throw new Error(`수집 건수 ${sorted.length}건이 최소 기준 ${MIN_FEATURES}건보다 적습니다.`);
  const previous = await previousFeatureCount();
  if (previous > 0 && sorted.length < previous * 0.8) {
    throw new Error(`수집 건수 급감: ${sorted.length}건 (기존 ${previous}건의 80% 미만). 기존 데이터를 보존합니다.`);
  }

  const cells = partitionFeatures(sorted);
  const nextDir = `${OUTPUT_DIR}.next`;
  const backupDir = `${OUTPUT_DIR}.backup`;
  await rm(nextDir, { recursive: true, force: true });
  await mkdir(join(nextDir, "cells"), { recursive: true });

  const manifestCells = [];
  for (const cell of cells) {
    const file = `cells/${cell.id}.geojson`;
    const collection = { type: "FeatureCollection", features: cell.features };
    const text = JSON.stringify(collection);
    await writeFile(join(nextDir, file), text + "\n", "utf8");
    manifestCells.push({ id: cell.id, bounds: cell.bounds, count: cell.features.length, bytes: Buffer.byteLength(text), file });
  }
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "VWorld GIS건물통합정보 dt_d010",
    collectionMode: mode,
    bounds: DONGGU_BOUNDS,
    cellSize: OUTPUT_CELL_SIZE,
    featureCount: sorted.length,
    cells: manifestCells,
  };
  await writeFile(join(nextDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  await rm(backupDir, { recursive: true, force: true });
  try { await rename(OUTPUT_DIR, backupDir); } catch (error) { if (error.code !== "ENOENT") throw error; }
  try {
    await rename(nextDir, OUTPUT_DIR);
    await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    try { await rename(backupDir, OUTPUT_DIR); } catch { /* 원래 오류를 유지 */ }
    throw error;
  }
  console.log(`저장 완료: ${sorted.length}건 / ${cells.length}셀 -> ${OUTPUT_DIR}`);
}

function cliOption(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

async function main() {
  const vworldKey = process.env.VWORLD_KEY;
  if (!vworldKey) throw new Error("VWORLD_KEY가 필요합니다.");
  const probeOnly = process.argv.includes("--probe");
  if (probeOnly) {
    const result = await probeBBox(vworldKey);
    console.log(JSON.stringify(result, null, 2));
    if (!result.supported) process.exitCode = 2;
    return;
  }

  const requestedMode = cliOption("mode", "auto");
  if (!["auto", "bbox", "pnu"].includes(requestedMode)) throw new Error("--mode는 auto, bbox, pnu 중 하나여야 합니다.");
  let mode = requestedMode;
  let features;
  if (mode === "auto" || mode === "bbox") {
    try {
      const probe = await probeBBox(vworldKey);
      if (!probe.supported) throw new Error(`BBOX 검증 실패: ${JSON.stringify(probe)}`);
      features = await collectByBBox(vworldKey);
      mode = "bbox";
    } catch (error) {
      if (requestedMode === "bbox") throw error;
      console.warn(`BBOX 수집 불가, PNU 방식으로 전환: ${error.message}`);
      mode = "pnu";
    }
  }
  if (mode === "pnu" && !features) features = await collectByPnu(vworldKey, process.env.BLD_SERVICE_KEY);
  await writeDataset(features, mode);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(`[collect-building-footprints] ${error.message}`);
    process.exitCode = 1;
  });
}
