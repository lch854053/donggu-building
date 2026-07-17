// scripts/update-vacant.mjs
// odcloud "전남광주통합특별시 동구_빈집 현황" 데이터를 수집하여 vacantlist_donggu.json을 생성합니다.
// 빈집 데이터의 법정동(읍면동명)만으로는 행정동(계림1동 등) 검색이 불가능하므로,
// 아래 우선순위로 행정동(hdong)을 보강합니다.
//
// 우선순위:
//   1차: 엑셀 보강 파일 (data/vacant-supplement.xlsx) 직접 매칭
//   2차: 카카오 coord2address → search/address (좌표 → 지번주소 → 행정동)
//   3차: 2차 실패 → 행안부 addrLinkApi로 동구 내 주소 검색 → 카카오 search/address
//   4차: 수동 보정 파일 (vacantlist_manual.json) 덮어쓰기
//
// 참고: odcloud 원본 좌표는 EPSG:5181 (Korea 2000 / Southern Belt)이며,
// 필드명은 '위도'와 '경도'로 되어 있으나 실제 값은 X/Y가 반대로 들어가 있습니다.
// 따라서 실제 변환 시: X = '위도', Y = '경도' 로 사용합니다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import proj4 from "proj4";
import xlsx from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ODCLOUD_SERVICE_KEY = process.env.ODCLOUD_SERVICE_KEY;
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;
const JUSO_CONFM_KEY = process.env.JUSO_CONFM_KEY;
const VWORLD_KEY = process.env.VWORLD_KEY;   // 지도 탭 폴리곤 수집용
const ODCLOUD_ENDPOINT = "https://api.odcloud.kr/api/15144631/v1/uddi:4b08ea19-5d8e-4050-99a6-bf6905c56b06";
const PER_PAGE = 1000;
const CONCURRENCY = 5;   // 상류 API 초당 한도 고려

// VWorld 연속지적도 — 좌표 기반 단일 필지 폴리곤 조회
const VWORLD_DATA_URL = "https://api.vworld.kr/req/data";
const VWORLD_GEO_URL  = "https://api.vworld.kr/req/address";
const VWORLD_DOMAIN = "https://donggu-building.vercel.app";
const GEO_CONCURRENCY = 6;   // VWorld 지적도 호출 동시성

// 좌표(POINT) → VWorld 연속지적도 필지 폴리곤. 실패/없음 → null
async function parcelGeometryByCoord(lon, lat) {
  if (!VWORLD_KEY) return null;
  const params = new URLSearchParams({
    service: "data", request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",
    geomFilter: `POINT(${lon} ${lat})`,
    crs: "EPSG:4326", format: "json", size: "10",
    key: VWORLD_KEY, domain: VWORLD_DOMAIN,
  });
  try {
    const r = await fetchWithTimeout(`${VWORLD_DATA_URL}?${params}`, { timeout: 10000 });
    if (!r.ok) return null;
    const data = await r.json();
    if (data?.response?.status !== "OK") return null;
    const feats = data?.response?.result?.featureCollection?.features || [];
    if (!feats.length) return null;
    const p = feats[0].properties || {};
    return { pnu: String(p.pnu || ""), geometry: feats[0].geometry || null };
  } catch {
    return null;
  }
}

// VWorld geocoder — 주소 → 정확한 좌표. 단독주택 좌표가 거대 집합 필지의
// 대표점인 경우가 많아 좌표 기반 조회만으로는 엉뚱한 큰 폴리곤이 잡힘.
// 지번주소를 geocoder로 변환한 좌표를 쓰면 정확한 단일 필지를 잡을 수 있음.
// parcel 타입이 실패할 때(오래된 지번/지번 체계 불일치) 도로명(road)으로 폴백.
async function geocodeAddress(addr, type) {
  if (!VWORLD_KEY || !addr) return null;
  const params = new URLSearchParams({
    service: "address", request: "getcoord", crs: "epsg:4326",
    address: addr, format: "json", type, key: VWORLD_KEY,
  });
  try {
    const r = await fetchWithTimeout(`${VWORLD_GEO_URL}?${params}`, { timeout: 10000 });
    if (!r.ok) return null;
    const data = await r.json();
    if (data?.response?.status !== "OK") return null;
    const pt = data?.response?.result?.point;
    if (!pt || !pt.x || !pt.y) return null;
    return { x: Number(pt.x), y: Number(pt.y) };
  } catch {
    return null;
  }
}

