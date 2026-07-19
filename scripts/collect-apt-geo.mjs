// scripts/collect-apt-geo.mjs
// 공동주택 단지들의 PNU → VWorld 연속지적도 필지 폴리곤을 수집해 apt_geo.json 생성.
// 지도 탭에서 공동주택 영역을 색으로 식별하기 위한 정적 데이터.
//
// 소스(모두 PNU를 가짐):
//   1) aptlist_donggu.json        (K-apt 60개 단지 — kaptCode/kaptName/bass/dtl 보유)
//   2) aptlist_odcloud_donggu.json (한국부동산원 38개 단지)
//   3) aptlist_extra_donggu.json   (수동 추가 2개 단지)
//   4) 한국부동산원 getAptInfo(아파트/연립/다세대 — 누락 보충 + 단지명 보강) + 건축물대장(오피스텔/도시형 보충)
// PNU 중복 제거 후 VWorld ?pnu= 로 폴리곤 조회. 실패 건은 스킵.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const VWORLD_KEY = process.env.VWORLD_KEY;
const VWORLD_URL = "https://api.vworld.kr/req/data";
const VWORLD_GEOCODE_URL = "https://api.vworld.kr/req/address";
const DOMAIN = "https://donggu-building.vercel.app";
const CONCURRENCY = 6;
const pnuRe = /^\d{19}$/;
// VWorld 연속지적도는 신규 시군구코드(12210)만 인식. 구 코드(29110) 정규화.
const pnuForVWorld = (pnu) => pnu.startsWith("29110") ? "12210" + pnu.slice(5) : pnu;

// 건축물대장(getBrTitleInfo)으로 보충 수집할 주용도 — 아파트 외 공동주택 계열
// 표제부의 mainPurpsCdNm은 항상 "공동주택"이고, 세부 종류는 etcPurps에 있음.
// etcPurps에서 추출 가능한 종류 키워드 — 아파트는 K-apt/odcloud/getAptInfo가 이미 커버하므로 제외.
const BLD_KIND_KEYWORDS = ["연립", "다세대", "오피스텔", "도시형"];
const BLD_SERVICE_KEY = process.env.BLD_SERVICE_KEY;
const BLD_HUB = "https://apis.data.go.kr/1613000/BldRgstHubService";
const SIGUNGU = "29110";
const ALL_BJD = ["10100","10200","10300","10400","10500","10600","10700","10800","10900","11000","11100","11200","11300","11400","11500","11600","11700","11800","11900","12000","12100","12200","12300","12400","12500","12600","12700","12800","12900","13000","13100","13200","13300","13400"];

// 한국부동산원 공동주택 단지 식별정보(getAptInfo) — K-apt·odcloud에 미등록인 구형
// 소규모 단지(대명아파트 등) PNU 보충 + 건축물대장에 이름이 없는 단지(고려원룸 등) 이름 보강.
// 공동주택 관리 탭과 동일 소스. 응답 PNU는 구 시군구코드(29110) 기준. 키는 api/aptid.js와 동일 체인.
const APT_SERVICE_KEY = process.env.APT_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
const APTID_BASE = "https://api.odcloud.kr/api/AptIdInfoSvc/v1";
const APTID_SIGUNGU = "광주광역시 동구";

function fetchWithTimeout(url, opts = {}) {
  const { timeout = 10000, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal, ...rest }).finally(() => clearTimeout(timer));
}

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

async function loadJson(p) {
  try { return JSON.parse(await readFile(join(ROOT, p), "utf8")); }
  catch { return []; }
}

// PNU → VWorld 연속지적도 필지 폴리곤. 없으면 null
// attrFilter '=' 연산자는 URLSearchParams 인코딩 문제로 동작하지 않아 LIKE 사용 (PNU 19자리 고정=정확매칭)
async function parcelGeometryByPNU(pnu) {
  const params = new URLSearchParams({
    service: "data", request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",
    attrFilter: `pnu:LIKE:${pnuForVWorld(pnu)}`,
    crs: "EPSG:4326", format: "json", size: "10",
    key: VWORLD_KEY, domain: DOMAIN,
  });
  try {
    const r = await fetchWithTimeout(`${VWORLD_URL}?${params}`, { timeout: 10000 });
    if (!r.ok) return null;
    const data = await r.json();
    if (data?.response?.status !== "OK") return null;
    const feats = data?.response?.result?.featureCollection?.features || [];
    if (!feats.length) return null;
    const p = feats[0].properties || {};
    // VWorld jibun 속성은 "1869 대"처럼 번지+토지구분(대/산) 접미사를 포함 → 접미사 제거
    return { pnu: String(p.pnu || pnu), addr: p.addr || "", jibun: String(p.jibun || "").replace(/\s+(대|산)$/, ""), geometry: feats[0].geometry || null };
  } catch {
    return null;
  }
}

