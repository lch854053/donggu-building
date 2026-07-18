// scripts/merge-aptid-geo.mjs
// collect-apt-geo.mjs 를 BLD_SERVICE_KEY 없이 실행하면 연립/다세대/오피스텔(source:bld)이
// 전부 날아가는 문제가 있음. 이 스크립트는 기존 apt_geo.json을 그대로 둔 채 getAptInfo로
// 두 가지 작업을 증분 수행한다. 로컬(VWORLD_KEY + APT_SERVICE_KEY만 있는 환경)에서 사용.
//
// 동작:
//   1) 한국부동산원 getAptInfo 호출 → 동구 단지(COMPLEX_GB_CD 1/2/3 = 아파트/연립/다세대) 수집
//   2) [이름 보강] 기존 apt_geo.json 단지 중 이름이 비거나 종류명("다세대" 등)인 것을
//      getAptInfo 단지명(고려원룸 등)으로 갱신. kind도 getAptInfo 기준으로 정규화.
//   3) [신규 추가] 기존에 없는 PNU만 VWorld 폴리곤을 수집해 추가(source:"aptid")

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const VWORLD_KEY = process.env.VWORLD_KEY;
const APT_SERVICE_KEY = process.env.APT_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
const VWORLD_URL = "https://api.vworld.kr/req/data";
const APTID_BASE = "https://api.odcloud.kr/api/AptIdInfoSvc/v1";
const APTID_SIGUNGU = "광주광역시 동구";
const SIGUNGU = "29110";
const DOMAIN = "https://donggu-building.vercel.app";
const CONCURRENCY = 6;
const pnuRe = /^\d{19}$/;
const pnuForVWorld = (pnu) => pnu.startsWith("29110") ? "12210" + pnu.slice(5) : pnu;

// COMPLEX_GB_CD → kind (collect-apt-geo.mjs 의 gbCdToKind 와 동일)
function gbCdToKind(gbCd) {
  if (gbCd === "1") return "아파트";
  if (gbCd === "2") return "연립";
  if (gbCd === "3") return "다세대";
  return "";
}

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

