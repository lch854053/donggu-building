/*
  aptlist_donggu.json 의 각 K-apt 단지에 대해
  기본정보(bass)와 상세정보(dtl)를 조회하여 JSON에 병합합니다.

  실행:
    # 1) 공공데이터포털 서비스키를 직접 사용 (프록시 불필요)
    APT_SERVICE_KEY=YOUR_KEY node scripts/update-kapt-data.mjs

    # 2) 로컬/운영 API 프록시 사용 (BASE_URL 환경변수 필요)
    BASE_URL=http://localhost:3000 node scripts/update-kapt-data.mjs

  필요한 환경:
    - 프로젝트 루트의 aptlist_donggu.json
    - APT_SERVICE_KEY 또는 BLD_SERVICE_KEY (직접 호출)
    - 또는 동작 중인 API 프록시 + BASE_URL
*/

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unwrapGov } from "../api/_lib/govapi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE_URL = process.env.BASE_URL?.replace(/\/+$/, "") || "http://localhost:3000";
const ORIGIN = process.env.ALLOWED_ORIGIN || BASE_URL;

const DIRECT_SERVICE_KEY = process.env.APT_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
const GOV_BASE = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4";

const inputPath = join(ROOT, "aptlist_donggu.json");
const outputPath = inputPath;
const CONCURRENCY = 10;
const TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, ...opts });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAptInfoProxy(op, kaptCode) {
  const qs = new URLSearchParams({ op, kaptCode }).toString();
  const url = `${BASE_URL}/api/aptinfo${qs ? "?" + qs : ""}`;
  const res = await fetchWithTimeout(url, { headers: { Origin: ORIGIN } });
  if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
  const { info } = await res.json();
  return info;
}

async function fetchAptInfoGov(op, kaptCode) {
  const qs = new URLSearchParams({ kaptCode, _type: "json", serviceKey: DIRECT_SERVICE_KEY });
  const url = `${GOV_BASE}/${op}?${qs}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`gov HTTP ${res.status}`);
  const text = await res.text();
  const { items } = unwrapGov(text, op);
  return items[0] || null;
}

async function fetchAptBass(kaptCode) {
  return DIRECT_SERVICE_KEY
    ? fetchAptInfoGov("getAphusBassInfoV4", kaptCode)
    : fetchAptInfoProxy("getAphusBassInfoV4", kaptCode);
}

async function fetchAptDtl(kaptCode) {
  return DIRECT_SERVICE_KEY
    ? fetchAptInfoGov("getAphusDtlInfoV4", kaptCode)
    : fetchAptInfoProxy("getAphusDtlInfoV4", kaptCode);
}

async function runPool(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  if (!DIRECT_SERVICE_KEY) {
    console.log(`프록시 모드: ${BASE_URL}/api/aptinfo`);
  } else {
    console.log("직접 호출 모드: 공공데이터포털 AptBasisInfoServiceV4");
  }

  const list = JSON.parse(await readFile(inputPath, "utf8"));
  console.log(`총 ${list.length}개 단지 K-apt 정보 갱신 (동시 ${CONCURRENCY})\n`);

  await runPool(list, async (item, idx) => {
    try {
      const [bass, dtl] = await Promise.all([
        fetchAptBass(item.kaptCode),
        fetchAptDtl(item.kaptCode)
      ]);
      item.bass = bass || null;
      item.dtl = dtl || null;
      console.log(`[${idx + 1}/${list.length}] ${item.kaptName} OK`);
    } catch (e) {
      console.error(`[${idx + 1}/${list.length}] ${item.kaptName} ERROR: ${e.message}`);
      if (!item.bass) item.bass = null;
      if (!item.dtl) item.dtl = null;
    }
  }, CONCURRENCY);

  await writeFile(outputPath, JSON.stringify(list, null, " ") + "\n", "utf8");
  console.log(`\n출력: ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
