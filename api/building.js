// /api/building?sigunguCd=12210&bjdongCd=10100&platGbCd=0&bun=0123&ji=0004   (단건: 번지 지정)
// /api/building?sigunguCd=12210&bjdongCd=10100&numOfRows=1000&pageNo=1       (동단위: 번지 생략)
// 국토교통부 건축HUB 표제부(getBrTitleInfo) 등 프록시.
// op가 getSr* 이면 폐쇄말소대장(ShtRgstHubService)로 엔드포인트를 자동 전환한다.
//   - 필드 구조가 getBr* 과 동일해 응답은 그대로 cardHTML·mergeBuilding 파이프라인에 넘긴다.
//   - 함수를 별도로 두지 않는 이유: Vercel Hobby 플랜 Serverless Function 12개 제한.
// op가 유지점검(getMaintenanceHistory/getInspectionAgency)이면 MtnChkHubService로 전환.
//   - getMaintenanceHistory: getBr* 와 동일한 필지 파라미터(sigunguCd/bjdongCd/bun/ji)
//   - getInspectionAgency: 필지가 아닌 시도 단위(mgmRegSidoCd 필수, chkInsttNm 옵션 부분일치)
//     → 별도 경로(handleAgency)에서 필지 검증을 건너뛴다.
// 응답: { titles:[...], totalCount } / 오류 시 { titles:[], error }
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";
import { unwrapGov } from "./_lib/govapi.js";
import { resolveDataKey } from "./_lib/datakey.js";
import { normalizeDongguHubSigungu } from "./_lib/donggu.js";

const HUB        = "https://apis.data.go.kr/1613000/BldRgstHubService";
const HUB_CLOSED = "https://apis.data.go.kr/1613000/ShtRgstHubService";
const HUB_MTNCHK = "https://apis.data.go.kr/1613000/MtnChkHubService";
const FETCH_TIMEOUT_MS = 8000;
const MAX_ROWS = 1000;

const VALID_PLATGB = new Set(["0", "1", "2"]);   // 0:대지 1:산 2:블록
const numRe = /^\d+$/;
const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";
// dongNm / hoNm: 숫자·한글·영문·하이픈만, 40자 제한
const cleanField = (v) => String(v || "").replace(/[^0-9가-힣A-Za-z\-]/g, "").slice(0, 40);

// 허용 오퍼레이션(화이트리스트) — op 미지정 시 표제부.
// getBr*: 일반 건축물대장 / getSr*: 폐쇄말소대장 / 유지점검 2종 (엔드포인트 자동 전환)
const ALLOWED_OPS = new Set([
  // 일반 건축물대장 (BldRgstHubService)
  "getBrTitleInfo", "getBrRecapTitleInfo", "getBrBasisOulnInfo",
  "getBrFlrOulnInfo", "getBrAtchJibunInfo", "getBrExposPubuseAreaInfo",
  "getBrWclfInfo", "getBrHsprcInfo", "getBrExposInfo", "getBrJijiguInfo",
  // 폐쇄말소대장 (ShtRgstHubService) — 철거·멸실된 건축물의 과거 대장
  "getSrBasisOulnInfo", "getSrRecapTitleInfo", "getSrTitleInfo",
  "getSrFlrOulnInfo", "getSrAtchJibunInfo", "getSrExposPubuseAreaInfo",
  "getSrWclfInfo", "getSrHsprcInfo", "getSrExposInfo", "getSrJijiguInfo",
  // 건축물유지점검 (MtnChkHubService)
  "getMaintenanceHistory",   // 정기점검이력 — 필지 단위
  "getInspectionAgency",     // 점검기관 목록 — 시도 단위 (필지 파라미터 없음)
]);

async function callHub(endpoint, params, serviceKey) {
  const q = { sigunguCd: params.sigunguCd, bjdongCd: params.bjdongCd, _type: "json" };
  const targetPlatGb = String(params.platGbCd || "");
  if (VALID_PLATGB.has(targetPlatGb)) q.platGbCd = targetPlatGb;
  if (params.bun) q.bun = params.bun;
  if (params.ji)  q.ji  = params.ji;
  if (params.dongNm) q.dongNm = params.dongNm;
  if (params.hoNm)   q.hoNm   = params.hoNm;
  q.numOfRows = params.numOfRows || "100";
  q.pageNo    = params.pageNo || "1";

  const qs = new URLSearchParams(q).toString();
  // serviceKey 는 '디코딩 키'를 환경변수에 넣고 여기서 1회만 인코딩
  const url = `${endpoint}/${params.op}?serviceKey=${encodeURIComponent(serviceKey)}&${qs}`;

  const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
  const text = await r.text();
  const { items, totalCount } = unwrapGov(text, params.op);
  return { titles: items, totalCount };
}