// 폴리곤 면적(m²) 근사 계산. 신축 단지처럼 폴리곤이 실제 대지보다 지나치게 작은지 판별용.
// 정확값이 아니어도 과소 여부(예: 391m² 폴리곤 vs 실제 단지 수천m²) 판단엔 충분.
function polygonAreaM2(geom) {
  if (!geom || !geom.coordinates) return 0;
  let outer;
  try {
    outer = geom.type === "MultiPolygon" ? geom.coordinates[0][0] : geom.coordinates[0];
  } catch { return 0; }
  if (!Array.isArray(outer) || outer.length < 3) return 0;
  const lat0 = (outer[0][1] || 35.14) * Math.PI / 180;
  const mLng = 111320 * Math.cos(lat0);
  const mLat = 111320;
  let area = 0;
  for (let i = 0; i < outer.length - 1; i++) {
    const [x1, y1] = outer[i];
    const [x2, y2] = outer[i + 1];
    area += x1 * mLng * y2 * mLat - x2 * mLng * y1 * mLat;
  }
  return Math.abs(area) / 2;
}

// 도로명주소 → VWorld 지오코더 좌표 {x, y} | null
// 신축 단지는 VWorld 연속지적도에 폴리곤이 없거나 잔여 필지만 잡혀 너무 작게 표시되므로,
// 도로명주소 기준 점(Point) 마커로 폴백하기 위함.
async function geocodeRoadAddr(roadAddr) {
  if (!roadAddr) return null;
  const params = new URLSearchParams({
    service: "address", request: "getcoord", crs: "epsg:4326",
    address: roadAddr, format: "json", type: "road", key: VWORLD_KEY,
  });
  try {
    const r = await fetchWithTimeout(`${VWORLD_GEOCODE_URL}?${params}`, { timeout: 10000 });
    if (!r.ok) return null;
    const data = await r.json();
    if (data?.response?.status !== "OK") return null;
    const pt = data?.response?.result?.point;
    return pt && pt.x && pt.y ? { x: Number(pt.x), y: Number(pt.y) } : null;
  } catch { return null; }
}

// 폴리곤이 비었거나 비정상적으로 작으면(신축 단지 등) 도로명 좌표 Point로 폴백.
// 반환값: { geometry, addr, jibun, marker } — marker=true면 점 마커 표시용.
const POLYGON_TOO_SMALL_M2 = 1000;  // 단지 대지치고는 비정상적으로 작은 임계
async function resolveGeometry(c, parcelGeom) {
  const area = polygonAreaM2(parcelGeom?.geometry);
  if (parcelGeom?.geometry && area >= POLYGON_TOO_SMALL_M2) {
    return { geometry: parcelGeom.geometry, addr: parcelGeom.addr || "", jibun: parcelGeom.jibun || "", marker: false };
  }
  // 폴리곤 누락/과소 → 도로명으로 점 좌표 폴백
  const roadAddr = c.doroAddr || c.adres || "";
  if (roadAddr) {
    const pt = await geocodeRoadAddr(roadAddr);
    if (pt) {
      console.log(`  [Point 폴백] ${c.complexNm || c.pnu} — 폴리곤 ${area ? area.toFixed(0) + "m²(과소)" : "없음"} → 도로명 좌표 (${pt.x.toFixed(5)},${pt.y.toFixed(5)})`);
      return { geometry: { type: "Point", coordinates: [pt.x, pt.y] }, addr: roadAddr, jibun: c.jibun || parcelGeom?.jibun || "", marker: true };
    }
  }
  // 도로명도 없으면 폴리곤이 있더라도 과소면 버리고, 정상 폴리곤이면 유지
  if (parcelGeom?.geometry && area > 0 && area < POLYGON_TOO_SMALL_M2) {
    console.log(`  [제외] ${c.complexNm || c.pnu} — 폴리곤 ${area.toFixed(0)}m²(과소) & 도로명 폴백 실패`);
    return null;
  }
  return parcelGeom?.geometry
    ? { geometry: parcelGeom.geometry, addr: parcelGeom.addr || "", jibun: parcelGeom.jibun || "", marker: false }
    : null;
}

