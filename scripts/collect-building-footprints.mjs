// VWorld GIS건물통합정보(dt_d010)의 동구 건물 윤곽과 용도를 수집해
// Figure-Ground 지도용 격자 GeoJSON으로 저장한다.
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import proj4 from "proj4";
import { unwrapGov } from "../api/_lib/govapi.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(ROOT, "data", "figure-ground");
const CACHE_DIR = join(ROOT, ".cache", "figure-ground", "pnu");
const BBOX_CACHE_DIR = join(ROOT, ".cache", "figure-ground", "bbox");
const VWORLD_WFS = "https://api.vworld.kr/ned/wfs/getBldgisSpceWFS";
const BLD_HUB = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";
const DOMAIN = "https://donggu-building.vercel.app";
const DONGGU_BOUNDS = [126.889, 35.068, 127.008, 35.185];
const PROBE_BOUNDS = [126.91, 35.145, 126.925, 35.158];
const ALL_BJD = Array.from({ length: 34 }, (_, i) => String(101 + i).padStart(3, "0") + "00");
const MAX_FEATURES = 100;
const MAX_BBOX_DEPTH = 9;
const COLLECTION_CELL_SIZE = 0.005;
const OUTPUT_CELL_SIZE = 0.01;
const PNU_CONCURRENCY = 3;
const MIN_FEATURES = Number(process.env.FG_MIN_FEATURES || 1000);
const ADDRESS_SHP_CRS = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs";
const ROAD_ADDRESS_SHP_CRS = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
const FG_OTHER_PURPOSE = "기타";
const FG_PURPOSE_BY_CODE = Object.freeze({
  "01000": "단독주택",
  "02000": "공동주택",
  "03000": "제1종 근린생활시설",
  "04000": "제2종 근린생활시설",
  "15000": "숙박시설",
});
export const FIGURE_GROUND_PURPOSES = Object.freeze([
  "단독주택",
  "공동주택",
  "제1종 근린생활시설",
  "제2종 근린생활시설",
  "숙박시설",
  FG_OTHER_PURPOSE,
]);
const PURPOSE_PROPERTY_KEYS = [
  "purpose", "USABILITY", "usability", "mainPurpsCdNm", "mainPurpsCd",
  "main_purps_cd_nm", "main_purps_cd", "mainPurps", "main_purps",
];

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

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const next = ring[(i + 1) % ring.length];
    area += ring[i][0] * next[1] - next[0] * ring[i][1];
  }
  return area / 2;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1])
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function ringsToGeometry(rings) {
  const nodes = rings
    .filter(ring => Array.isArray(ring) && ring.length >= 3)
    .map(ring => ({ ring, area: Math.abs(ringArea(ring)), parent: null, depth: 0 }))
    .sort((a, b) => b.area - a.area);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    for (let j = i - 1; j >= 0; j--) {
      const candidate = nodes[j];
      if (pointInRing(node.ring[0], candidate.ring)) {
        if (!node.parent || candidate.area < node.parent.area) node.parent = candidate;
      }
    }
    node.depth = node.parent ? node.parent.depth + 1 : 0;
  }
  const polygons = nodes
    .filter(node => node.depth % 2 === 0)
    .map(node => [node.ring, ...nodes
      .filter(child => child.parent === node && child.depth % 2 === 1)
      .map(child => child.ring)]);
  return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null;
}

