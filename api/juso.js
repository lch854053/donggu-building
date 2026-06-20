// /api/juso?keyword=동명동 123-4
// 행정안전부 도로명주소 검색 API 프록시 (서버 측 호출 → CORS 없음)
// 응답: { juso: [ {admCd, lnbrMnnm, lnbrSlno, mtYn, jibunAddr, roadAddr, ...} ] }

const JUSO_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do";
const ALLOWED_HOSTS = ["donggu-building.vercel.app", "localhost:3000"];
const MAX_KEYWORD_LEN = 80;
const FETCH_TIMEOUT_MS = 5000;

function isAllowedOrigin(req) {
  const ref = req.headers.origin || req.headers.referer || "";
  if (!ref) return false;
  try {
    const host = new URL(ref).host;
    if (host === "localhost:3000") return true;
    return host.endsWith(".vercel.app") && host.startsWith("donggu-building");
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ juso: [], error: "GET만 허용" });
  }
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ juso: [], error: "허용되지 않은 출처" });
  }
  const keyword = (req.query.keyword || "").toString().trim();
  if (!keyword) return res.status(400).json({ juso: [], error: "keyword 누락" });
  if (keyword.length > MAX_KEYWORD_LEN)
    return res.status(400).json({ juso: [], error: "keyword가 너무 김" });
  
  const confmKey = process.env.JUSO_CONFM_KEY;
  if (!confmKey)
    return res.status(500).json({ juso: [], error: "JUSO_CONFM_KEY 환경변수 미설정" });

const params = new URLSearchParams({
  confmKey,
  currentPage: "1",
  countPerPage: "5",
  resultType: "json",
  keyword,
});

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  
try {
  const r = await fetch(`${JUSO_URL}?${params}`, { signal: ctrl.signal });
    if (!r.ok)
      return res.status(502).json({ juso: [], error: "주소 API 응답 오류" });

    const data = await r.json();
    const common = data?.results?.common || {};

    // juso 오류코드: 0 = 정상
    if (common.errorCode && common.errorCode !== "0") {
      // 외부 API 오류 메시지는 그대로 노출해도 무방 (사용자에게 의미 있는 정보)
      return res.status(200).json({ juso: [], error: common.errorMessage || common.errorCode });
    }

    const juso = data?.results?.juso || [];
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({ juso });
  } catch (e) {
      const aborted = e?.name === "AbortError";
      console.error("[juso]", aborted ? "timeout" : e?.message || e);
      return res.status(aborted ? 504 : 502).json({ juso: [], error: "서버 오류" });
  } finally {
    clearTimeout(timer);
  }
}
