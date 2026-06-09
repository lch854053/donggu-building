// /api/juso?keyword=동명동 123-4
// 행정안전부 도로명주소 검색 API 프록시 (서버 측 호출 → CORS 없음)
// 응답: { juso: [ {admCd, lnbrMnnm, lnbrSlno, mtYn, jibunAddr, roadAddr, ...} ] }

const JUSO_URL = "https://business.juso.go.kr/addrlink/addrLinkApi.do";

export default async function handler(req, res) {
  const keyword = (req.query.keyword || "").trim();
  if (!keyword) return res.status(400).json({ juso: [], error: "keyword 누락" });

  const confmKey = process.env.JUSO_CONFM_KEY;
  if (!confmKey) return res.status(500).json({ juso: [], error: "JUSO_CONFM_KEY 환경변수 미설정" });

  const url =
    `${JUSO_URL}?confmKey=${confmKey}` +
    `&currentPage=1&countPerPage=5&resultType=json` +
    `&keyword=${encodeURIComponent(keyword)}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    const common = data?.results?.common || {};

    // juso 오류코드: 0 = 정상
    if (common.errorCode && common.errorCode !== "0") {
      // 외부 API 오류 메시지는 그대로 노출해도 무방 (사용자에게 의미 있는 정보)
      return res.status(200).json({ juso: [], error: common.errorMessage || common.errorCode });
    }

    const juso = data?.results?.juso || [];
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    return res.status(200).json({ juso });
  } catch (e) {
    console.error("[juso] handler error:", e?.message || e);
    return res.status(502).json({ juso: [], error: "서버 오류" });
  }
}