// 지번(parcel) 우선, 실패 시 도로명(road) 폴백. 둘 다 시도해 정확 좌표 획득 확률을 높임.
async function geocodeJibun(jibunAddr, doroAddr) {
  // 1순위: 지번주소 (parcel)
  const p1 = await geocodeAddress(jibunAddr, "parcel");
  if (p1) return p1;
  // 2순위: 도로명주소 (road) — 지번이 오래되었거나 체계가 바뀐 경우 유효
  if (doroAddr) return await geocodeAddress(doroAddr, "road");
  return null;
}

// 폴리곤의 최대 폭(m) 계산 — 단독/다세대 빈집은 보통 수십 m 이하.
// 거대 집합 필지(하천/공원 부지 등)가 잡히면 100m를 초과하므로 이를 가드로 사용.
function polygonMaxDimM(geometry) {
  if (!geometry || !geometry.coordinates) return 0;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let maxDim = 0;
  const COS = Math.cos(35.15 * Math.PI / 180);
  for (const poly of polys) {
    const ring = poly[0];
    if (!ring || !ring.length) continue;
    const lats = ring.map(c => c[1]), lngs = ring.map(c => c[0]);
    const latM = (Math.max(...lats) - Math.min(...lats)) * 111000;
    const lngM = (Math.max(...lngs) - Math.min(...lngs)) * 111000 * COS;
    maxDim = Math.max(maxDim, latM, lngM);
  }
  return maxDim;
}
const POLYGON_MAX_DIM_LIMIT = 100;  // 단독/다세대 빈집 폴리곤 상한(m). 초과하면 거대 필지로 판정해 폐기

// 빈집 1건 → 폴리곤. geocoder(지번→도로명 폴백) 우선, 실패/거대폴리곤 시 원본 좌표 폴백.
// 거대 폴리곤(집합 필지 대표점)이 잡히면 폐기하고 다음 우선순위를 시도한다.
async function parcelForVacant(o) {
  // 1순위: geocoder(지번 → 도로명 폴백) → 정확 좌표 → POINT 조회
  if (o.jibun || o.doro) {
    const pt = await geocodeJibun(o.jibun, o.doro);
    if (pt) {
      const g = await parcelGeometryByCoord(pt.x, pt.y);
      if (g && g.geometry) {
        if (polygonMaxDimM(g.geometry) <= POLYGON_MAX_DIM_LIMIT) { g._viaGeo = true; return g; }
        // 거대 폴리곤이면 폐기 후 2순위로
      }
    }
  }
  // 2순위: 원본 EPSG:5181 좌표 → WGS84 변환 → POINT 조회 (거대 폴리곤이면 null)
  const rx = Number(o.x) || 0, ry = Number(o.y) || 0;
  if (rx && ry) {
    const { lon, lat } = toWGS84(rx, ry);
    const g = await parcelGeometryByCoord(lon, lat);
    if (g && g.geometry && polygonMaxDimM(g.geometry) <= POLYGON_MAX_DIM_LIMIT) return g;
  }
  return null;
}

// odcloud "빈집 현황" 데이터 좌표계는 EPSG:5181 (Korea 2000 / Southern Belt)
const EPSG_5181 = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs";

// 동구 행정동 목록 (haengjeong.json 기준)
const DONGGU_HDONGS = new Set([
  "충장동", "서남동", "동명동", "지산1동", "산수1동",
  "계림2동", "계림1동", "산수2동", "지산2동", "학동",
  "지원1동", "지원2동", "학운동",
]);

const EXCEL_PATH = join(ROOT, "data", "vacant-supplement.xlsx");
const EXCEL_META_PATH = join(ROOT, "data", "vacant-supplement-meta.json");
const STALE_FLAG_PATH = join(ROOT, "data", ".vacant-excel-stale");

function fetchWithTimeout(url, opts = {}) {
  const { timeout = 10000, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal, ...rest }).finally(() => clearTimeout(timer));
}

async function fetchAllVacant() {
  if (!ODCLOUD_SERVICE_KEY) throw new Error("ODCLOUD_SERVICE_KEY 환경변수 필요");
  const all = [];
  let page = 1;
  while (true) {
    const url = `${ODCLOUD_ENDPOINT}?page=${page}&perPage=${PER_PAGE}&serviceKey=${encodeURIComponent(ODCLOUD_SERVICE_KEY)}`;
    const r = await fetchWithTimeout(url, { timeout: 20000 });
    if (!r.ok) throw new Error(`odcloud HTTP ${r.status}`);
    const data = await r.json();
    if (data?.errMsg || data?.returnAuthMsg) {
      throw new Error(`odcloud 오류: ${data.errMsg || data.returnAuthMsg}`);
    }
    const rows = Array.isArray(data?.data) ? data.data : [];
    all.push(...rows);
    const total = Number(data?.totalCount || 0);
    if (rows.length < PER_PAGE || all.length >= total) break;
    page++;
  }
  return all;
}

