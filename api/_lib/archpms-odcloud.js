// /api/_lib/archpms-odcloud.js
// 광주 동구 "건축허가현황" OpenData API (odcloud.kr) 폴백 모듈
// 국토교통부 건축HUB ArchPmsHubService/getApBasisOulnInfo 형식으로 정규화
//
// odcloud API는 동구 전체 건축허가 데이터를 페이지 단위로 반환하며, PNU/번지 필터를
// 지원하지 않는다. 따라서 전체 데이터를 받아온 뒤 "대지위치" 문자열을 파싱하여
// 요청한 번지에 해당하는 행만 골라낸다.

import { fetchWithTimeout } from "./proxy.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HJ_PATH = join(__dirname, "..", "..", "haengjeong.json");

const BASE = "https://api.odcloud.kr/api/15092094/v1/uddi:71adfa8c-d2cc-4fc9-ac98-e3385898a609";
const FETCH_TIMEOUT_MS = 15000;
const PER_PAGE = 1000;

const numRe = /^\d+$/;

let hdongMapCache = null;
let hdongMapPromise = null;

async function loadHdongMap() {
  if (hdongMapCache) return hdongMapCache;
  if (hdongMapPromise) return hdongMapPromise;
  hdongMapPromise = (async () => {
    const text = await readFile(HJ_PATH, "utf8");
    const { hdong2bjd } = JSON.parse(text);
    const map = new Map(); // 동명(숫자 제거/포함) -> Set(bjdongCd)
    for (const [hdong, bjdList] of Object.entries(hdong2bjd || {})) {
      for (const bjd of bjdList) {
        // 1) 원본 동명
        push(map, hdong, bjd);
        // 2) 끝의 숫자+동 제거 (산수1동 -> 산수동)
        const base = hdong.replace(/\d+동$/, "동");
        if (base !== hdong) push(map, base, bjd);
      }
    }
    hdongMapCache = map;
    return map;
  })();
  return hdongMapPromise;
}

function push(map, key, bjd) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(bjd);
}

// "대지위치" 문자열에서 동명, 본번, 부번을 추출
// 예) "광주광역시 동구 산수동 123-45" -> { dong: "산수동", bun: "123", ji: "45" }
// 예) "광주광역시 동구 충장동 45"     -> { dong: "충장동", bun: "45", ji: "" }
// 예) "광주광역시 동구 지원1동 123"  -> { dong: "지원1동", bun: "123", ji: "" }
function parseDongJibun(platPlc) {
  const s = String(platPlc || "").trim();
  if (!s) return null;

  // "동구" 다음의 첫 토큰이 동명
  const m = s.match(/(?:^|.*?동구)\s+([가-힣]+(?:\d+)?동)\s+(\d+)(?:-(\d+))?/);
  if (!m) return null;

  return {
    dong: m[1],
    bun: m[2] || "",
    ji: m[3] || "",
  };
}

function matchesPnu(row, params, hdongMap) {
  const parsed = parseDongJibun(row["대지위치"]);
  if (!parsed) return false;

  const bjdCandidates = hdongMap.get(parsed.dong);
  if (!bjdCandidates || !bjdCandidates.has(params.bjdongCd)) return false;

  const bun = String(parsed.bun || "").padStart(4, "0");
  const ji = String(parsed.ji || "").padStart(4, "0");
  return bun === params.bun && ji === params.ji;
}

function normalizeOdcloudRow(row) {
  const r = row || {};
  const num = (v) => {
    const n = Number(String(v || "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const str = (v) => String(v || "").trim();

  return {
    archGbCdNm: str(r["건축구분"]),
    archNo: str(r["허가번호"]),
    platPlc: str(r["대지위치"]),
    platArea: num(r["대지면적"]),
    archArea: num(r["건축면적"]),
    totArea: num(r["연면적"]),
    bcRat: num(r["건폐율"]),
    vlRat: num(r["용적률"]),
    archPmsDay: str(r["허가일"]),
    grndFlrCnt: num(r["최대지상층수"]),
    ugrndFlrCnt: num(r["최대지하층수"]),
    heit: num(r["최고높이"]),
    dongCnt: num(r["동수"]),
    mainPurpsCdNm: str(r["주용도"]),
    subPurpsCdNm: str(r["부속용도"]),
    jiguCdNm: str(r["용도지역"]),
    gjiguCdNm: str(r["용도지구"]),
    regCdNm: str(r["용도구역"]),
    // odcloud에는 없는 필드
    realStcnsDay: "",
    useAprDay: "",
    totPkngCnt: 0,
  };
}

async function fetchAllOdcloudData(serviceKey) {
  const all = [];
  let page = 1;
  while (true) {
    const url = `${BASE}?page=${page}&perPage=${PER_PAGE}&serviceKey=${encodeURIComponent(serviceKey)}`;
    const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`odcloud 응답 파싱 실패: ${text.slice(0, 120)}`);
    }
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

// params: { sigunguCd, bjdongCd, platGbCd, bun, ji }
// bun/ji 는 4자리 zero-padded 문자열로 전달받아야 한다.
export async function fetchOdcloudBasisOuln(params) {
  if (!params || !params.bjdongCd || !params.bun) return { items: [], totalCount: 0 };
  if (!numRe.test(params.bjdongCd)) return { items: [], totalCount: 0 };

  const serviceKey = process.env.ODCLOUD_SERVICE_KEY;
  if (!serviceKey) return { items: [], totalCount: 0 };

  const hdongMap = await loadHdongMap();
  const all = await fetchAllOdcloudData(serviceKey);
  const matched = all
    .filter((row) => matchesPnu(row, params, hdongMap))
    .map(normalizeOdcloudRow);

  return { items: matched, totalCount: matched.length };
}

// 에러 발생 시 안전하게 빈 결과 반환
export async function fetchOdcloudBasisOulnSafe(params) {
  try {
    return await fetchOdcloudBasisOuln(params);
  } catch (e) {
    const masked = String(e?.message || e).replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
    console.error("[archpms-odcloud]", masked);
    return { items: [], totalCount: 0 };
  }
}

// 테스트/검증용 export
export { parseDongJibun, loadHdongMap, normalizeOdcloudRow, matchesPnu };
