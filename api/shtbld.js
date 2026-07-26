// /api/shtbld?op=getSrTitleInfo&sigunguCd=29110&bjdongCd=10100&platGbCd=0&bun=0123&ji=0004   (단건)
// /api/shtbld?op=getSrTitleInfo&sigunguCd=29110&bjdongCd=10100&numOfRows=1000&pageNo=1     (동단위)
// 국토교통부 건축HUB 폐쇄말소대장(ShtRgstHubService) 프록시.
// 철거·멸실된 건축물의 과거 대장 정보를 제공한다. 필드 구조는 getBr*(건축물대장)과
// 동일하므로 응답은 그대로 cardHTML·mergeBuilding·renderHistory 파이프라인에 넘긴다.
// 응답: { items:[...], totalCount } / 오류 시 { items:[], error }
// 기존 _lib 공통모듈만 재사용하며 building.js 등 기존 프록시는 건드리지 않는다(순수 추가).
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";
import { unwrapGov } from "./_lib/govapi.js";

const HUB = "https://apis.data.go.kr/1613000/ShtRgstHubService";
const FETCH_TIMEOUT_MS = 8000;
const MAX_ROWS = 1000;

const VALID_PLATGB = new Set(["0", "1", "2"]);   // 0:대지 1:산 2:블록
const numRe = /^\d+$/;
const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";

// 허용 오퍼레이션(화이트리스트) — 폐쇄말소대장 10개 상세기능.
// getBr* 표제부/총괄/기본개요/층별/부속지번/전유공용/오수정화/전유부/주택가격/지역지구 완전 대응.
const ALLOWED_OPS = new Set([
  "getSrBasisOulnInfo", "getSrRecapTitleInfo", "getSrTitleInfo",
  "getSrFlrOulnInfo", "getSrAtchJibunInfo", "getSrExposPubuseAreaInfo",
  "getSrWclfInfo", "getSrHsprcInfo", "getSrExposInfo", "getSrJijiguInfo",
]);

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const op = one(req.query.op).trim();
  if (!ALLOWED_OPS.has(op))
    return res.status(400).json({ items: [], error: "허용되지 않은 op" });

  const sigunguCd = one(req.query.sigunguCd).trim();
  const bjdongCd  = one(req.query.bjdongCd).trim();
  const platGbCd  = one(req.query.platGbCd).trim();
  const bunRaw    = one(req.query.bun).trim();
  const jiRaw     = one(req.query.ji).trim();

  if (!sigunguCd || !bjdongCd)
    return res.status(400).json({ items: [], error: "필수 파라미터(sigunguCd/bjdongCd) 누락" });
  if (!numRe.test(sigunguCd) || !numRe.test(bjdongCd))
    return res.status(400).json({ items: [], error: "sigunguCd/bjdongCd 형식 오류" });
  if (bunRaw && !numRe.test(bunRaw))
    return res.status(400).json({ items: [], error: "bun 형식 오류" });
  if (jiRaw && !numRe.test(jiRaw))
    return res.status(400).json({ items: [], error: "ji 형식 오류" });

  // 폐쇄말소대장 서비스 전용 키. 미설정 시 건축물대장 키로 폴백
  // (동일 키가 두 서비스에 모두 승인돼 있으면 폴백으로 동작).
  const serviceKey = process.env.SHT_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
  if (!serviceKey)
    return res.status(500).json({ items: [], error: "SHT_SERVICE_KEY 환경변수 미설정" });

  const rows = Math.min(Math.max(parseInt(one(req.query.numOfRows), 10) || 100, 1), MAX_ROWS);
  const page = Math.max(parseInt(one(req.query.pageNo), 10) || 1, 1);

  const q = { sigunguCd, bjdongCd, _type: "json", numOfRows: String(rows), pageNo: String(page) };
  if (VALID_PLATGB.has(platGbCd)) q.platGbCd = platGbCd;
  if (bunRaw) {
    q.bun = bunRaw.padStart(4, "0");
    q.ji  = jiRaw ? jiRaw.padStart(4, "0") : "0000";
  }

  // serviceKey 는 '디코딩 키'를 환경변수에 넣고 여기서 1회만 인코딩
  const url = `${HUB}/${op}?serviceKey=${encodeURIComponent(serviceKey)}&${new URLSearchParams(q)}`;

  try {
    const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
    const text = await r.text();
    const { items, totalCount } = unwrapGov(text, op);

    setSecurity(res);
    // 폐쇄말소대장은 사라진 건물이라 데이터 변동이 거의 없다. 캐시를 길게 가져간다.
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate=86400");
    return res.status(200).json({ items, totalCount });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    const masked = String(e?.message || e).replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
    console.error("[shtbld]", masked);
    return res.status(aborted ? 504 : 502)
      .json({ items: [], error: aborted ? "상류 응답 시간 초과" : "외부 API 오류" });
  }
}