// EPSG:5181 (odcloud) → EPSG:4326 (WGS84) 변환
// rawX: odcloud '위도' 필드 (실제 X), rawY: odcloud '경도' 필드 (실제 Y)
function toWGS84(rawX, rawY) {
  const [lon, lat] = proj4(EPSG_5181, "WGS84", [rawX, rawY]);
  return { lon, lat };
}

// ───────────────────────────────────────────────
// 1차: 엑셀 보강 파일
// ───────────────────────────────────────────────
function dongFromJibun(jibun) {
  const m = String(jibun || "").match(/동구\s+([가-힣]+(?:\d+가)?)/);
  return m ? m[1] : "";
}

function readExcelSupplement() {
  const wb = xlsx.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(ws, { header: 1 });
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r) continue;
    const jibun = String(r[2] || "").trim();
    const doro = String(r[3] || "").trim();
    const hdong = String(r[4] || "").trim();
    const tarea = Number(r[10] || 0);
    const struct = String(r[7] || "").trim();
    const grade = String(r[13] || "").trim();
    if (!jibun || !hdong) continue;
    const dong = dongFromJibun(jibun);
    if (!dong) continue;
    rows.push({ dong, hdong, jibun, doro, tarea, struct, grade });
  }
  return rows;
}

function buildExcelMap(excelRows) {
  const map = new Map();
  for (const r of excelRows) {
    const key = `${r.dong}|${r.tarea}|${r.struct}|${r.grade}`;
    if (!map.has(key)) map.set(key, { hdong: r.hdong, jibun: r.jibun, doro: r.doro });
  }
  return map;
}

function matchFromExcel(row, excelMap) {
  const dong = String(row["읍면동명"] || "").trim();
  const tarea = Number(row["연면적"] || 0);
  const struct = String(row["건축물대장주구조"] || "").trim();
  const grade = String(row["등급판정결과"] || "").trim();
  if (!dong || !tarea) return null;
  const key = `${dong}|${tarea}|${struct}|${grade}`;
  return excelMap.get(key) || null;
}

function hdongFromExcel(row, excelMap) {
  return matchFromExcel(row, excelMap)?.hdong || "";
}

// ───────────────────────────────────────────────
// 2차: 카카오
// ───────────────────────────────────────────────
async function addrFromCoord(lon, lat) {
  if (!KAKAO_REST_API_KEY) throw new Error("KAKAO_REST_API_KEY 환경변수 필요");
  const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${encodeURIComponent(lon)}&y=${encodeURIComponent(lat)}`;
  const r = await fetchWithTimeout(url, {
    timeout: 10000,
    headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
  });
  if (!r.ok) throw new Error(`Kakao coord2address HTTP ${r.status}`);
  const data = await r.json();
  const docs = Array.isArray(data?.documents) ? data.documents : [];
  if (!docs.length) return { jibun: "", doro: "" };
  const doc = docs[0];
  const jibun = String(doc.address?.address_name || "")
    .replace(/전남광주통합특별시/g, "광주광역시")
    .trim();
  const doro = String(doc.road_address?.address_name || "")
    .replace(/전남광주통합특별시/g, "광주광역시")
    .trim();
  return { jibun, doro };
}

async function hdongFromAddress(addr) {
  if (!addr) return "";
  if (!KAKAO_REST_API_KEY) throw new Error("KAKAO_REST_API_KEY 환경변수 필요");
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addr)}`;
  const r = await fetchWithTimeout(url, {
    timeout: 10000,
    headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
  });
  if (!r.ok) throw new Error(`Kakao search/address HTTP ${r.status}`);
  const data = await r.json();
  const docs = Array.isArray(data?.documents) ? data.documents : [];
  if (!docs.length) return "";
  return String(docs[0].address?.region_3depth_h_name || "").trim();
}

async function resolveFromKakao(lon, lat) {
  const { jibun, doro } = await addrFromCoord(lon, lat);
  if (!jibun) return { hdong: "", jibun: "", doro: "" };
  const hdong = await hdongFromAddress(jibun);
  return { hdong, jibun, doro };
}

