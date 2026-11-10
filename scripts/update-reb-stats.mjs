// scripts/update-reb-stats.mjs
// 한국부동산원 부동산통계정보 Open API에서 광주 동구의 시장동향을 수집합니다.
// 인증키는 수집 시점에만 사용하고, 브라우저에는 정적 JSON만 제공합니다.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const REB_API_KEY = process.env.REB_API_KEY;
const REB_BASE = "https://www.reb.or.kr/r-one/openapi";
const PAGE_SIZE = 100;
const FETCH_TIMEOUT_MS = 20000;
const DONGGU_PATH = "광주>동구";

// 토지 통계는 서비스 범위에서 제외한다. 분류 ID와 항목 ID는 표마다 달라
// 메타데이터 API에서 광주>동구·항목명을 찾아 사용한다.
const DATASETS = [
  { id: "housing_sale_index", name: "주택종합 매매가격지수", group: "housingIndex", statblId: "A_2024_00016", cycle: "MM", itemName: "지수", displayUnit: "지수" },
  { id: "housing_jeonse_index", name: "주택종합 전세가격지수", group: "housingIndex", statblId: "A_2024_00019", cycle: "MM", itemName: "지수", displayUnit: "지수" },
  { id: "housing_rent_index", name: "주택종합 월세가격지수", group: "housingIndex", statblId: "A_2024_00022", cycle: "MM", itemName: "지수", displayUnit: "지수" },
  { id: "apt_sale_index", name: "아파트 매매가격지수", group: "aptIndex", statblId: "A_2024_00045", cycle: "MM", itemName: "지수", displayUnit: "지수" },
  { id: "apt_jeonse_index", name: "아파트 전세가격지수", group: "aptIndex", statblId: "A_2024_00050", cycle: "MM", itemName: "지수", displayUnit: "지수" },
  { id: "apt_rent_index", name: "아파트 월세가격지수", group: "aptIndex", statblId: "A_2024_00055", cycle: "MM", itemName: "지수", displayUnit: "지수" },
  { id: "apt_avg_sale_price", name: "아파트 평균매매가격", group: "aptSalePrice", statblId: "A_2024_00060", cycle: "MM", itemName: "가격", displayUnit: "천원" },
  { id: "apt_median_sale_price", name: "아파트 중위매매가격", group: "aptSalePrice", statblId: "A_2024_00062", cycle: "MM", itemName: "가격", displayUnit: "천원" },
  { id: "apt_avg_jeonse_price", name: "아파트 평균전세가격", group: "aptJeonsePrice", statblId: "A_2024_00064", cycle: "MM", itemName: "가격", displayUnit: "천원" },
  { id: "apt_median_jeonse_price", name: "아파트 중위전세가격", group: "aptJeonsePrice", statblId: "A_2024_00066", cycle: "MM", itemName: "가격", displayUnit: "천원" },
  { id: "apt_avg_rent_price", name: "아파트 평균월세가격", group: "aptRentPrice", statblId: "A_2024_00069", cycle: "MM", itemName: "가격", displayUnit: "천원" },
  { id: "apt_median_rent_price", name: "아파트 중위월세가격", group: "aptRentPrice", statblId: "A_2024_00071", cycle: "MM", itemName: "가격", displayUnit: "천원" },
  { id: "apt_jeonse_ratio", name: "아파트 매매가격 대비 전세가격", group: "aptRatio", statblId: "A_2024_00072", cycle: "MM", itemName: "매매가격 대비 전세가격", displayUnit: "%" },
  { id: "housing_transactions", name: "주택 거래량", group: "transactions", statblId: "A_2024_00546", cycle: "MM", itemName: "동(호)수", displayUnit: "건" },
  { id: "apt_transactions", name: "아파트 거래량", group: "transactions", statblId: "A_2024_00554", cycle: "MM", itemName: "동(호)수", displayUnit: "건" },
  { id: "building_transactions", name: "건축물 거래량", group: "transactions", statblId: "A_2024_00542", cycle: "MM", itemName: "동(호)수", displayUnit: "건" },
  { id: "apt_sale_index_quarterly", name: "아파트 매매가격지수(분기)", group: "longTerm", statblId: "A_2024_00180", cycle: "QY", itemName: "지수", displayUnit: "지수" },
];

function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function getHeader(block, key) {
  const head = block?.[0]?.head || [];
  const entry = head.find(item => Object.hasOwn(item, key));
  return entry?.[key];
}

