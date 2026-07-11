// /api/vacant
// odcloud "전남광주통합특별시 동구_빈집 현황" 프록시
// 응답: { items: [...], totalCount }
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";

const BASE = "https://api.odcloud.kr/api/15144631/v1/uddi:4b08ea19-5d8e-4050-99a6-bf6905c56b06";
const FETCH_TIMEOUT_MS = 15000;
const PER_PAGE = 1000;

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const serviceKey = process.env.ODCLOUD_SERVICE_KEY;
  if (!serviceKey)
    return res.status(500).json({ items: [], error: "ODCLOUD_SERVICE_KEY 환경변수 미설정" });

  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const perPage = Math.min(Math.max(parseInt(req.query.perPage || String(PER_PAGE), 10), 1), PER_PAGE);
  const url = `${BASE}?page=${page}&perPage=${perPage}&serviceKey=${encodeURIComponent(serviceKey)}`;

  try {
    const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`odcloud 응답 파싱 실패: ${text.slice(0, 120)}`); }

    if (data?.errMsg || data?.returnAuthMsg) {
      throw new Error(`odcloud 인증/한도 오류: ${data.errMsg || data.returnAuthMsg}`);
    }

    const rows = Array.isArray(data?.data) ? data.data : [];
    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json({ items: rows, totalCount: Number(data?.totalCount || rows.length) });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    const masked = String(e?.message || e).replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
    console.error("[vacant]", masked);
    return res.status(aborted ? 504 : 502)
      .json({ items: [], error: aborted ? "상류 응답 시간 초과" : "외부 API 오류" });
  }
}