// ───────────────────────────────────────────────
// 3차: 행안부 + 카카오
// ───────────────────────────────────────────────
async function addrFromJuso(dong) {
  if (!JUSO_CONFM_KEY) throw new Error("JUSO_CONFM_KEY 환경변수 필요");
  const query = `전남광주통합특별시 동구 ${dong}`;
  const url = `https://business.juso.go.kr/addrlink/addrLinkApi.do?keyword=${encodeURIComponent(query)}&resultType=json&confmKey=${encodeURIComponent(JUSO_CONFM_KEY)}`;
  const r = await fetchWithTimeout(url, { timeout: 15000 });
  if (!r.ok) throw new Error(`Juso addrLinkApi HTTP ${r.status}`);
  const data = await r.json();
  const common = data?.results?.common || {};
  if (common.errorCode !== "0" && common.errorCode !== 0) {
    throw new Error(`Juso addrLinkApi 오류: ${common.errorMessage || common.errorCode}`);
  }
  const juso = Array.isArray(data?.results?.juso) ? data.results.juso[0] : null;
  if (!juso) return { jibun: "", doro: "" };
  const sggNm = String(juso.sggNm || "").trim();
  const emdNm = String(juso.emdNm || "").trim();
  const lnbrMnnm = String(juso.lnbrMnnm || "").trim();
  const lnbrSlno = String(juso.lnbrSlno || "0").trim();
  const roadAddr = String(juso.roadAddr || "").trim();
  const jibunAddr = String(juso.jibunAddr || "").trim();
  if (!sggNm || !emdNm || !lnbrMnnm) return { jibun: "", doro: "" };
  const sub = lnbrSlno && lnbrSlno !== "0" ? `-${lnbrSlno}` : "";
  const jibun = jibunAddr || `광주광역시 ${sggNm} ${emdNm} ${lnbrMnnm}${sub}`;
  const doro = roadAddr.replace(/전남광주통합특별시/g, "광주광역시").trim();
  return { jibun, doro };
}

async function resolveFromJuso(dong) {
  const { jibun, doro } = await addrFromJuso(dong);
  if (!jibun) return { hdong: "", jibun: "", doro: "" };
  const hdong = await hdongFromAddress(jibun);
  return { hdong, jibun, doro };
}