async function fetchPage(path, responseKey, params, page) {
  const url = new URL(`${REB_BASE}/${path}`);
  url.search = new URLSearchParams({
    KEY: REB_API_KEY,
    Type: "json",
    pIndex: String(page),
    pSize: String(PAGE_SIZE),
    ...params,
  });
  const response = await fetchWithTimeout(url);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path}: JSON 응답 파싱 실패 (HTTP ${response.status})`);
  }

  const block = data?.[responseKey];
  const result = block?.[0]?.head?.find(item => item.RESULT)?.RESULT;
  if (!block || (result?.CODE && result.CODE !== "INFO-000")) {
    throw new Error(`${path}: ${result?.MESSAGE || "API 응답 오류"}`);
  }
  return {
    rows: block?.[1]?.row || [],
    total: Number(getHeader(block, "list_total_count")) || 0,
  };
}

async function fetchAll(path, responseKey, params = {}) {
  const rows = [];
  let page = 1;
  let total = 0;

  while (true) {
    const result = await fetchPage(path, responseKey, params, page);
    rows.push(...result.rows);
    total = result.total || rows.length;
    if (!result.rows.length || rows.length >= total || result.rows.length < PAGE_SIZE) break;
    page += 1;
    if (page > 100) throw new Error(`${path}: 페이지 수가 비정상적으로 많습니다`);
  }
  return rows;
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function findClass(items, statblId) {
  const row = items.find(item => item.ITM_TAG === "분류" && item.ITM_FULLNM === DONGGU_PATH);
  if (!row) throw new Error(`${statblId}: ${DONGGU_PATH} 분류가 없습니다`);
  return row;
}

function findItem(items, statblId, itemName) {
  const row = items.find(item => item.ITM_TAG === "항목" && item.ITM_NM === itemName);
  if (!row) throw new Error(`${statblId}: ${itemName} 항목이 없습니다`);
  return row;
}

function normalizeSeries(rows, dataset) {
  const byPeriod = new Map();
  for (const row of rows) {
    const period = String(row.WRTTIME_IDTFR_ID || "");
    const value = numberOrNull(row.DTA_VAL);
    if (!period || value === null) continue;
    byPeriod.set(period, {
      period,
      label: String(row.WRTTIME_DESC || period),
      value,
    });
  }
  const series = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  if (!series.length) throw new Error(`${dataset.id}: 통계자료가 없습니다`);
  return series;
}

async function main() {
  if (!REB_API_KEY) throw new Error("REB_API_KEY 미설정");

  const tables = await fetchAll("SttsApiTbl.do", "SttsApiTbl");
  const itemCache = new Map();
  const indicators = [];

  for (const dataset of DATASETS) {
    const table = tables.find(row => row.STATBL_ID === dataset.statblId);
    if (!table) throw new Error(`${dataset.statblId}: 통계표가 없습니다`);
    if (!String(table.DTACYCLE_CD || "").split(",").includes(dataset.cycle)) {
      throw new Error(`${dataset.statblId}: ${dataset.cycle} 주기를 지원하지 않습니다`);
    }

    if (!itemCache.has(dataset.statblId)) {
      itemCache.set(dataset.statblId, await fetchAll("SttsApiTblItm.do", "SttsApiTblItm", {
        STATBL_ID: dataset.statblId,
      }));
    }
    const items = itemCache.get(dataset.statblId);
    const cls = findClass(items, dataset.statblId);
    const item = findItem(items, dataset.statblId, dataset.itemName);
    const rows = await fetchAll("SttsApiTblData.do", "SttsApiTblData", {
      STATBL_ID: dataset.statblId,
      DTACYCLE_CD: dataset.cycle,
      CLS_ID: String(cls.ITM_ID),
      ITM_ID: String(item.ITM_ID),
    });
    const series = normalizeSeries(rows, dataset);
    const sourceUnit = rows.find(row => row.UI_NM)?.UI_NM || dataset.displayUnit;

    indicators.push({
      id: dataset.id,
      name: dataset.name,
      group: dataset.group,
      statblId: dataset.statblId,
      statblNm: table.STATBL_NM,
      cycle: dataset.cycle,
      cycleName: table.DTACYCLE_NM,
      clsId: String(cls.ITM_ID),
      clsFullNm: cls.ITM_FULLNM,
      itemId: String(item.ITM_ID),
      sourceUnit,
      unit: dataset.displayUnit,
      series,
    });
    console.log(`[ok] ${dataset.name}: ${series.length}개 시점, 최신 ${series.at(-1).label}=${series.at(-1).value}${dataset.displayUnit}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "한국부동산원 부동산통계정보 Open API",
    region: "전남광주통합특별시 동구",
    classPath: DONGGU_PATH,
    note: "월별 자료는 한국부동산원 제공 최신 시점 기준이며 잠정값일 수 있습니다.",
    indicators,
  };
  const file = join(ROOT, "reb_stats_donggu.json");
  await writeFile(file, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n✓ ${file} 생성 (지표 ${indicators.length}개)`);
}

main().catch(error => {
  console.error("[update-reb-stats] 실패:", error?.message || error);
  process.exit(1);
});
