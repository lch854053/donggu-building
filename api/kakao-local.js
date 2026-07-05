// /api/kakao-local?query=광주%20동구%20필문대로295번길%2027
// 카카오 로컬 키워드 검색 API 프록시
// K-apt 단지명이 행정동·지번·용도 형태일 때 실제 상호/건물명 보강용
// 응답: { items:[{placeName, addressName, roadAddressName}] } / 오류 시 { items:[], error }
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";

const BASE = "https://dapi.kakao.com/v2/local/search/keyword.json";
const FETCH_TIMEOUT_MS = 5000;
const MAX_SIZE = 5;

const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const query = String(one(req.query.query)).trim();
  if (!query) {
    return res.status(400).json({ items: [], error: "query 누락" });
  }

  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ items: [], error: "KAKAO_REST_API_KEY 환경변수 미설정" });
  }

  const size = Math.min(Math.max(parseInt(one(req.query.size) || "5", 10), 1), MAX_SIZE);
  const qs = new URLSearchParams({ query, size: String(size) }).toString();
  const url = `${BASE}?${qs}`;

  try {
    const r = await fetchWithTimeout(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: { "Authorization": `KakaoAK ${apiKey}` },
    });

    if (!r.ok) {
      const status = r.status;
      const text = await r.text().catch(() => "");
      console.error("[kakao-local]", status, text.slice(0, 200));
      return res.status(502).json({ items: [], error: "카카오 API 응답 오류" });
    }

    const data = await r.json();
    const docs = Array.isArray(data.documents) ? data.documents : [];
    const items = docs.map((doc) => ({
      placeName: String(doc.place_name || "").trim(),
      addressName: String(doc.address_name || "").trim(),
      roadAddressName: String(doc.road_address_name || "").trim(),
      categoryName: String(doc.category_name || "").trim(),
      phone: String(doc.phone || "").trim(),
    }));

    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({ items });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    console.error("[kakao-local]", aborted ? "timeout" : e?.message || e);
    return res.status(aborted ? 504 : 502)
      .json({ items: [], error: aborted ? "상류 응답 시간 초과" : "외부 API 오류" });
  }
}