// 단지 종류 정규화 — 지도 색상 분류용.
// codeAptNm(K-apt 원본) 또는 etcPurps(건축물대장 원본 세부용도)를 우선 적용.
// 주상복합은 대단지 아파트(그랜드센트럴 등)인 경우가 많아 아파트로 분류.
function normalizeKind(rawClass, kind) {
  const k = (rawClass || kind || "").replace(/\s+/g, "");
  if (k.includes("아파트")) return "아파트";
  if (k.includes("주상복합")) return "아파트";
  if (k.includes("연립")) return "연립";
  if (k.includes("다세대")) return "다세대";
  if (k.includes("오피스텔")) return "오피스텔";
  if (k.includes("도시형")) return "도시형생활주택";
  return kind || "기타";
}

// 건축물대장 표제부(getBrTitleInfo) 동단위 페이지 조회 → { titles, totalCount }
async function fetchBldTitlePage(bjd, pageNo) {
  if (!BLD_SERVICE_KEY) return { titles: [], totalCount: 0 };
  const qs = new URLSearchParams({
    serviceKey: BLD_SERVICE_KEY,
    sigunguCd: SIGUNGU, bjdongCd: bjd,
    numOfRows: "1000", pageNo: String(pageNo), _type: "json",
  });
  const url = `${BLD_HUB}/getBrTitleInfo?${qs}`;
  try {
    const r = await fetchWithTimeout(url, { timeout: 15000 });
    const data = await r.json();
    const body = data?.response?.body;
    const items = body?.items?.item;
    const list = Array.isArray(items) ? items : (items ? [items] : []);
    return { titles: list, totalCount: Number(body?.totalCount || 0) };
  } catch { return { titles: [], totalCount: 0 }; }
}

// etcPurps(건축물대장 세부용도)에서 종류 키워드 추출.
// "다세대주택,사무실" → "다세대", "공동주택(다세대주택:4세대)" → "다세대" 등.
// 아파트/연립/다세대/오피스텔/도시형 중 첫 매칭. 대상 키워드 아니면 null.
function kindFromEtcPurps(etcPurps) {
  const s = String(etcPurps || "");
  for (const kw of ["연립", "다세대", "오피스텔", "도시형", "아파트"]) {
    if (s.includes(kw)) return normalizeKind(s.includes(kw + "주택") ? kw + "주택" : kw, "");
  }
  return null;
}