// PNU → VWorld 연속지적도 폴리곤. 없으면 null
async function parcelGeometryByPNU(pnu) {
  const params = new URLSearchParams({
    service: "data", request: "GetFeature", data: "LP_PA_CBND_BUBUN",
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

// 한국부동산원 getAptInfo → 동구 단지(COMPLEX_GB_CD 1/2/3) 배열
async function fetchAptIdComplexes() {
  const params = new URLSearchParams({ page: "1", perPage: "1000", serviceKey: APT_SERVICE_KEY });
  const url = `${APTID_BASE}/getAptInfo?${params.toString()}&cond%5BADRES%3A%3ALIKE%5D=${encodeURIComponent(APTID_SIGUNGU)}`;
  const r = await fetchWithTimeout(url, { timeout: 15000 });
  const text = await r.text();
  const data = JSON.parse(text);
  if (data?.errMsg || data?.returnAuthMsg) {
    throw new Error(`getAptInfo 인증/한도 오류: ${data.errMsg || data.returnAuthMsg}`);
  }
  const rows = Array.isArray(data.data) ? data.data : [];
  const out = rows
    .filter(d => gbCdToKind(String(d.COMPLEX_GB_CD || "").trim()) && pnuRe.test(String(d.PNU || "")))
    .map(d => ({
      pnu: String(d.PNU).trim(),
      kind: gbCdToKind(String(d.COMPLEX_GB_CD || "").trim()),
      complexNm: String(d.COMPLEX_NM1 || d.COMPLEX_NM2 || d.COMPLEX_NM3 || "").trim(),
      adres: String(d.ADRES || "").trim(),
      hhld: Number(d.UNIT_CNT || 0) || null,
      useAprDay: String(d.USEAPR_DT || "").trim(),
    }));
  return out;
}

// 단지명이 "이름 없음" 상태인지 — 종류명 자리에 있거나 빈 경우(건축물대장 한계)
function isNameless(c) {
  const nm = String(c.complexNm || "").trim();
  if (!nm) return true;
  // 종류명("다세대" 등)이 단지명으로 들어간 경우
  return ["아파트", "연립", "다세대", "오피스텔", "도시형생활주택"].includes(nm);
}

async function main() {
  if (!VWORLD_KEY) { console.error("VWORLD_KEY 미설정"); process.exit(1); }
  if (!APT_SERVICE_KEY) { console.error("APT_SERVICE_KEY/BLD_SERVICE_KEY 미설정"); process.exit(1); }

  const aptGeoPath = join(ROOT, "apt_geo.json");
  const existing = JSON.parse(await readFile(aptGeoPath, "utf8"));
  console.log(`기존 apt_geo.json: ${existing.length}건`);

  console.log("getAptInfo 동구 단지 수집 중...");
  const complexes = await fetchAptIdComplexes();
  const kindStat = {};
  for (const c of complexes) kindStat[c.kind] = (kindStat[c.kind] || 0) + 1;
  console.log(`  단지(COMPLEX_GB_CD 1/2/3): ${complexes.length}건 kind별: ${JSON.stringify(kindStat)}`);

  // getAptInfo PNU → 단지 객체 사전
  const aptidByPnu = new Map();
  for (const c of complexes) aptidByPnu.set(c.pnu, c);

  // ── [1] 이름 보강: 기존 apt_geo 단지 중 이름이 없는 것을 getAptInfo로 갱신
  // 단지명(complexNm)만 보강 — kind는 보강하지 않는다.
  // getAptInfo의 COMPLEX_GB_CD(1/2/3)는 오피스텔/도시형생활주택을 표현 못 해서,
  // 기존 kind(건축물대장 등에서 추출)를 getAptInfo kind로 덮어쓰면 SG빌리지(오피스텔→아파트)·
  // 루체클래식(도시형→아파트)처럼 잘못 재분류되는 회귀가 발생하기 때문.
  let enriched = 0;
  for (const c of existing) {
    const ai = aptidByPnu.get(String(c.pnu || ""));
    if (!ai) continue;
    if (!isNameless(c)) continue;
    if (ai.complexNm) { c.complexNm = ai.complexNm; enriched++; }
  }
  console.log(`  [이름 보강] ${enriched}건 단지명 갱신`);

  // ── [2] 신규 추가: 기존에 없는 PNU
  const existingPnus = new Set(existing.map(c => String(c.pnu || "")));
  const newOnes = complexes.filter(c => !existingPnus.has(c.pnu));
  console.log(`  [신규 추가 대상] 기존에 없는 PNU: ${newOnes.length}건`);

  let added = 0;
  if (newOnes.length) {
    console.log("VWorld 연속지적도 폴리곤 수집 중...");
    const geoms = await runPool(newOnes, async (a) => parcelGeometryByPNU(a.pnu), CONCURRENCY);
    for (let i = 0; i < newOnes.length; i++) {
      const g = geoms[i];
      if (!g || !g.geometry) continue;
      const a = newOnes[i];
      existing.push({
        pnu: a.pnu, source: "aptid",
        complexNm: a.complexNm,
        kind: a.kind,
        hhld: a.hhld, useAprDay: a.useAprDay,
        adres: a.adres,
        addr: g.addr || "", jibun: g.jibun || "",
        geometry: g.geometry,
      });
      added++;
    }
  }

  await writeFile(aptGeoPath, JSON.stringify(existing, null, " ") + "\n", "utf8");
  console.log(`\n병합 완료: 이름보강 ${enriched}건 + 신규 ${added}건 → 총 ${existing.length}건`);
  const srcStat = {};
  for (const c of existing) srcStat[c.source] = (srcStat[c.source] || 0) + 1;
  console.log("  source별:", JSON.stringify(srcStat));
  const ks = {};
  for (const c of existing) ks[c.kind] = (ks[c.kind] || 0) + 1;
  console.log("  kind별:", JSON.stringify(ks));
}

main().catch(e => { console.error(e); process.exit(1); });
