// scripts/update-sgis-stats.mjs
// SGIS 인구주택총조사 API에서 동구 주택 시계열·주택 유형별 시계열과 거처 유형 구성을 수집합니다.
// 브라우저에는 인증정보를 노출하지 않고, 통계 탭이 읽는 정적 JSON만 갱신합니다.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SGIS_CONSUMER_KEY = process.env.SGIS_CONSUMER_KEY;
const SGIS_CONSUMER_SECRET = process.env.SGIS_CONSUMER_SECRET;
const SGIS_BASE = "https://sgisapi.mods.go.kr/OpenAPI3";
const SGIS_ADM_CD = "24010"; // 광주광역시 동구
const SGIS_HOUSE_YEARS = Array.from({ length: 10 }, (_, i) => 2015 + i);
const SGIS_SUMMARY_YEAR = String(SGIS_HOUSE_YEARS.at(-1));
const SGIS_HOUSE_TYPES = [
  { id: "detached", codes: ["01"], name: "단독주택" },
  { id: "apart", codes: ["02"], name: "아파트" },
  { id: "rowMulti", codes: ["03", "04"], name: "연립·다세대" },
];
const FETCH_TIMEOUT_MS = 20000;

function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function fetchJson(path, params) {
  const url = new URL(`${SGIS_BASE}/${path}`);
  url.search = new URLSearchParams(params);
  const r = await fetchWithTimeout(url);
  let data;
  try {
    data = await r.json();
  } catch {
    throw new Error(`${path}: JSON 응답 파싱 실패 (HTTP ${r.status})`);
  }
  if (data?.errCd !== 0) {
    throw new Error(`${path}: ${data?.errMsg || "SGIS API 오류"} (${data?.errCd ?? "unknown"})`);
  }
  return data;
}

async function getAccessToken() {
  if (!SGIS_CONSUMER_KEY || !SGIS_CONSUMER_SECRET) {
    throw new Error("SGIS_CONSUMER_KEY/SGIS_CONSUMER_SECRET 환경변수 미설정");
  }
  const data = await fetchJson("auth/authentication.json", {
    consumer_key: SGIS_CONSUMER_KEY,
    consumer_secret: SGIS_CONSUMER_SECRET,
  });
  const token = data.result?.accessToken;
  if (!token) throw new Error("SGIS AccessToken 발급 결과가 없습니다");
  return token;
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

async function fetchHouseSeries(accessToken, extraParams = {}) {
  const series = [];
  for (const year of SGIS_HOUSE_YEARS) {
    const data = await fetchJson("stats/house.json", {
      accessToken,
      year: String(year),
      adm_cd: SGIS_ADM_CD,
      low_search: "0",
      ...extraParams,
    });
    const row = data.result?.find(item => String(item.adm_cd) === SGIS_ADM_CD) || data.result?.[0];
    const houseCnt = numberOrNull(row?.house_cnt);
    const typeLabel = extraParams.house_type ? ` 주택유형 ${extraParams.house_type}` : "";
    if (houseCnt === null) throw new Error(`stats/house ${SGIS_HOUSE_YEARS[series.length]}${typeLabel}: 주택수 없음`);
    series.push({ year: String(year), houseCnt });
  }
  return series;
}

async function main() {
  const accessToken = await getAccessToken();
  const summaryData = await fetchJson("startupbiz/housesummary.json", {
    accessToken,
    adm_cd: SGIS_ADM_CD,
  });
  const houseSeries = await fetchHouseSeries(accessToken);
  const houseTypeSeries = [];
  for (const type of SGIS_HOUSE_TYPES) {
    const typeSeries = [];
    for (const code of type.codes) {
      typeSeries.push(await fetchHouseSeries(accessToken, { house_type: code }));
    }
    const series = SGIS_HOUSE_YEARS.map((year, i) => ({
      year: String(year),
      houseCnt: typeSeries.reduce((sum, rows) => sum + rows[i].houseCnt, 0),
    }));
    houseTypeSeries.push({ ...type, series });
  }

  const summaryRow = summaryData.result?.find(item => String(item.adm_cd) === SGIS_ADM_CD);
  if (!summaryRow) throw new Error(`housesummary: ${SGIS_ADM_CD} 응답 없음`);

  const fields = [
    ["apart", "아파트", "apart_cnt", "apart_per"],
    ["detachHouse", "단독주택", "detach_house_cnt", "detach_house_per"],
    ["rowHouse", "연립·다세대", "row_house_cnt", "row_house_per"],
    ["officetel", "오피스텔", "officetel_cnt", "officetel_per"],
    ["etc", "기타", "etc_cnt", "etc_per"],
    ["dormSocial", "기숙사·사회시설", "dom_soc_fac_cnt", "dom_soc_fac_per"],
  ];
  const houseSummary = fields.map(([id, name, countKey, ratioKey]) => {
    const count = numberOrNull(summaryRow[countKey]);
    const ratio = numberOrNull(summaryRow[ratioKey]);
    if (count === null || ratio === null) {
      throw new Error(`housesummary ${id}: 수치 누락`);
    }
    return { id, name, count, ratio };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    source: "SGIS 인구주택총조사 OpenAPI",
    region: "전남광주통합특별시 동구",
    admCd: SGIS_ADM_CD,
    admNm: String(summaryRow.adm_nm || "동구"),
    summaryYear: SGIS_SUMMARY_YEAR,
    houseSeries,
    houseTypeSeries,
    houseSummary,
  };
  const file = join(ROOT, "sgis_stats_donggu.json");
  await writeFile(file, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`✓ ${file} 생성 (주택 시계열 ${houseSeries.length}개, 주택 유형 ${houseTypeSeries.length}종, 거처 유형 ${houseSummary.length}개)`);
}

main().catch(e => {
  console.error("[update-sgis-stats] 실패:", e?.message || e);
  process.exit(1);
});