// 동구 전체 법정동을 훑어 연립/다세대/오피스텔/도시형 필지 PNU를 수집.
// 표제부 mainPurpsCdNm="공동주택" + 주건축물(mainAtchGbCdNm="주건축물")만 대상.
// 같은 필지(platGbCd+bun+ji)의 여러 동 표제부를 그룹화 → 세대수 합산, 대표 동명 선택.
async function collectLowriseFromBuilding() {
  if (!BLD_SERVICE_KEY) {
    console.log("  [건축물대장] BLD_SERVICE_KEY 미설정 — 연립/다세대/오피스텔 보충 생략");
    return [];
  }
  console.log("  [건축물대장] 연립/다세대/오피스텔 필지 수집 중...");
  const MAX_PAGES = 50;
  // 1페이지로 totalCount 파악
  const p1 = await runPool(ALL_BJD, async (bjd) => {
    const { titles, totalCount } = await fetchBldTitlePage(bjd, 1);
    return { bjd, titles, totalCount };
  }, 3);
  const more = [];
  const all = [];
  for (const r of p1) {
    all.push(...r.titles);
    const pageSize = Math.max(r.titles.length, 1);
    if (r.totalCount > pageSize) {
      const pages = Math.min(Math.ceil(r.totalCount / pageSize), MAX_PAGES);
      for (let pg = 2; pg <= pages; pg++) more.push({ bjd: r.bjd, pg });
    }
  }
  if (more.length) {
    const got = await runPool(more, async (t) => {
      const { titles } = await fetchBldTitlePage(t.bjd, t.pg);
      return titles;
    }, 3);
    for (const ts of got) if (Array.isArray(ts)) all.push(...ts);
  }

  // 공동주택 + 주건축물만 필터 → etcPurps에서 종류 추출 → 필지 단위 그룹화
  // pnuKey → { titles:[...], kind, hhld 합산 }
  const parcels = new Map();
  for (const t of all) {
    if ((t.mainPurpsCdNm || "").trim() !== "공동주택") continue;
    if ((t.mainAtchGbCdNm || "").trim() !== "주건축물") continue; // 경비실 등 부속 제외
    const kind = kindFromEtcPurps(t.etcPurps);
    if (!kind || !BLD_KIND_KEYWORDS.some(kw => kind.includes(kw))) continue;   // 아파트/기타는 스킵
    const bun = String(t.bun || "").padStart(4, "0");
    const ji  = String(t.ji  || "").padStart(4, "0");
    if (!bun || !ji) continue;
    // 건축물대장 platGbCd(0=대지)와 VWorld 연속지적도 platGb 자리는 매핑이 다름.
    // VWorld는 동구 전 필지가 platGb=1(블록)로 등록되어 있어 강제 1로 정규화.
    const pnu = `${SIGUNGU}${t.bjdongCd || ""}1${bun}${ji}`;
    if (!pnuRe.test(pnu)) continue;
    if (!parcels.has(pnu)) parcels.set(pnu, { titles: [], kind });
    parcels.get(pnu).titles.push(t);
  }

  // 필지별 집계: 세대수 합산, 가장 큰 동을 대표 bldNm으로, 사용승인일은 최솟값(가장 오래된)
  const out = [];
  for (const [pnu, { titles, kind }] of parcels) {
    let hhld = 0, bldNm = "", useAprDay = "", maxArea = -1;
    for (const t of titles) {
      hhld += Number(t.hhldCnt || 0);
      const area = Number(t.archArea || 0);
      if (area > maxArea) { maxArea = area; bldNm = String(t.bldNm || "").trim(); }
      const d = String(t.useAprDay || "").trim();
      if (d && (!useAprDay || d < useAprDay)) useAprDay = d;
    }
    out.push({
      pnu, bjdCode: `${SIGUNGU}${titles[0].bjdongCd || ""}`,
      dong: "", kind,
      hhld: hhld || null, useAprDay,
      bldNm, mainPurps: titles[0].etcPurps || "",
    });
  }
  console.log(`  [건축물대장] 수집 필지: ${out.length}건`);
  return out;
}

// 한국부동산원 공동주택 단지 식별정보(getAptInfo)에서 동구 전체 단지 보충.
// K-apt·odcloud·extra 정적 리스트는 구형 소규모 아파트(대명아파트 등)를 자주 누락하고,
// 건축물대장(source:bld)은 건물명이 없어 단지명이 종류명("다세대" 등)으로 빠지는 경우가 많음
// (고려원룸→"다세대" 등 130건). 공동주택 관리 탭이 사용하는 동일 라이브 소스로 단지명을 보강.
// COMPLEX_GB_CD: 1=아파트, 2=연립, 3=다세대. 오피스텔/도시형생활주택은 이 코드에 없어
// 기존 건축물대장 보충이 계속 담당. 응답 PNU는 구코드(29110) 기준이라 별도 정규화 불필요.
function gbCdToKind(gbCd) {
  if (gbCd === "1") return "아파트";
  if (gbCd === "2") return "연립";
  if (gbCd === "3") return "다세대";
  return "";
}

