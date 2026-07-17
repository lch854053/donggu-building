/*
  동구 내 오피스텔을 건축인허가정보(ArchPmsHubService) 기반으로 자동 식별해
  aptlist_extra_donggu.json 을 갱신합니다.

  오피스텔은 주택유형정보(getApHsTpInfo)에 등록되지 않는 경우가 많아
  (유탑유블레스 원시티 등) 기존 자동 발견 로직으로 잡히지 않습니다.
  대신 '건축인허가 기본개요 + 층별개요' 2단계 신호 조합으로 식별합니다.

  판별 로직 (엄격 임계값):
    1차: 기본개요(getApBasisOulnInfo)에서 mainPurpsCdNm="업무시설" AND hoCnt>=50
    2차: 층별개요(getApFlrOulnInfo)의 mainPurpsCd="14202"(오피스텔) 비중 >= 50%
    → 오피스텔 확정

  보존 병합: 기존 aptlist_extra_donggu.json 항목(수동 등록 포함)은 PNU가 같으면
  기존 값을 우선합니다. 스크립트는 신규 오피스텔 추가 + 기존 항목 빈 필드 채우기만.

  실행:
    # 직접 호출 (공공데이터포털 키)
    ARCH_SERVICE_KEY=YOUR_KEY node scripts/update-officetel.mjs

    # 프록시 모드 (로컬/운영 API)
    BASE_URL=http://localhost:3000 node scripts/update-officetel.mjs

  필요한 환경:
    - 프로젝트 루트의 haengjeong.json, aptlist_extra_donggu.json
    - ARCH_SERVICE_KEY 또는 BLD_SERVICE_KEY (직접 호출)
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

const DIRECT_SERVICE_KEY = process.env.ARCH_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
const ARCH_BASE = "https://apis.data.go.kr/1613000/ArchPmsHubService";
const BLD_BASE  = "https://apis.data.go.kr/1613000/BldRgstHubService";
const SIGUNGU = "29110";   // 광주 동구

const extraPath = join(ROOT, "aptlist_extra_donggu.json");
const hjPath    = join(ROOT, "haengjeong.json");

const CONCURRENCY = 5;
const TIMEOUT_MS = 15000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

// 오피스텔 판별 임계값 (엄격)
const OFFICETEL_PURPS_CD = "14202";      // 층별개요 mainPurpsCd 오피스텔
const MIN_HO_CNT = 50;                   // 기본개요 최소 호수
const MIN_OFFICETEL_RATIO = 0.5;         // 층별 오피스텔 최소 비중 (50%)

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, ...opts });
  } finally {
    clearTimeout(timer);
  }
}

// ── ArchPms / BldRgst 호출 (직접 모드 / 프록시 모드) ──
// 직접: data.go.kr 에 serviceKey 포함해 호출 → unwrapGov
// 프록시: /api/archpms 또는 /api/building 으로 op+지번 파라미터 전달
async function callGovDirect(base, op, params) {
  const q = new URLSearchParams({ ...params, _type: "json" });
  const url = `${base}/${op}?serviceKey=${encodeURIComponent(DIRECT_SERVICE_KEY)}&${q}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`gov HTTP ${res.status}`);
  const text = await res.text();
  const { items, totalCount } = unwrapGov(text, op);
  return { items, totalCount };
}

async function callProxy(endpoint, op, params) {
  const qs = new URLSearchParams({ op, ...params }).toString();
  const url = `${BASE_URL}/api/${endpoint}${qs ? "?" + qs : ""}`;
  const res = await fetchWithTimeout(url, { headers: { Origin: ORIGIN } });
  if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
  const data = await res.json();
  // building 프록시는 { titles:[...] }, archpms 는 { items:[...] }
  const items = data.items ?? data.titles ?? [];
  return { items, totalCount: Number(data.totalCount || items.length) };
}

// 기본개요(법정동 단위 전수). 직접/프록시 분기
async function fetchBasisDong(bjd, pageNo) {
  const params = { sigunguCd: SIGUNGU, bjdongCd: bjd, numOfRows: String(PAGE_SIZE), pageNo: String(pageNo) };
  if (DIRECT_SERVICE_KEY) return callGovDirect(ARCH_BASE, "getApBasisOulnInfo", params);
  return callProxy("archpms", "getApBasisOulnInfo", params);
}

// 층별개요(단건 지번)
async function fetchFlr(sigunguCd, bjd, platGbCd, bun, ji) {
  const params = { sigunguCd, bjdongCd: bjd, platGbCd, bun, ji, numOfRows: "1000", pageNo: "1" };
  if (DIRECT_SERVICE_KEY) return callGovDirect(ARCH_BASE, "getApFlrOulnInfo", params);
  return callProxy("archpms", "getApFlrOulnInfo", params);
}

// 표제부(단건 지번) — doroAddr/층수/주차 보강용
async function fetchTitle(sigunguCd, bjd, platGbCd, bun, ji) {
  const params = { sigunguCd, bjdongCd: bjd, platGbCd, bun, ji, numOfRows: "100", pageNo: "1" };
  if (DIRECT_SERVICE_KEY) return callGovDirect(BLD_BASE, "getBrTitleInfo", params);
  return callProxy("building", "getBrTitleInfo", params);
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

// haengjeong.json → 동구 전체 법정동코드 목록
async function loadBjdList() {
  const hj = JSON.parse(await readFile(hjPath, "utf8"));
  const set = new Set();
  Object.values(hj.hdong2bjd || {}).forEach(arr => arr.forEach(c => set.add(c)));
  return [...set].sort();
}

// 1차 후보 판정: 업무시설 AND hoCnt>=50
function isOfficetelCandidate(r) {
  const purps = String(r.mainPurpsCdNm || "").trim();
  const ho = Number(r.hoCnt || 0);
  return purps === "업무시설" && ho >= MIN_HO_CNT;
}

// 2차 확정: 층별개요 오피스텔(14202) 비중 >= 50%
function officetelRatio(flrItems) {
  if (!flrItems.length) return 0;
  const officetel = flrItems.filter(x => String(x.mainPurpsCd || "").trim() === OFFICETEL_PURPS_CD).length;
  return officetel / flrItems.length;
}

// PNU 조립: 시군구5 + 법정동5 + 대지구분(1) + 번4 + 지4 = 19자리
// API platGbCd("0"=대지/"1"=산) → PNU 대지구분("1"=대지/"2"=산) 변환 (index.html 로직과 일치)
function pnuOf(r) {
  const bun = String(r.bun || "").padStart(4, "0");
  const ji  = String(r.ji  || "").padStart(4, "0");
  const pnuPlatGb = String(r.platGbCd || "0") === "1" ? "2" : "1";   // 산이면 2, 그 외(대지/블록) 1
  return `${SIGUNGU}${r.bjdongCd}${pnuPlatGb}${bun}${ji}`;
}

// 괄호 제거 + 닫는 괄호 잔여 정리 (예: "수기동 16-3 업무시설)" → "수기동 16-3 업무시설")
const stripParens = (s) => String(s || "")
  .replace(/\s*\([^)]*\)\s*$/g, "")
  .replace(/\s*\([^)]*\)/g, "")
  .replace(/\)+\s*$/, "")
  .trim();

// bad name(용도 문자열/지번 형태) 판정 — index.html isBadComplexName 과 동일 기준
function isBadName(nm) {
  const s = String(nm || "").trim();
  if (!s || s === "-") return true;
  if (/제\d종근린생활시설|근린생활시설|판매시설|업무시설|공동주택/.test(s)) return true;
  if (/^[가-힣]+동\s+\d+/.test(s)) return true;
  if (/^\(\d+(?:-\d+)?\)$/.test(s) || /^\d+(?:-\d+)?$/.test(s)) return true;
  return false;
}

// 도로명주소에서 시·구 접두 제거 (fallbackDisplayName 용)
function extractRoadCore(addr) {
  return stripParens(String(addr || ""))
    .replace(/^전남광주통합특별시\s+\S+\s+/, "")
    .replace(/^광주광역시\s+\S+\s+/, "")
    .replace(/^광주\s+\S+\s+/, "")
    .trim();
}

// bad name → '도로명 오피스텔' 폴백 (런타임 fallbackDisplayName 과 일관)
function refineName(raw, doroAddr) {
  const nm = stripParens(raw);
  if (!isBadName(nm)) return nm;
  const road = extractRoadCore(doroAddr);
  return road ? `${road} 오피스텔` : "오피스텔";
}

// 표제부 합산 주차대수 (building 프록시 totPkngCnt 우선, 없으면 항목 합산)
function totalParking(t) {
  const direct = Number(t.totPkngCnt || 0);
  if (direct > 0) return direct;
  return Number(t.indrAutoUtcnt || 0) + Number(t.oudrAutoUtcnt || 0)
       + Number(t.indrMechUtcnt || 0) + Number(t.oudrMechUtcnt || 0);
}

// 확정 오피스텔 → aptlist_extra 행 정규화
// 표제부(titles)가 있으면 우선, 없으면 기본개요(basis)로 최대한 채운다.
function buildEntry(basis, titles) {
  const pnu = pnuOf(basis);
  const rep = titles.find(t => String(t.mainAtchGbCdNm || "").trim() === "주건축물") || titles[0] || {};

  const hhld = Number(basis.hoCnt || 0) || null;
  const tarea = Number(basis.totArea || 0) || null;
  // 층수/동수: 표제부 우선, 없으면 층별개요 신호로는 알 수 없으므로 null
  const grndFlr = rep.grndFlrCnt != null ? Number(rep.grndFlrCnt) : null;
  const ugrndFlr = rep.ugrndFlrCnt != null ? Number(rep.ugrndFlrCnt) : null;
  const dongCnt = rep.mainBldCnt != null ? Number(rep.mainBldCnt) : null;
  const parking = titles.length ? (titles.reduce((s, t) => s + totalParking(t), 0) || null) : null;
  // doroAddr: 표제부 newPlatPlc 우선, 없으면 "-"
  const doroAddr = stripParens(rep.newPlatPlc) || "-";

  return {
    pnu,
    complexNm: refineName(basis.bldNm, doroAddr !== "-" ? doroAddr : stripParens(basis.platPlc)),
    doroAddr,
    adres: stripParens(basis.platPlc) || "-",
    kind: "오피스텔",
    hhld,
    dongCnt,
    grndFlr,
    ugrndFlr,
    useAprDay: String(basis.useAprDay || "").replace(/\D/g, "") || "-",
    tarea: tarea != null ? Math.round(tarea * 100) / 100 : null,
    parking,
  };
}

// 보존 병합: 기존 항목 우선, 신규는 추가, 기존 빈 필드만 채우기
// 단, 기존 complexNm이 bad name(용도 문자열 등)이면 정제된 신규명으로 개선
function mergePreserve(existingList, newEntries) {
  const byPnu = new Map(existingList.map(e => [e.pnu, { ...e }]));
  let added = 0, filled = 0;
  for (const entry of newEntries) {
    const ex = byPnu.get(entry.pnu);
    if (ex) {
      // 기존 단지명이 bad name인데 신규가 더 나은 명이면 교체
      if (isBadName(ex.complexNm) && !isBadName(entry.complexNm)) {
        ex.complexNm = entry.complexNm; filled++;
      }
      // 기존 항목의 빈/null/0 필드만 신규 데이터로 보강
      const optFields = ["doroAddr","adres","kind","useAprDay"];
      const numFields = ["hhld","dongCnt","grndFlr","ugrndFlr","tarea","parking"];
      let changed = false;
      for (const f of optFields) {
        const v = String(ex[f] ?? "").trim();
        if ((v === "" || v === "-") && String(entry[f] ?? "").trim() && String(entry[f]).trim() !== "-") {
          ex[f] = entry[f]; changed = true;
        }
      }
      for (const f of numFields) {
        if ((ex[f] == null || Number(ex[f]) === 0) && entry[f] != null && Number(entry[f]) > 0) {
          ex[f] = entry[f]; changed = true;
        }
      }
      if (changed) filled++;
    } else {
      byPnu.set(entry.pnu, entry); added++;
    }
  }
  return { merged: [...byPnu.values()], added, filled };
}

async function main() {
  const mode = DIRECT_SERVICE_KEY ? "직접 호출" : `프록시(${BASE_URL})`;
  console.log(`오피스텔 자동 발견 — ${mode} 모드\n`);

  // 1) 법정동 목록
  const bjdList = await loadBjdList();
  console.log(`동구 법정동 ${bjdList.length}개 스캔\n`);

  // 2) 기본개요 전수 스캔 → 1차 후보(업무시설 + hoCnt>=50) 추출
  //    같은 지번에 여러 행(신축/증축 등)이 올 수 있어 지번 단위로 dedup
  console.log("[1/3] 기본개요 스캔 (1차 후보: 업무시설 + 호수>=50)...");
  const candidates = new Map();   // pnu → basis row (대표행)
  for (const bjd of bjdList) {
    let page = 1;
    while (page <= MAX_PAGES) {
      let res;
      try { res = await fetchBasisDong(bjd, page); }
      catch (e) { console.error(`  ${bjd} page ${page} 오류: ${e.message}`); break; }
      for (const r of res.items) {
        if (!isOfficetelCandidate(r)) continue;
        const pnu = pnuOf(r);
        // 대표행: bldNm 있는 행 우선, 같은 지번이면 첫 행 유지
        if (!candidates.has(pnu) || (String(r.bldNm || "").trim() && !String(candidates.get(pnu).bldNm || "").trim())) {
          candidates.set(pnu, r);
        }
      }
      if (res.items.length < PAGE_SIZE || res.items.length >= res.totalCount) break;
      page++;
    }
    process.stdout.write(`  ${bjd} 완료 (후보 누적 ${candidates.size})\r`);
  }
  console.log(`\n  1차 후보: ${candidates.size}건\n`);

  if (!candidates.size) {
    console.log("1차 후보 없음. aptlist_extra_donggu.json 을 변경 없이 종료.");
    return;
  }

  // 3) 2차 확정: 층별개요 오피스텔 비중 >= 50%
  console.log("[2/3] 층별개요 오피스텔 비중 확인 (임계값 50%)...");
  const candList = [...candidates.values()];
  const flrResults = await runPool(candList, async (r) => {
    const bun = String(r.bun || "").padStart(4, "0");
    const ji  = String(r.ji  || "").padStart(4, "0");
    try {
      const { items } = await fetchFlr(SIGUNGU, r.bjdongCd, String(r.platGbCd || "0"), bun, ji);
      return { basis: r, flrItems: items, ratio: officetelRatio(items) };
    } catch (e) {
      return { basis: r, flrItems: [], ratio: 0, error: e.message };
    }
  }, CONCURRENCY);

  const confirmed = [];
  let dropped = 0;
  for (const fr of flrResults) {
    if (fr.error) { dropped++; continue; }
    if (fr.ratio >= MIN_OFFICETEL_RATIO) {
      const pct = (fr.ratio * 100).toFixed(0);
      console.log(`  ✅ ${String(fr.basis.bldNm || "").trim().slice(0,25)} (오피스텔 ${pct}%, 호 ${fr.basis.hoCnt})`);
      confirmed.push(fr.basis);
    } else {
      dropped++;
      const pct = (fr.ratio * 100).toFixed(0);
      console.log(`  ❌ ${String(fr.basis.bldNm || "").trim().slice(0,25)} (오피스텔 ${pct}% → 탈락)`);
    }
  }
  console.log(`\n  2차 확정: ${confirmed.length}건 (탈락 ${dropped}건)\n`);

  if (!confirmed.length) {
    console.log("확정 오피스텔 없음. aptlist_extra_donggu.json 을 변경 없이 종료.");
    return;
  }

  // 4) 표제부 보강 (doroAddr/층수/주차)
  console.log("[3/3] 표제부 보강 (doroAddr/층수/주차)...");
  const entries = [];
  const titleResults = await runPool(confirmed, async (basis) => {
    const bun = String(basis.bun || "").padStart(4, "0");
    const ji  = String(basis.ji  || "").padStart(4, "0");
    try {
      const { items } = await fetchTitle(SIGUNGU, basis.bjdongCd, String(basis.platGbCd || "0"), bun, ji);
      return buildEntry(basis, items);
    } catch (e) {
      return buildEntry(basis, []);   // 표제부 실패 시 기본개요만으로 생성
    }
  }, CONCURRENCY);
  for (const e of titleResults) {
    if (e && !e.__error) entries.push(e);
  }

  // 5) 보존 병합
  let existing = [];
  try { existing = JSON.parse(await readFile(extraPath, "utf8")); }
  catch { existing = []; }
  const { merged, added, filled } = mergePreserve(existing, entries);

  // PNU 기준 정렬로 출력 안정화
  merged.sort((a, b) => String(a.pnu).localeCompare(String(b.pnu)));

  await writeFile(extraPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  console.log(`\n완료: 신규 추가 ${added}건, 기존 보강 ${filled}건 → ${extraPath}`);
  console.log(`총 ${merged.length}건 (기존 ${existing.length}건)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
