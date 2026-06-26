// /api/juso?keyword=동명동 123-4
// 행정안전부 도로명주소 검색 API 프록시(서버 호출 → CORS 없음)
// 응답: { juso: [...] }
import { guard, fetchWithTimeout, setSecurity, requireEnv } from "./_lib/proxy.js";

const JUSO_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do";
const MAX_KEYWORD_LEN = 80;

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const keyword = (req.query.keyword || "").toString().trim();
  if (!keyword) return res.status(400).json({ juso: [], error: "keyword 누락" });
  if (keyword.length > MAX_KEYWORD_LEN)
    return res.status(400).json({ juso: [], error: "keyword가 너무 김" });

  const confmKey = requireEnv(res, "JUSO_CONFM_KEY");
  if (!confmKey) return;

  const params = new URLSearchParams({
    confmKey, currentPage: "1", countPerPage: "5", resultType: "json", keyword,
  });

  try {
    const r = await fetchWithTimeout(`${JUSO_URL}?${params}`);
    if (!r.ok) return res.status(502).json({ juso: [], error: "주소 API 응답 오류" });

    const data = await r.json();
    const common = data?.results?.common || {};
    if (common.errorCode && common.errorCode !== "0")  // 0=정상
      return res.status(200).json({ juso: [], error: common.errorMessage || common.errorCode });

    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json({ juso: data?.results?.juso || [] });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    console.error("[juso]", aborted ? "timeout" : e?.message || e);
    return res.status(aborted ? 504 : 502).json({ juso: [], error: "서버 오류" });
  }
}