export function parseShpPolygon(content, project = coordinate => coordinate) {
  if (!Buffer.isBuffer(content) || content.length < 44) return null;
  const shapeType = content.readInt32LE(0);
  if (![5, 15, 25].includes(shapeType)) return null;
  const partCount = content.readInt32LE(36);
  const pointCount = content.readInt32LE(40);
  const partsOffset = 44;
  const pointsOffset = partsOffset + partCount * 4;
  if (partCount < 1 || pointCount < 3 || pointsOffset + pointCount * 16 > content.length) return null;
  const starts = Array.from({ length: partCount }, (_, index) => content.readInt32LE(partsOffset + index * 4));
  starts.push(pointCount);
  const rings = [];
  for (let part = 0; part < partCount; part++) {
    const ring = [];
    for (let index = starts[part]; index < starts[part + 1]; index++) {
      const offset = pointsOffset + index * 16;
      ring.push(project([content.readDoubleLE(offset), content.readDoubleLE(offset + 8)]));
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return ringsToGeometry(rings);
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

function sourcePurpose(properties) {
  for (const key of PURPOSE_PROPERTY_KEYS) {
    const value = properties?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return null;
}

export function figureGroundPurpose(value) {
  const raw = String(value || "").trim();
  if (!raw) return FG_OTHER_PURPOSE;
  const compact = raw.replace(/\s+/g, "");
  const knownLabel = FIGURE_GROUND_PURPOSES.find(label => label.replace(/\s+/g, "") === compact);
  if (knownLabel) return knownLabel;
  const code = /^\d+$/.test(raw) ? raw.padStart(5, "0") : raw;
  return FG_PURPOSE_BY_CODE[code] || FG_OTHER_PURPOSE;
}

export function normalizeFeature(feature) {
  const geometry = normalizeGeometry(feature?.geometry);
  if (!geometry) return null;
  const bounds = geometryBounds(geometry);
  if (!boundsIntersect(bounds, DONGGU_BOUNDS)) return null;
  const properties = feature.properties || {};
  const id = featureId(properties, geometry);
  const year = approvalYear(properties.year || properties.useAprDay);
  const far = floorAreaRatio(properties.far ?? properties.vlRat);
  const rawPurpose = sourcePurpose(properties);
  const purpose = rawPurpose === null ? null : figureGroundPurpose(rawPurpose);
  return {
    type: "Feature",
    id,
    properties: {
      id,
      pnu: String(properties.pnu || ""),
      ...(year ? { year } : {}),
      ...(purpose ? { purpose } : {}),
      ...(far !== null ? { far } : {}),
    },
    geometry,
  };
}

export function approvalYear(value) {
  const year = Number(String(value || "").replace(/\D/g, "").slice(0, 4));
  return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() ? year : null;
}

export function floorAreaRatio(value) {
  const raw = String(value ?? "").replace(/,/g, "").trim();
  if (!raw) return null;
  const ratio = Number(raw);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
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

async function readDbfHeader(handle) {
  const prefix = Buffer.alloc(32);
  await handle.read(prefix, 0, prefix.length, 0);
  const recordCount = prefix.readUInt32LE(4);
  const headerLength = prefix.readUInt16LE(8);
  const recordLength = prefix.readUInt16LE(10);
  const header = Buffer.alloc(headerLength);
  await handle.read(header, 0, header.length, 0);
  const fields = new Map();
  let position = 1;
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    let end = offset;
    while (end < offset + 11 && header[end]) end++;
    const name = header.subarray(offset, end).toString("ascii");
    const length = header[offset + 16];
    fields.set(name, { position, length });
    position += length;
  }
  return { recordCount, headerLength, recordLength, fields };
}

function dbfText(record, field) {
  return record.toString("ascii", field.position, field.position + field.length).replace(/\0/g, "").trim();
}

function isoDate(value) {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}

async function collectShapefile(shpPath) {
  const base = shpPath.slice(0, -4);
  const dbfHandle = await open(`${base}.dbf`, "r");
  let candidates = [];
  let sourceDate = "";
  try {
    const header = await readDbfHeader(dbfHandle);
    const required = ["A1", "A2", "A22", "A23"];
    for (const name of required) {
      if (!header.fields.has(name)) throw new Error(`${shpPath}: DBF 필드 ${name}이 없습니다.`);
    }
    const batchSize = 5000;
    const buffer = Buffer.alloc(header.recordLength * batchSize);
    for (let start = 0; start < header.recordCount; start += batchSize) {
      const count = Math.min(batchSize, header.recordCount - start);
      await dbfHandle.read(buffer, 0, count * header.recordLength, header.headerLength + start * header.recordLength);
      for (let index = 0; index < count; index++) {
        const record = buffer.subarray(index * header.recordLength, (index + 1) * header.recordLength);
        if (record[0] === 0x2a || dbfText(record, header.fields.get("A23")) !== "12210") continue;
        const pnu = dbfText(record, header.fields.get("A2"));
        const id = dbfText(record, header.fields.get("A1"));
        const date = dbfText(record, header.fields.get("A22"));
        if (/^12210\d{14}$/.test(pnu) && id) candidates.push({ index: start + index, id, pnu });
        if (date > sourceDate) sourceDate = date;
      }
    }
  } finally {
    await dbfHandle.close();
  }
  if (!candidates.length) return { features: [], sourceDate: "" };

  const index = await readFile(`${base}.shx`);
  const shpHandle = await open(shpPath, "r");
  const features = [];
  let invalidGeometry = 0;
  let outsideBounds = 0;
  const outsideSamples = [];
  try {
    for (const candidate of candidates) {
      const indexOffset = 100 + candidate.index * 8;
      if (indexOffset + 8 > index.length) throw new Error(`${shpPath}: SHX 인덱스가 DBF보다 짧습니다.`);
      const offset = index.readInt32BE(indexOffset) * 2 + 8;
      const length = index.readInt32BE(indexOffset + 4) * 2;
      const content = Buffer.alloc(length);
      await shpHandle.read(content, 0, length, offset);
      const geometry = parseShpPolygon(content, coordinate => proj4(ADDRESS_SHP_CRS, "EPSG:4326", coordinate));
      if (!geometry) {
        invalidGeometry++;
        continue;
      }
      const feature = normalizeFeature({
        properties: { gis_idntfc_no: candidate.id, pnu: candidate.pnu },
        geometry,
      });
      if (feature) features.push(feature);
      else {
        outsideBounds++;
        if (outsideSamples.length < 5) outsideSamples.push(`${candidate.pnu} ${geometryBounds(geometry)?.join(",")}`);
      }
    }
  } finally {
    await shpHandle.close();
  }
  console.log(`  SHP ${shpPath}: 동구 ${features.length}건 (무효 도형 ${invalidGeometry}, 범위 밖 ${outsideBounds})`);
  if (outsideSamples.length) console.warn(`  범위 밖 표본: ${outsideSamples.join(" / ")}`);
  return { features, sourceDate: isoDate(sourceDate) };
}

async function collectByShapefile(directory) {
  if (!directory) throw new Error("SHP 수집에는 --shp-dir 경로가 필요합니다.");
  const names = (await readdir(directory)).filter(name => name.toLowerCase().endsWith(".shp")).sort();
  if (!names.length) throw new Error(`${directory}: SHP 파일이 없습니다.`);
  const features = [];
  let sourceDate = "";
  for (const name of names) {
    const result = await collectShapefile(join(directory, name));
    features.push(...result.features);
    if (result.sourceDate > sourceDate) sourceDate = result.sourceDate;
  }
  console.log(`SHP 수집 완료: ${features.length}건 / 원천 기준일 ${sourceDate || "미상"}`);
  return { features, sourceDate };
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function readRegistryAttributes(csvPath) {
  if (!csvPath) throw new Error("건축물대장 속성 보완에는 --registry-csv 경로가 필요합니다.");
  const text = new TextDecoder("euc-kr").decode(await readFile(csvPath));
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) throw new Error(`${csvPath}: CSV가 비어 있습니다.`);
  const headers = parseCsvLine(lines[0]).map(value => value.trim());
  const indexes = new Map(headers.map((name, index) => [name, index]));
  for (const name of ["GIS건물통합식별번호", "고유번호", "주요용도코드", "사용승인일자", "용적율", "데이터기준일자"]) {
    if (!indexes.has(name)) throw new Error(`${csvPath}: CSV 필드 ${name}이 없습니다.`);
  }

  const attributes = new Map();
  let sourceDate = "";
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line).map(value => value.trim());
    const id = values[indexes.get("GIS건물통합식별번호")] || "";
    const pnu = values[indexes.get("고유번호")] || "";
    if (!id || !/^12210\d{14}$/.test(pnu)) continue;
    if (attributes.has(id)) throw new Error(`${csvPath}: GIS건물통합식별번호 ${id}가 중복됩니다.`);
    const date = values[indexes.get("데이터기준일자")] || "";
    if (date > sourceDate) sourceDate = date;
    const year = approvalYear(values[indexes.get("사용승인일자")]);
    const far = floorAreaRatio(values[indexes.get("용적율")]);
    attributes.set(id, {
      pnu,
      purpose: figureGroundPurpose(values[indexes.get("주요용도코드")]),
      ...(year ? { year } : {}),
      ...(far !== null ? { far } : {}),
    });
  }
  return { attributes, sourceDate, rowCount: attributes.size };
}

async function collectRegistryShapefile(shpPath, attributes, excludeIds = new Set()) {
  if (!shpPath) throw new Error("건축물대장 도형 보완에는 --registry-shp 경로가 필요합니다.");
  const base = shpPath.slice(0, -4);
  const dbfHandle = await open(`${base}.dbf`, "r");
  const candidates = [];
  let missingAttributes = 0;
  let pnuMismatches = 0;
  let recordCount = 0;
  try {
    const header = await readDbfHeader(dbfHandle);
    recordCount = header.recordCount;
    for (const name of ["A1", "A2"]) {
      if (!header.fields.has(name)) throw new Error(`${base}.dbf: DBF 필드 ${name}이 없습니다.`);
    }
    const batchSize = 5000;
    const buffer = Buffer.alloc(header.recordLength * batchSize);
    for (let start = 0; start < header.recordCount; start += batchSize) {
      const count = Math.min(batchSize, header.recordCount - start);
      await dbfHandle.read(buffer, 0, count * header.recordLength, header.headerLength + start * header.recordLength);
      for (let index = 0; index < count; index++) {
        const record = buffer.subarray(index * header.recordLength, (index + 1) * header.recordLength);
        if (record[0] === 0x2a) continue;
        const id = dbfText(record, header.fields.get("A1"));
        const pnu = dbfText(record, header.fields.get("A2"));
        if (!id || !/^12210\d{14}$/.test(pnu) || excludeIds.has(id)) continue;
        const attribute = attributes.get(id);
        if (!attribute) {
          missingAttributes++;
          continue;
        }
        if (attribute.pnu && attribute.pnu !== pnu) {
          pnuMismatches++;
          continue;
        }
        candidates.push({ index: start + index, id, pnu, attribute });
      }
    }
  } finally {
    await dbfHandle.close();
  }
  if (!candidates.length) return { features: [], recordCount, missingAttributes, pnuMismatches, invalidGeometry: 0 };

  const index = await readFile(`${base}.shx`);
  const shpHandle = await open(shpPath, "r");
  const features = [];
  let invalidGeometry = 0;
  try {
    for (const candidate of candidates) {
      const indexOffset = 100 + candidate.index * 8;
      if (indexOffset + 8 > index.length) throw new Error(`${shpPath}: SHX 인덱스가 DBF보다 짧습니다.`);
      const offset = index.readInt32BE(indexOffset) * 2 + 8;
      const length = index.readInt32BE(indexOffset + 4) * 2;
      const content = Buffer.alloc(length);
      await shpHandle.read(content, 0, length, offset);
      const geometry = parseShpPolygon(content, coordinate => proj4(ADDRESS_SHP_CRS, "EPSG:4326", coordinate));
      if (!geometry) {
        invalidGeometry++;
        continue;
      }
      const feature = normalizeFeature({
        properties: {
          gis_idntfc_no: candidate.id,
          pnu: candidate.pnu,
          purpose: candidate.attribute.purpose,
          year: candidate.attribute.year,
          far: candidate.attribute.far,
        },
        geometry,
      });
      if (feature) features.push({
        ...feature,
        properties: { ...feature.properties, source: "registry" },
      });
    }
  } finally {
    await shpHandle.close();
  }
  return { features, recordCount, missingAttributes, pnuMismatches, invalidGeometry };
}

function roadRecordPnu(record, fields) {
  const sigungu = dbfText(record, fields.get("SIG_CD"));
  const dong = dbfText(record, fields.get("EMD_CD")) + dbfText(record, fields.get("LI_CD"));
  const land = dbfText(record, fields.get("MNTN_YN")) === "1" ? "2" : "1";
  const main = dbfText(record, fields.get("LNBR_MNNM")).padStart(4, "0");
  const sub = dbfText(record, fields.get("LNBR_SLNO")).padStart(4, "0");
  return `${sigungu}${dong}${land}${main}${sub}`;
}

async function collectRoadShapefile(shpPath) {
  const base = shpPath.slice(0, -4);
  const dbfHandle = await open(`${base}.dbf`, "r");
  const candidates = [];
  let sourceDate = "";
  try {
    const header = await readDbfHeader(dbfHandle);
    const required = ["BD_MGT_SN", "BUL_MAN_NO", "EMD_CD", "LI_CD", "LNBR_MNNM", "LNBR_SLNO", "MNTN_YN", "OPERT_DE", "SIG_CD"];
    for (const name of required) {
      if (!header.fields.has(name)) throw new Error(`${shpPath}: DBF 필드 ${name}이 없습니다.`);
    }
    const batchSize = 5000;
    const buffer = Buffer.alloc(header.recordLength * batchSize);
    for (let start = 0; start < header.recordCount; start += batchSize) {
      const count = Math.min(batchSize, header.recordCount - start);
      await dbfHandle.read(buffer, 0, count * header.recordLength, header.headerLength + start * header.recordLength);
      for (let index = 0; index < count; index++) {
        const record = buffer.subarray(index * header.recordLength, (index + 1) * header.recordLength);
        if (record[0] === 0x2a || dbfText(record, header.fields.get("SIG_CD")) !== "12210") continue;
        const pnu = roadRecordPnu(record, header.fields);
        const management = dbfText(record, header.fields.get("BD_MGT_SN"));
        const building = dbfText(record, header.fields.get("BUL_MAN_NO"));
        const operated = dbfText(record, header.fields.get("OPERT_DE")).slice(0, 8);
        if (/^12210\d{14}$/.test(pnu)) candidates.push({ index: start + index, id: `road:${management || "none"}:${building}`, pnu });
        if (operated > sourceDate) sourceDate = operated;
      }
    }
  } finally {
    await dbfHandle.close();
  }

  const index = await readFile(`${base}.shx`);
  const shpHandle = await open(shpPath, "r");
  const features = [];
  try {
    for (const candidate of candidates) {
      const indexOffset = 100 + candidate.index * 8;
      if (indexOffset + 8 > index.length) throw new Error(`${shpPath}: SHX 인덱스가 DBF보다 짧습니다.`);
      const offset = index.readInt32BE(indexOffset) * 2 + 8;
      const length = index.readInt32BE(indexOffset + 4) * 2;
      const content = Buffer.alloc(length);
      await shpHandle.read(content, 0, length, offset);
      const geometry = parseShpPolygon(content, coordinate => proj4(ROAD_ADDRESS_SHP_CRS, "EPSG:4326", coordinate));
      const feature = normalizeFeature({ properties: { gis_idntfc_no: candidate.id, pnu: candidate.pnu }, geometry });
      if (feature) features.push(feature);
    }
  } finally {
    await shpHandle.close();
  }
  console.log(`  도로명주소 SHP ${shpPath}: 동구 ${features.length}건`);
  return { features, sourceDate: isoDate(sourceDate) };
}

async function collectByRoadShapefile(directory) {
  if (!directory) throw new Error("도로명주소 SHP 수집에는 --shp-dir 경로가 필요합니다.");
  const names = (await readdir(directory)).filter(name => name.toLowerCase().endsWith(".shp")).sort();
  if (!names.length) throw new Error(`${directory}: SHP 파일이 없습니다.`);
  const features = [];
  let sourceDate = "";
  let sourceVersion = "";
  for (const name of names) {
    const result = await collectRoadShapefile(join(directory, name));
    features.push(...result.features);
    if (result.sourceDate > sourceDate) sourceDate = result.sourceDate;
    const version = name.match(/_(\d{4})(\d{2})\.shp$/i);
    if (version) sourceVersion = `${version[1]}-${version[2]}`;
  }
  return { features, sourceDate, sourceVersion };
}

function legacyPnu(pnu) {
  const value = String(pnu || "");
  return value.startsWith("12210") ? `29110${value.slice(5)}` : value;
}

function geometryContainsPoint(geometry, point) {
  if (!geometry || !point) return false;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return (polygons || []).some(polygon => polygon?.[0]
    && pointInRing(point, polygon[0])
    && !polygon.slice(1).some(hole => pointInRing(point, hole)));
}

function geometryCenter(geometry) {
  const bounds = geometryBounds(geometry);
  return bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null;
}

export function mergeRoadApartmentFootprints(current, road, apartments) {
  const base = (current || []).filter(feature => !String(feature?.id || "").startsWith("road:"));
  const apartmentByPnu = new Map((apartments || [])
    .filter(item => item?.pnu && ["Polygon", "MultiPolygon"].includes(item.geometry?.type))
    .map(item => [String(item.pnu), item]));
  const currentPnus = new Set(base.map(feature => legacyPnu(feature?.properties?.pnu)));
  const roadByPnu = new Map();
  for (const feature of road || []) {
    const pnu = legacyPnu(feature?.properties?.pnu);
    if (!apartmentByPnu.has(pnu)) continue;
    if (!roadByPnu.has(pnu)) roadByPnu.set(pnu, []);
    roadByPnu.get(pnu).push(feature);
  }
  const replacementPnus = [...roadByPnu.keys()].filter(pnu => !currentPnus.has(pnu));
  const replacementParcels = replacementPnus.map(pnu => apartmentByPnu.get(pnu).geometry);
  const retained = base.filter(feature => {
    const center = geometryCenter(feature.geometry);
    return !replacementParcels.some(parcel => geometryContainsPoint(parcel, center));
  });
  const added = replacementPnus.flatMap(pnu => {
    const year = approvalYear(apartmentByPnu.get(pnu)?.useAprDay);
    return roadByPnu.get(pnu).map(feature => ({
      ...feature,
      properties: { ...feature.properties, purpose: "공동주택", ...(year ? { year } : {}) },
    }));
  });
  return {
    features: [...retained, ...added],
    replacementCount: replacementPnus.length,
    removedCount: base.length - retained.length,
    addedCount: added.length,
  };
}

export function mergeRegistryFootprints(current, registry) {
  const features = [...(current || [])];
  const ids = new Set(features.map(feature => String(feature?.id || "")));
  let addedCount = 0;
  for (const feature of registry || []) {
    const id = String(feature?.id || "");
    if (!id || ids.has(id)) continue;
    ids.add(id);
    features.push(feature);
    addedCount++;
  }
  return { features, addedCount, skippedCount: (registry || []).length - addedCount };
}

async function readCurrentDataset() {
  const manifest = JSON.parse(await readFile(join(OUTPUT_DIR, "manifest.json"), "utf8"));
  const features = [];
  for (const cell of manifest.cells || []) {
    const collection = JSON.parse(await readFile(join(OUTPUT_DIR, cell.file), "utf8"));
    features.push(...(collection.features || []));
  }
  return features;
}

async function readFacilityAttributes(dbfPath) {
  if (!dbfPath) throw new Error("용도·연령 보강에는 --facility-dbf 경로가 필요합니다.");
  const handle = await open(dbfPath, "r");
  const attributes = new Map();
  try {
    const header = await readDbfHeader(handle);
    for (const name of ["UFID", "USEAPR_DAY", "USABILITY"]) {
      if (!header.fields.has(name)) throw new Error(`${dbfPath}: DBF 필드 ${name}이 없습니다.`);
    }
    const batchSize = 5000;
    const buffer = Buffer.alloc(header.recordLength * batchSize);
    for (let start = 0; start < header.recordCount; start += batchSize) {
      const count = Math.min(batchSize, header.recordCount - start);
      await handle.read(buffer, 0, count * header.recordLength, header.headerLength + start * header.recordLength);
      for (let index = 0; index < count; index++) {
        const record = buffer.subarray(index * header.recordLength, (index + 1) * header.recordLength);
        if (record[0] === 0x2a) continue;
        const id = dbfText(record, header.fields.get("UFID"));
        const year = approvalYear(dbfText(record, header.fields.get("USEAPR_DAY")));
        const purpose = figureGroundPurpose(dbfText(record, header.fields.get("USABILITY")));
        if (id) attributes.set(id, { purpose, ...(year ? { year } : {}) });
      }
    }
  } finally {
    await handle.close();
  }
  return attributes;
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

async function previousPurposeMap() {
  const byId = new Map();
  try {
    for (const feature of await readCurrentDataset()) {
      const purpose = feature.properties?.purpose;
      if (!purpose) continue;
      byId.set(`id:${feature.id}`, purpose);
      if (feature.properties?.pnu) byId.set(`pnu:${legacyPnu(feature.properties.pnu)}`, purpose);
    }
  } catch { /* 기존 데이터가 없는 최초 생성 */ }
  return byId;
}

async function previousFarMap() {
  const byId = new Map();
  try {
    for (const feature of await readCurrentDataset()) {
      const far = floorAreaRatio(feature.properties?.far);
      if (far === null) continue;
      byId.set(`id:${feature.id}`, far);
      if (feature.properties?.pnu) byId.set(`pnu:${legacyPnu(feature.properties.pnu)}`, far);
    }
  } catch { /* 기존 데이터가 없는 최초 생성 */ }
  return byId;
}

async function previousRegistryFeatures() {
  try {
    return (await readCurrentDataset()).filter(feature => feature.properties?.source === "registry");
  } catch { return []; }
}

async function writeDataset(features, mode, metadata = {}) {
  const preserved = metadata.replaceRegistrySupplement ? [] : await previousRegistryFeatures();
  const featureIds = new Set((features || []).map(feature => String(feature?.id || "")));
  const input = [...(features || []), ...preserved.filter(feature => !featureIds.has(String(feature.id)))];
  const previousPurposes = await previousPurposeMap();
  const previousFars = await previousFarMap();
  const enriched = input.map(feature => {
    const previous = previousPurposes.get(`id:${feature.id}`)
      || previousPurposes.get(`pnu:${legacyPnu(feature.properties?.pnu)}`);
    const far = floorAreaRatio(feature.properties?.far)
      ?? previousFars.get(`id:${feature.id}`)
      ?? previousFars.get(`pnu:${legacyPnu(feature.properties?.pnu)}`);
    const purpose = figureGroundPurpose(feature.properties?.purpose || previous);
    return { ...feature, properties: { ...feature.properties, purpose, ...(far !== undefined ? { far } : {}) } };
  });
  const unique = new Map(enriched.map(feature => [feature.id, feature]));
  const sorted = [...unique.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (sorted.length < MIN_FEATURES) throw new Error(`수집 건수 ${sorted.length}건이 최소 기준 ${MIN_FEATURES}건보다 적습니다.`);
  const previous = await previousFeatureCount();
  if (previous > 0 && sorted.length < previous * 0.8) {
    throw new Error(`수집 건수 급감: ${sorted.length}건 (기존 ${previous}건의 80% 미만). 기존 데이터를 보존합니다.`);
  }

  const cells = partitionFeatures(sorted);
  const purposeCounts = Object.fromEntries(FIGURE_GROUND_PURPOSES.map(purpose => [purpose, 0]));
  for (const feature of sorted) purposeCounts[feature.properties.purpose]++;
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
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    source: metadata.source || "VWorld GIS건물통합정보 dt_d010",
    ...(metadata.sourceDate ? { sourceDate: metadata.sourceDate } : {}),
    collectionMode: mode,
    bounds: DONGGU_BOUNDS,
    cellSize: OUTPUT_CELL_SIZE,
    featureCount: sorted.length,
    ageKnownCount: sorted.filter(feature => approvalYear(feature.properties?.year)).length,
    ageUnknownCount: sorted.filter(feature => !approvalYear(feature.properties?.year)).length,
    farKnownCount: sorted.filter(feature => floorAreaRatio(feature.properties?.far)).length,
    farUnknownCount: sorted.filter(feature => !floorAreaRatio(feature.properties?.far)).length,
    registrySupplementCount: sorted.filter(feature => feature.properties?.source === "registry").length,
    purposeCounts,
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
  const probeOnly = process.argv.includes("--probe");
  const requestedMode = cliOption("mode", "auto");
  if (!["auto", "bbox", "pnu", "shp", "road-shp"].includes(requestedMode)) throw new Error("--mode는 auto, bbox, pnu, shp, road-shp 중 하나여야 합니다.");
  if (requestedMode === "shp") {
    const result = await collectByShapefile(cliOption("shp-dir"));
    await writeDataset(result.features, "shp", {
      source: "주소기반산업지원서비스 GIS건물통합정보 AL_D010",
      sourceDate: result.sourceDate,
      replaceRegistrySupplement: true,
    });
    return;
  }
  if (requestedMode === "road-shp") {
    const road = await collectByRoadShapefile(cliOption("shp-dir"));
    const attributes = await readFacilityAttributes(cliOption("facility-dbf"));
    const registryShpPath = cliOption("registry-shp");
    const registryCsvPath = cliOption("registry-csv");
    if (Boolean(registryShpPath) !== Boolean(registryCsvPath)) {
      throw new Error("건축물대장 보완에는 --registry-shp와 --registry-csv를 함께 지정해야 합니다.");
    }
    const registry = registryCsvPath ? await readRegistryAttributes(registryCsvPath) : null;
    const currentDataset = await readCurrentDataset();
    const current = currentDataset
      .filter(feature => !(registryShpPath && feature.properties?.source === "registry"))
      .map(feature => {
        const data = attributes.get(String(feature.id));
        const far = registry?.attributes.get(String(feature.id))?.far;
        if (!data && far === undefined) return feature;
        return {
          ...feature,
          properties: { ...feature.properties, ...(data || {}), ...(far !== undefined ? { far } : {}) },
        };
      });
    const apartments = JSON.parse(await readFile(join(ROOT, "apt_geo.json"), "utf8"));
    const merged = mergeRoadApartmentFootprints(current, road.features, apartments);
    console.log(`공동주택 필지 교체: ${merged.replacementCount}개 단지 / 기존 ${merged.removedCount}건 제거 / 현행 ${merged.addedCount}건 추가`);
    let result = merged.features;
    let registryMetadata = {};
    if (registry) {
      const fallback = await collectRegistryShapefile(
        registryShpPath,
        registry.attributes,
        new Set(current.map(feature => String(feature.id))),
      );
      const supplemented = mergeRegistryFootprints(merged.features, fallback.features);
      console.log(`건축물대장 누락 보완: ${supplemented.addedCount}건 추가 / ${supplemented.skippedCount}건 중복·제외 (CSV ${registry.rowCount}건, 기준일 ${registry.sourceDate || "미상"})`);
      if (fallback.missingAttributes || fallback.pnuMismatches || fallback.invalidGeometry) {
        console.log(`  보완 제외: 속성 없음 ${fallback.missingAttributes}건 / PNU 불일치 ${fallback.pnuMismatches}건 / 무효 도형 ${fallback.invalidGeometry}건`);
      }
      result = supplemented.features;
      registryMetadata = {
        replaceRegistrySupplement: true,
      };
    }
    await writeDataset(result, "road-shp", {
      source: "VWorld GIS건물통합정보 + 도로명주소 건물 + 시설물통합정보",
      sourceDate: road.sourceVersion || road.sourceDate,
      ...registryMetadata,
    });
    return;
  }

  const vworldKey = process.env.VWORLD_KEY;
  if (!vworldKey) throw new Error("VWORLD_KEY가 필요합니다.");
  if (probeOnly) {
    const result = await probeBBox(vworldKey);
    console.log(JSON.stringify(result, null, 2));
    if (!result.supported) process.exitCode = 2;
    return;
  }

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