// 점검기관 조회 — 필지가 아닌 시도 단위라 별도 경로.
// 필수 mgmRegSidoCd(시도코드 2자리, 광주=29), 옵션 chkInsttNm(기관명 부분일치).
// (가이드: OpenAPI활용가이드-_건축HUB_건축물유지점검_1.0.docx, 실호출 검증 2026-07)
async function handleAgency(req, res) {
  const sido = one(req.query.mgmRegSidoCd).trim();
  if (!/^\d{2}$/.test(sido))
    return res.status(400).json({ titles: [], error: "필수 파라미터(mgmRegSidoCd: 시도코드 2자리) 누락/형식 오류" });
  // 기관명: 한글·영문·숫자·공백·괄호·중점만 허용 (주식회사 (주) 등 포함)
  const nm = String(one(req.query.chkInsttNm) || "")
    .replace(/[^0-9가-힣A-Za-z()·\-\s]/g, "").replace(/\s+/g, " ").slice(0, 100).trim();

  const rows = Math.min(Math.max(parseInt(one(req.query.numOfRows), 10) || 100, 1), MAX_ROWS);
  const page = Math.max(parseInt(one(req.query.pageNo), 10) || 1, 1);

  const serviceKey = resolveDataKey(res, "MTNCHK_SERVICE_KEY", "BLD_SERVICE_KEY");
  if (!serviceKey) return;

  const q = { mgmRegSidoCd: sido, _type: "json", numOfRows: String(rows), pageNo: String(page) };
  if (nm) q.chkInsttNm = nm;
  const url = `${HUB_MTNCHK}/getInspectionAgency?serviceKey=${encodeURIComponent(serviceKey)}&${new URLSearchParams(q)}`;

  try {
    const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
    const text = await r.text();
    const { items, totalCount } = unwrapGov(text, "getInspectionAgency");
    setSecurity(res);
    // 기관 등록 정보는 변동이 드물다 → 캐시 연장
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate");
    return res.status(200).json({ titles: items, totalCount });
  } catch (e) {
    return fail(res, e, "agency");
  }
}

// 상세 메시지는 로그에만(키 마스킹), 사용자에겐 안전 문구
function fail(res, e, tag) {
  const msg = e?.message || "";
  let safe = "서버 오류";
  if (e?.name === "AbortError") safe = "상류 응답 시간 초과";
  else if (msg.includes("파싱 실패")) safe = "API 응답 파싱 오류";
  else if (msg.includes("상류") || msg.includes(":")) safe = "외부 API 오류";

  const masked = msg.replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
  console.error(`[building/${tag}] handler error:`, masked);
  return res.status(502).json({ titles: [], error: safe });
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  // op 화이트리스트 검증. (getSr*=폐쇄말소, 유지점검 2종, 그 외 기본=getBrTitleInfo)
  const opRaw = one(req.query.op).trim();
  const op = ALLOWED_OPS.has(opRaw) ? opRaw : "getBrTitleInfo";

  // 점검기관 조회는 시도 단위라 필지 검증 전에 분기
  if (op === "getInspectionAgency") return handleAgency(req, res);

  const sigunguCd = normalizeDongguHubSigungu(one(req.query.sigunguCd).trim());
  const bjdongCd  = one(req.query.bjdongCd).trim();
  const platGbCd  = one(req.query.platGbCd).trim();
  const bunRaw    = one(req.query.bun).trim();
  const jiRaw     = one(req.query.ji).trim();

  if (!sigunguCd || !bjdongCd)
    return res.status(400).json({ titles: [], error: "필수 파라미터(sigunguCd/bjdongCd) 누락" });
  if (!numRe.test(sigunguCd) || !numRe.test(bjdongCd))
    return res.status(400).json({ titles: [], error: "sigunguCd/bjdongCd 형식 오류" });
  if (bunRaw && !numRe.test(bunRaw))
    return res.status(400).json({ titles: [], error: "bun 형식 오류" });
  if (jiRaw && !numRe.test(jiRaw))
    return res.status(400).json({ titles: [], error: "ji 형식 오류" });

  // 서비스키: getSr*(폐쇄말소)면 SHT, 유지점검이면 MTNCHK 우선, 아니면 BLD.
  // 동일 키가 여러 서비스에 승인돼 있으면 어느 쪽이든 동작한다.
  // DATA_SERVICE_KEY 단일 키로 통합 설정해도 호환 (resolveDataKey가 자동 폴백).
  const isClosed = op.startsWith("getSr");
  const isMtnChk = op === "getMaintenanceHistory";
  const serviceKey = isClosed
    ? resolveDataKey(res, "SHT_SERVICE_KEY", "BLD_SERVICE_KEY")
    : isMtnChk
      ? resolveDataKey(res, "MTNCHK_SERVICE_KEY", "BLD_SERVICE_KEY")
      : resolveDataKey(res, "BLD_SERVICE_KEY");
  if (!serviceKey) return;

  // 엔드포인트: getSr* → 폐쇄말소대장 HUB, 유지점검 → MtnChk HUB, 그 외 → 일반 건축물대장 HUB
  const endpoint = isClosed ? HUB_CLOSED : isMtnChk ? HUB_MTNCHK : HUB;

  const normalizedBun = bunRaw ? bunRaw.padStart(4, "0") : "";
  const normalizedJi  = normalizedBun ? (jiRaw ? jiRaw.padStart(4, "0") : "0000") : "";

  const rows = Math.min(Math.max(parseInt(one(req.query.numOfRows), 10) || 100, 1), MAX_ROWS);
  const page = Math.max(parseInt(one(req.query.pageNo), 10) || 1, 1);

  const params = {
    op,
    sigunguCd, bjdongCd,
    platGbCd: platGbCd || "",
    bun: normalizedBun,
    ji:  normalizedJi,
    dongNm: cleanField(one(req.query.dongNm)),
    hoNm:   cleanField(one(req.query.hoNm)),
    numOfRows: String(rows),
    pageNo: String(page),
  };

  try {
    const { titles, totalCount } = await callHub(endpoint, params, serviceKey);
    setSecurity(res);
    // 폐쇄말소(사라진 건축물)·유지점검이력(연 1회 갱신)은 변동이 드물다 → 캐시 연장
    const maxAge = (isClosed || isMtnChk) ? 604800 : 86400;
    res.setHeader("Cache-Control", `s-maxage=${maxAge}, stale-while-revalidate`);
    return res.status(200).json({ titles, totalCount });
  } catch (e) {
    return fail(res, e, isClosed ? "closed" : isMtnChk ? "mtnchk" : "main");
  }
}