// ───────────────────────────────────────────────
// 유틸
// ───────────────────────────────────────────────
async function runPool(items, fn, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { __error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function loadManualOverrides() {
  try {
    const text = await readFile(join(ROOT, "vacantlist_manual.json"), "utf8");
    const data = JSON.parse(text);
    const map = new Map();
    for (const item of (Array.isArray(data) ? data : [])) {
      const x = Number(item.x);
      const y = Number(item.y);
      if (x && y && item.hdong) {
        map.set(`${x},${y}`, String(item.hdong).trim());
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

async function checkExcelStale() {
  let meta = null;
  try {
    const text = await readFile(EXCEL_META_PATH, "utf8");
    meta = JSON.parse(text);
  } catch {
    console.warn("⚠️ data/vacant-supplement-meta.json 파일을 찾을 수 없습니다.");
    return;
  }
  const baseDate = meta?.baseDate;
  if (!baseDate) {
    console.warn("⚠️ data/vacant-supplement-meta.json에 baseDate가 없습니다.");
    return;
  }
  const base = new Date(baseDate);
  if (isNaN(base.getTime())) {
    console.warn(`⚠️ baseDate 형식이 잘못되었습니다: ${baseDate}`);
    return;
  }
  const now = new Date();
  const days = (now - base) / (1000 * 60 * 60 * 24);
  if (days > 365) {
    const msg = `엑셀 보강 데이터가 ${Math.floor(days)}일 전(${baseDate}) 기준입니다. 새로운 엑셀 파일(data/vacant-supplement.xlsx)과 메타 파일(data/vacant-supplement-meta.json)을 교체하세요.`;
    console.warn(`⚠️ ${msg}`);
    await writeFile(STALE_FLAG_PATH, `EXCEL_STALE\nbaseDate=${baseDate}\ndaysOld=${Math.floor(days)}\nmessage=${msg}\n`, "utf8");
  } else {
    // stale flag 파일 제거 (정상 상태)
    try { await writeFile(STALE_FLAG_PATH, "", "utf8"); } catch {}
  }
}

// ───────────────────────────────────────────────
// main
// ───────────────────────────────────────────────
async function main() {
  if (!ODCLOUD_SERVICE_KEY) {
    console.error("ODCLOUD_SERVICE_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }
  if (!KAKAO_REST_API_KEY) {
    console.error("KAKAO_REST_API_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }
  if (!JUSO_CONFM_KEY) {
    console.error("JUSO_CONFM_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  console.log("odcloud 빈집 데이터 수집 중...");
  const rows = await fetchAllVacant();
  console.log(`odcloud 총 ${rows.length}건`);

  console.log("엑셀 보강 데이터 로드 중...");
  const excelRows = readExcelSupplement();
  console.log(`엑셀 보강 row 수: ${excelRows.length}건`);
  const excelMap = buildExcelMap(excelRows);
  console.log(`엑셀 고유 매칭 키 수: ${excelMap.size}건`);

  await checkExcelStale();

  const manualMap = await loadManualOverrides();
  if (manualMap.size) {
    console.log(`수동 보정 파일: ${manualMap.size}건 로드`);
  }

  console.log("1차: 엑셀 보강 매칭 중...");
  const stage1 = rows.map((row, i) => {
    const matched = matchFromExcel(row, excelMap);
    const hdong = matched?.hdong || "";
    if (i % 100 === 0) {
      console.log(`  [1차] ${i + 1}/${rows.length} - ${hdong || "(미확인)"}`);
    }
    return matched || { hdong: "", jibun: "", doro: "" };
  });

  let stage1Ok = 0;
  let stage1NeedsFallback = 0;
  for (let i = 0; i < rows.length; i++) {
    const hdong = stage1[i].hdong;
    if (hdong && DONGGU_HDONGS.has(hdong)) stage1Ok++;
    else stage1NeedsFallback++;
  }
  console.log(`  1차 결과: 성공 ${stage1Ok}건 / 2차 대상 ${stage1NeedsFallback}건`);

  console.log("2차: 카카오 좌표 → 행정동 매핑 중...");
  const stage2 = await runPool(rows, async (row, i) => {
    const hdong1 = stage1[i].hdong;
    if (hdong1 && DONGGU_HDONGS.has(hdong1)) return stage1[i];

    const rawX = Number(row["위도"] || 0);
    const rawY = Number(row["경도"] || 0);
    if (!rawX || !rawY) return { hdong: "", jibun: "", doro: "" };
    try {
      const { lon, lat } = toWGS84(rawX, rawY);
      const result = await resolveFromKakao(lon, lat);
      if (i % 100 === 0) {
        console.log(`  [2차] ${i + 1}/${rows.length} - ${result.hdong || "(미확인)"}`);
      }
      return result;
    } catch (e) {
      console.error(`  [${i + 1}/${rows.length}] 2차 실패: ${e.message}`);
      return { hdong: "", jibun: "", doro: "" };
    }
  }, CONCURRENCY);

  let stage2Ok = stage1Ok;
  let stage2NeedsFallback = 0;
  for (let i = 0; i < rows.length; i++) {
    const hdong = stage2[i].hdong;
    if (hdong && DONGGU_HDONGS.has(hdong)) {
      const hdong1 = stage1[i].hdong;
      if (!hdong1 || !DONGGU_HDONGS.has(hdong1)) stage2Ok++;
    } else {
      stage2NeedsFallback++;
    }
  }
  console.log(`  2차 결과: 성공 ${stage2Ok}건 / 3차 대상 ${stage2NeedsFallback}건`);

  console.log("3차: 행안부 + 카카오 행정동 매핑 중...");
  const stage3 = await runPool(rows, async (row, i) => {
    const hdong2 = stage2[i].hdong;
    if (hdong2 && DONGGU_HDONGS.has(hdong2)) return stage2[i];

    const dong = String(row["읍면동명"] || "").trim();
    if (!dong) return { hdong: "", jibun: "", doro: "" };
    try {
      const result = await resolveFromJuso(dong);
      if (i % 100 === 0) {
        console.log(`  [3차] ${i + 1}/${rows.length} - ${result.hdong || "(미확인)"}`);
      }
      return result;
    } catch (e) {
      console.error(`  [${i + 1}/${rows.length}] 3차 실패: ${e.message}`);
      return { hdong: "", jibun: "", doro: "" };
    }
  }, CONCURRENCY);

  let mapped = 0;
  let finalFail = 0;
  const out = rows.map((row, i) => {
    const tarea = Number(row["연면적"] || 0);
    const year = Number(row["건축년도"] || 0);
    const rawX = Number(row["위도"] || 0);
    const rawY = Number(row["경도"] || 0);

    let { hdong, jibun, doro } = stage3[i];
    if (hdong && !DONGGU_HDONGS.has(hdong)) hdong = "";

    const manual = manualMap.get(`${rawX},${rawY}`);
    if (manual) hdong = manual;

    if (hdong) mapped++;
    else finalFail++;

    return {
      dong: String(row["읍면동명"] || "").trim(),
      kind: String(row["주택유형"] || "").trim(),
      year: year > 0 ? year : null,
      struct: String(row["건축물대장주구조"] || "").trim(),
      tarea: Number.isFinite(tarea) ? tarea : 0,
      grade: String(row["등급판정결과"] || "").trim(),
      baseDate: String(row["데이터기준일자"] || "").trim(),
      x: rawX || null,
      y: rawY || null,
      hdong,
      jibun,
      doro,
    };
  });

  const outputPath = join(ROOT, "vacantlist_donggu.json");
  await writeFile(outputPath, JSON.stringify(out, null, " ") + "\n", "utf8");

  let withJibun = 0;
  let withDoro = 0;
  for (const o of out) {
    if (o.jibun) withJibun++;
    if (o.doro) withDoro++;
  }
  console.log(`\n완료: ${out.length}건 저장`);
  console.log(`  1차(엑셀) 성공: ${stage1Ok}건`);
  console.log(`  2차(카카오) 추가 성공: ${stage2Ok - stage1Ok}건`);
  console.log(`  3차(행안부+카카오) 추가 성공: ${mapped - stage2Ok}건`);
  console.log(`  최종 매핑 성공: ${mapped}건 / 실패: ${finalFail}건`);
  console.log(`  지번 주소 확보: ${withJibun}건 / 도로명 주소 확보: ${withDoro}건`);
  console.log(`저장 경로: ${outputPath}`);

  // ───────────────────────────────────────────────
  // 지도 탭용: 빈집 폴리곤 사전 수집 → vacant_geo.json
  // 빈집 원본 좌표(EPSG:5181)는 건물이 아닌 거대 집합 필지의 대표점인 경우가 많아
  // 좌표 기반 POINT 조회만으로는 엉뚱한 큰 폴리곤이 잡힘.
  // 따라서 지번주소(jibun)를 VWorld geocoder로 정확 좌표로 변환 후 POINT 조회(1순위)하고,
  // 실패 시 원본 EPSG:5181 좌표 → WGS84 폴백(2순위).
  // ───────────────────────────────────────────────
  if (VWORLD_KEY) {
    console.log("\n지도 탭용 빈집 폴리곤 수집 중...");
    const geoInput = out
      .map((o, i) => ({ i, o }))
      .filter(it => it.o.jibun || (Number(it.o.x) && Number(it.o.y)));
    console.log(`  폴리곤 수집 대상: ${geoInput.length}건 (지번/좌표 보유)`);
    const geoResults = await runPool(geoInput, async (it) => {
      const g = await parcelForVacant(it.o);
      if (it.i % 100 === 0) console.log(`  [폴리곤] ${it.i + 1}/${out.length}`);
      return g;
    }, GEO_CONCURRENCY);

    const geoOut = [];
    let geoOk = 0, byGeo = 0, byCoord = 0;
    for (let k = 0; k < geoInput.length; k++) {
      const it = geoInput[k];
      const o = it.o;
      const g = geoResults[k];
      if (g && g.geometry) {
        geoOk++;
        if (o.jibun && g._viaGeo) byGeo++; else byCoord++;
        geoOut.push({
          pnu: g.pnu,
          dong: o.dong, hdong: o.hdong, kind: o.kind,
          year: o.year, struct: o.struct, tarea: o.tarea,
          grade: o.grade, jibun: o.jibun, doro: o.doro,
          geometry: g.geometry,
        });
      }
    }
    const geoPath = join(ROOT, "vacant_geo.json");
    await writeFile(geoPath, JSON.stringify(geoOut, null, " ") + "\n", "utf8");
    console.log(`  빈집 폴리곤 수집: ${geoOk}건 / ${out.length}건 (geocoder ${byGeo} / 좌표폴백 ${byCoord})`);
    console.log(`  저장 경로: ${geoPath}`);
  } else {
    console.log("\nVWORLD_KEY 없음 — 빈집 폴리곤 수집 생략");
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