async function collectAptFromGetAptInfo() {
  if (!APT_SERVICE_KEY) {
    console.log("  [getAptInfo] APT_SERVICE_KEY 미설정 — 단지 보충 생략");
    return [];
  }
  console.log("  [getAptInfo] 동구 전체 단지(아파트/연립/다세대) 수집 중...");
  const params = new URLSearchParams({ page: "1", perPage: "1000", serviceKey: APT_SERVICE_KEY });
  // cond[ADRES::LIKE] 의 [ ] · : 는 URLSearchParams 가 인코딩하지만 odcloud 는 인코딩된
  // cond%5B...%5D 를 그대로 받으므로 수동 조립 (api/aptid.js 와 동일 패턴).
  const url = `${APTID_BASE}/getAptInfo?${params.toString()}&cond%5BADRES%3A%3ALIKE%5D=${encodeURIComponent(APTID_SIGUNGU)}`;
  let data;
  try {
    const r = await fetchWithTimeout(url, { timeout: 15000 });
    const text = await r.text();
    data = JSON.parse(text);
  } catch (e) {
    console.log(`  [getAptInfo] 호출 실패 — 보충 생략: ${String(e?.message || e).slice(0, 120)}`);
    return [];
  }
  if (data?.errMsg || data?.returnAuthMsg) {
    console.log(`  [getAptInfo] 인증/한도 오류 — 보충 생략: ${data.errMsg || data.returnAuthMsg}`);
    return [];
  }
  const rows = Array.isArray(data.data) ? data.data : [];
  // COMPLEX_GB_CD 1/2/3(아파트/연립/다세대)만. 오피스텔/도시형은 코드에 없어 제외.
  const out = rows
    .filter(d => {
      const kind = gbCdToKind(String(d.COMPLEX_GB_CD || "").trim());
      if (!kind) return false;
      return /^\d{19}$/.test(String(d.PNU || ""));
    })
    .map(d => ({
      pnu: String(d.PNU).trim(),
      bjdCode: `${SIGUNGU}${String(d.PNU).slice(5, 10)}`,
      dong: "",
      kind: gbCdToKind(String(d.COMPLEX_GB_CD || "").trim()),
      complexNm: String(d.COMPLEX_NM1 || d.COMPLEX_NM2 || d.COMPLEX_NM3 || "").trim(),
      hhld: Number(d.UNIT_CNT || 0) || null,
      useAprDay: String(d.USEAPR_DT || "").trim(),
      adres: String(d.ADRES || "").trim(),
    }));
  const kindStat = {};
  for (const r of out) kindStat[r.kind] = (kindStat[r.kind] || 0) + 1;
  console.log(`  [getAptInfo] 수집 단지: ${out.length}건 (전체 ${rows.length}건 중) kind별: ${JSON.stringify(kindStat)}`);
  return out;
}

