// scripts/update-odcloud-apt.mjs
// odcloud "전남광주통합특별시 동구_공동주택현황" 데이터를 수집하고,
// 행안부 도로명주소 API로 PNU를 보강하여 aptlist_odcloud_donggu.json을 생성합니다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ODCLOUD_SERVICE_KEY = process.env.ODCLOUD_SERVICE_KEY;
const JUSO_CONFM_KEY = process.env.JUSO_CONFM_KEY;
const ODCLOUD_ENDPOINT = "https://api.odcloud.kr/api/3034603/v1/uddi:55a66481-a930-4b8a-8504-c6729b66b6ea";
const JUSO_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do";
const PER_PAGE = 1000;

function fetchWithTimeout(url, opts = {}) {
  const { timeout = 10000, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal, ...rest }).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeDoro(addr) {
  return String(addr || "")
    .replace(/전남광주통합특별시/g, "광주광역시")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchAllOdcloud() {
  if (!ODCLOUD_SERVICE_KEY) throw new Error("ODCLOUD_SERVICE_KEY 환경변수 필요");
  const all = [];
  let page = 1;
  while (true) {
    const url = `${ODCLOUD_ENDPOINT}?page=${page}&perPage=${PER_PAGE}&serviceKey=${encodeURIComponent(ODCLOUD_SERVICE_KEY)}`;
    const r = await fetchWithTimeout(url, { timeout: 20000 });
    if (!r.ok) throw new Error(`odcloud HTTP ${r.status}`);
    const data = await r.json();
    if (data?.errMsg || data?.returnAuthMsg) {
      throw new Error(`odcloud 인증/한도 오류: ${data.errMsg || data.returnAuthMsg}`);
    }
    const rows = Array.isArray(data?.data) ? data.data : [];
    all.push(...rows);
    const total = Number(data?.totalCount || 0);
    if (rows.length < PER_PAGE || all.length >= total) break;
    page++;
  }
  return all;
}

async function searchJuso(keyword) {
  if (!JUSO_CONFM_KEY || !keyword) return null;
  const params = new URLSearchParams({
    confmKey: JUSO_CONFM_KEY,
    currentPage: "1",
    countPerPage: "5",
    resultType: "json",
    keyword,
  });
  const r = await fetchWithTimeout(`${JUSO_URL}?${params}`, { timeout: 10000 });
  if (!r.ok) return null;
  const data = await r.json();
  const common = data?.results?.common || {};
  if (common.errorCode && common.errorCode !== "0") {
    console.error(`[juso] error: ${common.errorMessage || common.errorCode}`);
    return null;
  }
  const list = data?.results?.juso || [];
  return Array.isArray(list) ? list[0] : null;
}

function pnuFromJuso(j) {
  if (!j) return "";
  const adm = String(j.admCd || "").padEnd(10, "0");
  let sigunguCd = adm.substring(0, 5);
  // 행안부 도로명주소 API는 광주 동구를 전남광주통합특별시 코드(12210)로 반환하기도 한다.
  // 서비스에서는 광주광역시 동구 코드(29110)를 표준으로 사용한다.
  if (sigunguCd === "12210") sigunguCd = "29110";
  const bjdongCd = adm.substring(5, 10);
  const bun = String(j.lnbrMnnm ?? 0).padStart(4, "0");
  const ji = String(j.lnbrSlno ?? 0).padStart(4, "0");
  return `${sigunguCd}${bjdongCd}1${bun}${ji}`;
}

async function loadExisting() {
  const kapt = JSON.parse(await readFile(join(ROOT, "aptlist_donggu.json"), "utf8"));
  const extra = JSON.parse(await readFile(join(ROOT, "aptlist_extra_donggu.json"), "utf8"));
  const pnuSet = new Set();
  const doroSet = new Set();
  const nameSet = new Set();

  for (const c of kapt) {
    if (c.pnu) pnuSet.add(c.pnu);
    if (c.bass?.doroJuso) doroSet.add(normalizeDoro(c.bass.doroJuso));
    if (c.kaptName) nameSet.add(c.kaptName);
  }
  for (const c of extra) {
    if (c.pnu) pnuSet.add(c.pnu);
    if (c.doroAddr) doroSet.add(normalizeDoro(c.doroAddr));
    if (c.complexNm) nameSet.add(c.complexNm);
  }

  return { pnuSet, doroSet, nameSet };
}

function normalizeUseAprDay(v) {
  const s = String(v || "").replace(/[^0-9]/g, "");
  if (s.length === 8) return s;
  if (s.length === 6) return `${s.slice(0, 4)}${s.slice(4)}01`; // YYYYMM -> YYYYMM01
  return "";
}

async function main() {
  if (!ODCLOUD_SERVICE_KEY) {
    console.error("ODCLOUD_SERVICE_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }
  if (!JUSO_CONFM_KEY) {
    console.warn("JUSO_CONFM_KEY 환경변수가 설정되지 않았습니다. PNU 보강 없이 진행합니다.");
  }

  console.log("odcloud 데이터 수집 중...");
  const odcloud = await fetchAllOdcloud();
  console.log(`odcloud 총 ${odcloud.length}건`);

  const { pnuSet, doroSet, nameSet } = await loadExisting();

  const out = [];
  let skipped = 0;
  let noPnu = 0;

  for (let i = 0; i < odcloud.length; i++) {
    const row = odcloud[i];
    const name = String(row["아파트명"] || "").trim();
    const doro = normalizeDoro(row["소재지도로명주소"]);
    const hhld = Number(row["세대수"] || 0);
    const useAprDay = normalizeUseAprDay(row["사용승인일자"]);

    // 기존 데이터 중복 제거
    if (doro && doroSet.has(doro)) { skipped++; continue; }
    if (name && nameSet.has(name)) { skipped++; continue; }

    // PNU 보강
    let pnu = "";
    if (JUSO_CONFM_KEY && doro) {
      const j = await searchJuso(doro);
      pnu = pnuFromJuso(j);
      await sleep(150);
    }

    if (!pnu) { noPnu++; continue; }

    // PNU 중복 제거 (K-apt/수동과 동일 필지면 제외)
    if (pnuSet.has(pnu)) { skipped++; continue; }

    out.push({
      pnu,
      complexNm: name,
      doroAddr: doro,
      adres: doro, // odcloud에는 지번이 없으므로 도로명주소를 adres로 사용
      kind: "아파트",
      hhld,
      useAprDay,
      officeTel: String(row["관리사무소전화"] || "").trim(),
    });

    console.log(`[${i + 1}/${odcloud.length}] ${name} ${pnu ? "PNU:" + pnu : "PNU 실패"}`);
  }

  // PNU 없는 항목은 제거 (PNU가 필수)
  const final = out.filter(o => o.pnu);

  const outputPath = join(ROOT, "aptlist_odcloud_donggu.json");
  await writeFile(outputPath, JSON.stringify(final, null, " ") + "\n", "utf8");

  console.log(`\n완료: ${final.length}건 저장 (중복 ${skipped}건 제외, PNU 실패 ${noPnu}건 제외)`);
  console.log(`저장 경로: ${outputPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
