// /api/aptlist?op=getSigunguAptList3&sigunguCd=29110
// 국토교통부 공동주택 단지 목록제공 서비스(AptListService3) 프록시
// 시군구코드로 동구 전체 단지코드/단지명 목록을 한 번에 조회
// 응답: { complexes:[{kaptCode,kaptName}], totalCount } / 오류 시 { complexes:[], error }
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";
import { unwrapGov } from "./_lib/govapi.js";

const BASE = "https://apis.data.go.kr/1613000/AptListService3";
const FETCH_TIMEOUT_MS = 8000;

const numRe = /^\d+$/;
const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";

const ALLOWED_OPS = new Set(["getSidoAptList3", "getSigunguAptList3", "getTotalAptList3", "getLegaldongAptList3", "getRoadnameAptList3"]);

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const op = one(req.query.op).trim();
  if (!ALLOWED_OPS.has(op))
    return res.status(400).json({ complexes: [], error: "허용되지 않은 op" });

  // 공동주택 단지목록 서비스 전용 키. 미설정 시 기존 키로 폴백
  const serviceKey = process.env.APT_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
  if (!serviceKey)
    return res.status(500).json({ complexes: [], error: "APT_SERVICE_KEY/BLD_SERVICE_KEY 환경변수 미설정" });

  const q = { _type: "json", pageNo: one(req.query.pageNo).trim() || "1", numOfRows: one(req.query.numOfRows).trim() || "500" };

  // op별 필수 파라미터 검증
  if (op === "getSigunguAptList3") {
    const sigunguCd = one(req.query.sigunguCd).trim();
    if (!sigunguCd || !numRe.test(sigunguCd))
      return res.status(400).json({ complexes: [], error: "sigunguCd 누락/형식 오류" });
    q.sigunguCd = sigunguCd;
  } else if (op === "getSidoAptList3") {
    const sidoCd = one(req.query.sidoCd).trim();
    if (!sidoCd || !numRe.test(sidoCd))
      return res.status(400).json({ complexes: [], error: "sidoCd 누락/형식 오류" });
    q.sidoCd = sidoCd;
  } else if (op === "getLegaldongAptList3") {
    const bjdongCd = one(req.query.bjdongCd).trim();
    if (!bjdongCd || !numRe.test(bjdongCd))
      return res.status(400).json({ complexes: [], error: "bjdongCd 누락/형식 오류" });
    q.bjdongCd = bjdongCd;
  }
  // getTotalAptList3 / getRoadnameAptList3 는 추가 파라미터 선택

  // serviceKey 는 '디코딩 키'를 환경변수에 넣고 여기서 1회만 인코딩
  const url = `${BASE}/${op}?serviceKey=${encodeURIComponent(serviceKey)}&${new URLSearchParams(q)}`;

  try {
    const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
    const text = await r.text();
    const { items, totalCount } = unwrapGov(text, op);
    // 단지코드/단지명만 뽑아 정제
    const complexes = items.map(it => ({
      kaptCode: String(it.kaptCode || it.aptCode || "").trim(),
      kaptName: String(it.kaptName || it.aptName || "").trim(),
    })).filter(c => c.kaptCode);
    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json({ complexes, totalCount });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    const masked = String(e?.message || e).replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
    console.error("[aptlist]", masked);
    return res.status(aborted ? 504 : 502)
      .json({ complexes: [], error: aborted ? "상류 응답 시간 초과" : "외부 API 오류" });
  }
}
