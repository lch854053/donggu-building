// scripts/update-stats.mjs
// KOSIS(국가통계포털) e-지방지표에서 동구(시군구) 레벨 주요 지표 시계열을 수집하여
// stats_donggu.json을 생성합니다. (통계 탭 데이터 소스)
//
// 구조 (실호출 검증 2026-07):
//   - 엔드포인트: https://kosis.kr/openapi/Param/statisticsParameterData.do?method=getList
//   - 표마다 분류(objL) 깊이가 다르다: 빈집/노후/주택수/도시지역면적은 objL1만,
//     1인당 도시지역면적은 objL1(행정구역)+objL2(항목분류) 필요.
//   - 지역코드 체계가 표마다 2종:
//     A체계  : 전국=00, 광주광역시=24, 동구=24010
//     HJG체계: 전국=15315HJG000, 광주=15315HJG005, 동구=15315HJG005001
//     (동구 이름 매칭은 전국 동명 구가 섞이므로 반드시 코드로 조회한다)
//   - prdSe=Y + newEstPrdCnt=5 → 최근 5개 시점. 응답 PRD_SE는 "A"로 오는 KOSIS 관행.
//
// 실행: KOSIS_API_KEY=... npm run update-stats

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const KOSIS_API_KEY = process.env.KOSIS_API_KEY;
const ENDPOINT = "https://kosis.kr/openapi/Param/statisticsParameterData.do";
const YEARS = 5;              // 최근 N개 시점
const FETCH_TIMEOUT_MS = 20000;

// 지역코드 체계 (표마다 다름 — 위 주석 참고)
const CODES_A   = { nation: "00",          gwangju: "24",          donggu: "24010" };
const CODES_HJG = { nation: "15315HJG000", gwangju: "15315HJG005", donggu: "15315HJG005001" };

// 수집 대상 지표. objL2가 있는 표만 objL2 코드 지정.
const INDICATORS = [
  { id: "vacant_ratio",   tblId: "DT_1YL202005",   codes: CODES_A,
    itmId: "T10",           name: "미거주주택(빈집)비율", unit: "%" },
  { id: "vacant_count",   tblId: "DT_1YL202005",   codes: CODES_A,
    itmId: "T20",           name: "미거주주택(빈집)수",   unit: "호" },
  { id: "oldhouse_ratio", tblId: "DT_1YL202004",   codes: CODES_A,
    itmId: "T10",           name: "노후주택비율(30년 이상)", unit: "%" },
  { id: "oldhouse_count", tblId: "DT_1YL202004",   codes: CODES_A,
    itmId: "T20",           name: "노후주택수(30년 이상)", unit: "호" },
  { id: "houses",         tblId: "INH_1JU1501",    codes: CODES_A,
    itmId: "T10",           name: "주택수",               unit: "호" },
  { id: "city_area",      tblId: "DT_1YL21291E",   codes: CODES_HJG,
    itmId: "16315T2008_0012", name: "도시지역면적", unit: "㎢", scale: 1e-6 },
  { id: "city_area_pp",   tblId: "DT_1YL20421E",   codes: CODES_HJG,
    itmId: "T01", objL2: "H004", name: "1인당 도시지역면적", unit: "㎡" },
];

function fetchWithTimeout(url, opts = {}) {
  const { timeout = FETCH_TIMEOUT_MS, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal, ...rest }).finally(() => clearTimeout(timer));
}

// KOSIS 통계자료 조회 → rows 배열. 오류면 throw.
async function fetchKosis(ind) {
  const q = {
    method: "getList", apiKey: KOSIS_API_KEY, format: "json", jsonVD: "Y",
    orgId: "101", tblId: ind.tblId,
    objL1: [ind.codes.nation, ind.codes.gwangju, ind.codes.donggu].join(" "),
    itmId: ind.itmId,
    prdSe: "Y", newEstPrdCnt: String(YEARS),
  };
  if (ind.objL2) q.objL2 = ind.objL2;
  const url = `${ENDPOINT}?${new URLSearchParams(q)}`;
  const r = await fetchWithTimeout(url);
  const data = await r.json();
  if (!Array.isArray(data))
    throw new Error(`${ind.tblId}: ${data?.errMsg || JSON.stringify(data).slice(0, 120)}`);
  return data;
}

// DT 문자열 → 숫자 ("-"·콤마·공백 처리, 실패 시 null)
const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

async function main() {
  if (!KOSIS_API_KEY) { console.error("KOSIS_API_KEY 미설정"); process.exit(1); }

  // 같은 표는 1회만 호출 (지표 여러 개가 한 표를 공유)
  const byTable = new Map();
  for (const ind of INDICATORS) {
    if (!byTable.has(ind.tblId)) byTable.set(ind.tblId, []);
    byTable.get(ind.tblId).push(ind);
  }

  const indicators = [];
  for (const [tblId, inds] of byTable) {
    // 표당 1회 호출: 필요한 항목만 itmId에 묶어서
    const probe = { ...inds[0], itmId: [...new Set(inds.map(i => i.itmId))].join(" ") };
    const rows = await fetchKosis(probe);
    const tblNm = rows[0]?.TBL_NM || "";
    const lstChnDe = rows.map(r => r.LST_CHN_DE).filter(Boolean).sort().pop() || "";

    for (const ind of inds) {
      const scale = ind.scale || 1;
      // year → { donggu, gwangju, nation }
      const byYear = new Map();
      for (const r of rows) {
        if (r.ITM_ID !== ind.itmId) continue;
        const year = String(r.PRD_DE || "");
        const v = num(r.DT);
        if (!year || v === null) continue;
        if (!byYear.has(year)) byYear.set(year, {});
        const slot = byYear.get(year);
        if (r.C1 === ind.codes.donggu)      slot.donggu  = v * scale;
        else if (r.C1 === ind.codes.gwangju) slot.gwangju = v * scale;
        else if (r.C1 === ind.codes.nation)  slot.nation  = v * scale;
      }
      const series = [...byYear.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([year, v]) => ({ year, donggu: v.donggu ?? null, gwangju: v.gwangju ?? null, nation: v.nation ?? null }));
      if (!series.length) throw new Error(`${ind.id} (${tblId}): 시계열 0건 — 코드/파라미터 확인 필요`);
      indicators.push({ id: ind.id, name: ind.name, unit: ind.unit, tblId, tblNm, lstChnDe, series });
      console.log(`[ok] ${ind.name}: ${series.length}개 시점, 최신 ${series.at(-1).year} 동구=${series.at(-1).donggu}${ind.unit}`);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    region: "전남광주통합특별시 동구",
    compare: { gwangju: "광주광역시", nation: "전국" },
    source: "KOSIS(국가통계포털) e-지방지표",
    indicators,
  };
  const file = join(ROOT, "stats_donggu.json");
  await writeFile(file, JSON.stringify(out, null, 2));
  console.log(`\n✓ ${file} 생성 (지표 ${indicators.length}개)`);
}

main().catch(e => { console.error("[update-stats] 실패:", e?.message || e); process.exit(1); });
