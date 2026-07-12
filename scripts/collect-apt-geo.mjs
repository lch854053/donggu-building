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
async function parcelGeometryByPNU(pnu) {
  const params = new URLSearchParams({
    service: "data", request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",
    attrFilter: `pnu:=:${pnu}`,
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

// 단지 종류 정규화 — 지도 색상 분류용
function normalizeKind(kind, codeAptNm) {
  const k = (kind || codeAptNm || "").replace(/\s+/g, "");
  if (k.includes("아파트")) return "아파트";
  if (k.includes("연립")) return "연립";
  if (k.includes("다세대")) return "다세대";
  if (k.includes("오피스텔")) return "오피스텔";
  if (k.includes("도시형")) return "도시형생활주택";
  if (k.includes("주상복합")) return "도시형생활주택";
  return kind || "기타";
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
      kind: normalizeKind("", r.bass?.codeAptNm),
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
      dong: "", kind: normalizeKind(r.kind, ""),
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
      kind: normalizeKind(r.kind, ""),
      hhld: r.hhld || null, useAprDay: r.useAprDay || "",
      doroAddr: r.doroAddr || "", adres: r.adres || "",
      officeTel: r.officeTel || "",
    });
  }

  const complexes = [...byPnu.values()];
  console.log(`  고유 단지(PNU 기준): ${complexes.length}건`);

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
  console.log(`저장 경로: ${outPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
