// scripts/merge-aptid-geo.mjs
// collect-apt-geo.mjs 를 BLD_SERVICE_KEY 없이 실행하면 연립/다세대/오피스텔(source:bld)이
// 전부 날아가는 문제가 있음. 이 스크립트는 기존 apt_geo.json(280건)을 그대로 둔 채
// getAptInfo에서 보충된 아파트 PNU만 VWorld 폴리곤을 수집해 증분 병합한다.
// 로컬(VWORLD_KEY + APT_SERVICE_KEY만 있는 환경)에서 apt_geo.json을 갱신할 때 사용.
//
// 동작:
//   1) 한국부동산원 getAptInfo 호출 → 동구 아파트(COMPLEX_GB_CD=1) PNU 수집
//   2) 기존 apt_geo.json에 없는 PNU만 추출(신규 보충 대상)
//   3) VWorld 연속지적도에서 각 PNU의 폴리곤 조회
//   4) 폴리곤이 잡힌 건만 apt_geo.json에 추가(source:"aptid")

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
    return { pnu: String(p.pnu || pnu), addr: p.addr || "", jibun: p.jibun || "", geometry: feats[0].geometry || null };
  } catch {
    return null;
  }
}

// 한국부동산원 getAptInfo → 동구 아파트(COMPLEX_GB_CD=1) 단지 배열
async function fetchAptIdApartments() {
  const params = new URLSearchParams({ page: "1", perPage: "1000", serviceKey: APT_SERVICE_KEY });
  const url = `${APTID_BASE}/getAptInfo?${params.toString()}&cond%5BADRES%3A%3ALIKE%5D=${encodeURIComponent(APTID_SIGUNGU)}`;
  const r = await fetchWithTimeout(url, { timeout: 15000 });
  const text = await r.text();
  const data = JSON.parse(text);
  if (data?.errMsg || data?.returnAuthMsg) {
    throw new Error(`getAptInfo 인증/한도 오류: ${data.errMsg || data.returnAuthMsg}`);
  }
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows
    .filter(d => String(d.COMPLEX_GB_CD || "").trim() === "1" && pnuRe.test(String(d.PNU || "")))
    .map(d => ({
      pnu: String(d.PNU).trim(),
      complexNm: String(d.COMPLEX_NM1 || d.COMPLEX_NM2 || d.COMPLEX_NM3 || "").trim(),
      adres: String(d.ADRES || "").trim(),
      hhld: Number(d.UNIT_CNT || 0) || null,
      useAprDay: String(d.USEAPR_DT || "").trim(),
    }));
}

async function main() {
  if (!VWORLD_KEY) { console.error("VWORLD_KEY 미설정"); process.exit(1); }
  if (!APT_SERVICE_KEY) { console.error("APT_SERVICE_KEY/BLD_SERVICE_KEY 미설정"); process.exit(1); }

  const aptGeoPath = join(ROOT, "apt_geo.json");
  const existing = JSON.parse(await readFile(aptGeoPath, "utf8"));
  console.log(`기존 apt_geo.json: ${existing.length}건`);
  const existingPnus = new Set(existing.map(c => String(c.pnu || "")));

  console.log("getAptInfo 동구 아파트 수집 중...");
  const apts = await fetchAptIdApartments();
  console.log(`  아파트(COMPLEX_GB_CD=1): ${apts.length}건`);

  // 신규 보충 대상: 기존 apt_geo.json에 없는 PNU
  const newApts = apts.filter(a => !existingPnus.has(a.pnu));
  console.log(`  기존에 없는 신규 PNU: ${newApts.length}건`);

  if (!newApts.length) {
    console.log("병합할 신규 단지가 없습니다.");
    return;
  }

  console.log("VWorld 연속지적도 폴리곤 수집 중...");
  const geoms = await runPool(newApts, async (a) => parcelGeometryByPNU(a.pnu), CONCURRENCY);

  let added = 0;
  for (let i = 0; i < newApts.length; i++) {
    const g = geoms[i];
    if (!g || !g.geometry) continue;
    const a = newApts[i];
    existing.push({
      pnu: a.pnu, source: "aptid",
      complexNm: a.complexNm,
      kind: "아파트",
      hhld: a.hhld, useAprDay: a.useAprDay,
      adres: a.adres,
      addr: g.addr || "", jibun: g.jibun || "",
      geometry: g.geometry,
    });
    added++;
  }

  await writeFile(aptGeoPath, JSON.stringify(existing, null, " ") + "\n", "utf8");
  console.log(`\n병합 완료: +${added}건 추가 → 총 ${existing.length}건`);
  const srcStat = {};
  for (const c of existing) srcStat[c.source] = (srcStat[c.source] || 0) + 1;
  console.log("  source별:", JSON.stringify(srcStat));
  const kindStat = {};
  for (const c of existing) kindStat[c.kind] = (kindStat[c.kind] || 0) + 1;
  console.log("  kind별:", JSON.stringify(kindStat));
}

main().catch(e => { console.error(e); process.exit(1); });
