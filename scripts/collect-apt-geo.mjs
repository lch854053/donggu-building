// scripts/collect-apt-geo.mjs
// 공동주택 단지들의 PNU → VWorld 연속지적도 필지 폴리곤을 수집해 apt_geo.json 생성.
// 지도 탭에서 공동주택 영역을 색으로 식별하기 위한 정적 데이터.
//
// 소스(모두 PNU를 가짐):
//   1) aptlist_donggu.json        (K-apt 60개 단지 — kaptCode/kaptName/bass/dtl 보유)
//   2) aptlist_odcloud_donggu.json (한국부동산원 38개 단지)
//   3) aptlist_extra_donggu.json   (수동 추가 2개 단지)
// PNU 중복 제거 후 VWorld ?pnu= 로 폴리곤 조회. 실패 건은 스킵.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const VWORLD_KEY = process.env.VWORLD_KEY;
const VWORLD_URL = "https://api.vworld.kr/req/data";
const DOMAIN = "https://donggu-building.vercel.app";
const CONCURRENCY = 6;
const pnuRe = /^\d{19}$/;
// VWorld 연속지적도는 신규 시군구코드(12210)만 인식. 구 코드(29110) 정규화.
const pnuForVWorld = (pnu) => pnu.startsWith("29110") ? "12210" + pnu.slice(5) : pnu;

// 건축물대장(getBrTitleInfo)으로 보충 수집할 주용도 — 아파트 외 공동주택 계열
// 국토교통부 건축HUB 표제부 mainPurpsCdNm 값 기준
const BLD_PURPS_TARGETS = ["연립주택", "다세대주택", "오피스텔"];
const BLD_SERVICE_KEY = process.env.BLD_SERVICE_KEY;
const BLD_HUB = "https://apis.data.go.kr/1613000/BldRgstHubService";
const SIGUNGU = "29110";
const ALL_BJD = ["10100","10200","10300","10400","10500","10600","10700","10800","10900","11000","11100","11200","11300","11400","11500","11600","11700","11800","11900","12000","12100","12200","12300","12400","12500","12600","12700","12800","12900","13000","13100","13200","13300","13400"];

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
    return { pnu: String(p.pnu || pnu), addr: p.addr || "", jibun: p.jibun || "", geometry: feats[0].geometry || null };
  } catch {
    return null;
  }
}

// 단지 종류 정규화 — 지도 색상 분류용.
// codeAptNm(K-apt 원본 분류)을 우선 적용: 이미 변환된 kind 보다 원본이 신뢰.
// 주상복합은 대단지 아파트(그랜드센트럴 등)인 경우가 많아 아파트로 분류.
function normalizeKind(codeAptNm, kind) {
  const k = (codeAptNm || kind || "").replace(/\s+/g, "");
  if (k.includes("아파트")) return "아파트";
  if (k.includes("주상복합")) return "아파트";
  if (k.includes("연립")) return "연립";
  if (k.includes("다세대")) return "다세대";
  if (k.includes("오피스텔")) return "오피스텔";
  if (k.includes("도시형")) return "도시형생활주택";
  return kind || "기타";
}

// 건축물대장 표제부(getBrTitleInfo) 동단위 페이지 조회 → titles[]
async function fetchBldTitlePage(bjd, pageNo) {
  if (!BLD_SERVICE_KEY) return [];
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

// 동구 전체 법정동을 훑어 연립/다세대/오피스텔 필지 PNU를 수집.
// 같은 필지(platGbCd+bun+ji)에 여러 동/표제부가 있을 수 있어 필지 단위로 중복 제거.
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
  }, 5);
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
    }, 5);
    for (const ts of got) if (Array.isArray(ts)) all.push(...ts);
  }

  // 주용도 필터 + 필지 단위 PNU 수집
  const seen = new Map();   // pnu → { pnu, bjd, bun, ji, mainPurps, ... }
  const targetSet = new Set(BLD_PURPS_TARGETS);
  for (const t of all) {
    const purps = String(t.mainPurpsCdNm || "").trim();
    if (!targetSet.has(purps)) continue;
    const bun = String(t.bun || "").padStart(4, "0");
    const ji  = String(t.ji  || "").padStart(4, "0");
    if (!bun || !ji) continue;
    const platGb = String(t.platGbCd || "0");
    const pnu = `${SIGUNGU}${t.bjdongCd || ""}${platGb}${bun}${ji}`;
    if (!pnuRe.test(pnu) || seen.has(pnu)) continue;
    seen.set(pnu, {
      pnu, bjdCode: `${SIGUNGU}${t.bjdongCd || ""}`,
      dong: t.bjdongNm || "", kind: normalizeKind(purps, ""),
      hhld: t.hhld ? Number(t.hhld) : (t.houseHoldCnt ? Number(t.houseHoldCnt) : null),
      useAprDay: t.useAprDay || "",
      mainPurps: purps,
      bldNm: t.bldNm || "",
    });
  }
  console.log(`  [건축물대장] 수집 필지: ${seen.size}건`);
  return [...seen.values()];
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
  const geoms = await runPool(pnus, async (pnu, i) => {
    const g = await parcelGeometryByPNU(pnu);
    if (i % 50 === 0) console.log(`  [폴리곤] ${i + 1}/${pnus.length}`);
    return g;
  }, CONCURRENCY);

  const out = [];
  let ok = 0;
  for (let i = 0; i < complexes.length; i++) {
    const c = complexes[i];
    const g = geoms[i];
    if (!g || !g.geometry) continue;
    ok++;
    out.push({ ...c, addr: g.addr || "", jibun: g.jibun || "", geometry: g.geometry });
  }

  const outPath = join(ROOT, "apt_geo.json");
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