async function main() {
  if (!VWORLD_KEY) {
    console.error("VWORLD_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  console.log("공동주택 단지 목록 로드 중...");
  const kapt = await loadJson("aptlist_donggu.json");
  const odcloud = await loadJson("aptlist_odcloud_donggu.json");
  const extra = await loadJson("aptlist_extra_donggu.json");
  console.log(`  K-apt: ${kapt.length} / odcloud: ${odcloud.length} / extra: ${extra.length}`);

  // 단위 단지 객체 통합 — PNU가 키. 동일 PNU면 풍부한 정보 우선(K-apt > extra > odcloud).
  const byPnu = new Map();
  for (const r of kapt) {
    const pnu = String(r.pnu || "").trim();
    if (!pnuRe.test(pnu)) continue;
    byPnu.set(pnu, {
      pnu, source: "kapt",
      complexNm: r.kaptName || "",
      bjdCode: r.bjdCode || "", dong: r.as3 || "",
      kind: normalizeKind(r.bass?.codeAptNm, ""),
      kaptCode: r.kaptCode || "",
      hhld: r.bass?.kaptdaCnt || null,
      useAprDay: r.bass?.kaptUsedate || "",
      strct: r.dtl?.struMain || r.bass?.codeStruNm || "",
      // K-apt 상세는 런타임에 lazy 로드되므로 여기선 최소값만. 상세카드에서 fetch.
    });
  }
  for (const r of extra) {
    const pnu = String(r.pnu || "").trim();
    if (!pnuRe.test(pnu) || byPnu.has(pnu)) continue;
    byPnu.set(pnu, {
      pnu, source: "extra",
      complexNm: r.complexNm || "",
      dong: "", kind: normalizeKind("", r.kind),
      hhld: r.hhld || null, useAprDay: r.useAprDay || "",
      grndFlr: r.grndFlr || null, ugrndFlr: r.ugrndFlr || null,
      parking: r.parking || null, tarea: r.tarea || null,
      doroAddr: r.doroAddr || "", adres: r.adres || "",
    });
  }
  for (const r of odcloud) {
    const pnu = String(r.pnu || "").trim();
    if (!pnuRe.test(pnu) || byPnu.has(pnu)) continue;
    byPnu.set(pnu, {
      pnu, source: "odcloud",
      complexNm: r.complexNm || "",
      kind: normalizeKind("", r.kind),
      hhld: r.hhld || null, useAprDay: r.useAprDay || "",
      doroAddr: r.doroAddr || "", adres: r.adres || "",
      officeTel: r.officeTel || "",
    });
  }

  // 한국부동산원 getAptInfo에서 아파트/연립/다세대 보충 + 단지명 보강.
  // K-apt·odcloud 미등록 구형 단지(대명아파트 등) 누락 보충과, 건축물대장(bld)에 건물명이
  // 없어 "다세대" 등으로 빠진 단지명(고려원룸 등)을 getAptInfo 이름으로 보강.
  // 정적 3소스(bld 보충 포함)보다 먼저 주입해 getAptInfo의 단지명/메타를 우선 반영.
  const aptid = await collectAptFromGetAptInfo();
  for (const r of aptid) {
    if (byPnu.has(r.pnu)) continue;   // 기존 단지 우선
    byPnu.set(r.pnu, {
      pnu: r.pnu, source: "aptid",
      bjdCode: r.bjdCode || "", dong: "",
      kind: r.kind,
      complexNm: r.complexNm || "",
      hhld: r.hhld || null, useAprDay: r.useAprDay || "",
      adres: r.adres || "",
    });
  }

  // 건축물대장에서 연립/다세대/오피스텔 보충 수집 (K-apt·odcloud는 아파트 중심이라 누락 방지)
  const lowrise = await collectLowriseFromBuilding();
  for (const r of lowrise) {
    if (byPnu.has(r.pnu)) continue;   // 기존 단지 우선
    byPnu.set(r.pnu, {
      ...r, source: "bld",
      complexNm: r.bldNm || r.kind || "",
    });
  }

  const complexes = [...byPnu.values()];
  console.log(`  고유 단지(PNU 기준): ${complexes.length}건`);
  // 소스별 통계
  const srcStat = {};
  for (const c of complexes) srcStat[c.source] = (srcStat[c.source] || 0) + 1;
  console.log("  소스별:", JSON.stringify(srcStat));

  console.log("VWorld 연속지적도 폴리곤 수집 중...");
  const pnus = complexes.map(c => c.pnu);
  const parcels = await runPool(pnus, async (pnu, i) => {
    const g = await parcelGeometryByPNU(pnu);
    if (i % 50 === 0) console.log(`  [폴리곤] ${i + 1}/${pnus.length}`);
    return g;
  }, CONCURRENCY);

  const out = [];
  let ok = 0;
  for (let i = 0; i < complexes.length; i++) {
    const c = complexes[i];
    const resolved = await resolveGeometry(c, parcels[i]);
    if (!resolved || !resolved.geometry) continue;
    ok++;
    const { geometry, addr, jibun, marker } = resolved;
    out.push({ ...c, addr: addr || "", jibun: jibun || "", geometry, ...(marker ? { marker: true } : {}) });
  }

  const outPath = join(ROOT, "apt_geo.json");

  // ── 데이터 무결성 가드 ──
  // VWorld 폴리곤 API가 대량 실패/차단되면 out이 비거나 급감할 수 있다.
  // 이전 커밋에서 빈 apt_geo.json([])이 머지되어 지도 탭 공동주택 조회가 동작하지 않았던
  // 회귀(0add14c) 재발 방지. 정상 케이스가 아니면 기존 파일을 덮어쓰지 않고 실패시킨다.
  if (out.length === 0) {
    console.error(`[가드] 수집 결과 0건 — VWorld 폴리곤 API 전체 실패로 추정. apt_geo.json을 덮어쓰지 않음 (complexes=${complexes.length}).`);
    process.exit(1);
  }
  // 기존 파일이 있으면 급감(이전의 50% 미만)도 차단 — 부분 장애 회귀 방지
  try {
    const prevRaw = await readFile(outPath, "utf8");
    const prev = JSON.parse(prevRaw);
    if (Array.isArray(prev) && prev.length > 0 && out.length < prev.length * 0.5) {
      console.error(`[가드] 수집 결과 급감: ${out.length}건 (이전 ${prev.length}건의 50% 미만). apt_geo.json을 덮어쓰지 않음.`);
      process.exit(1);
    }
  } catch { /* 기존 파일 없음/파싱 실패 → 신규 생성 허용 */ }

  await writeFile(outPath, JSON.stringify(out, null, " ") + "\n", "utf8");
  console.log(`\n완료: ${ok}건 / ${complexes.length}건`);
  // 최종 kind 분포
  const kindStat = {};
  for (const c of out) kindStat[c.kind] = (kindStat[c.kind] || 0) + 1;
  console.log("  kind 분포:", JSON.stringify(kindStat));
  console.log(`저장 경로: ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
