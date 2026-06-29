// /api/aptlist
// 국토교통부 공동주택 단지 목록제공 서비스(AptListService3) 프록시
// getSigunguAptList3 / getSidoAptList3 는 빈 결과를 반환하는 불량 op라 사용하지 않음.
// getTotalAptList3(전국 단지)에서 동구(sigunguCd 접두 5자리 29110)만 필터링해 반환.
// 응답: { complexes:[{kaptCode,kaptName,bjdCode,as1,as2,as3}], totalCount } / 오류 시 { complexes:[], error }
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";
import { unwrapGov } from "./_lib/govapi.js";

const BASE = "https://apis.data.go.kr/1613000/AptListService3";
const FETCH_TIMEOUT_MS = 15000;
const MAX_ROWS = 1000;
const MAX_PAGES = 30;   // 전국 ~22000건 / 1000 = 22페이지 정도

const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";
const SIGUNGU = "29110";   // 광주 동구

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  // 공동주택 단지목록 서비스 전용 키. 미설정 시 건축물대장 키로 폴백(동일 키)
  const serviceKey = process.env.APT_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
  if (!serviceKey)
    return res.status(500).json({ complexes: [], error: "APT_SERVICE_KEY/BLD_SERVICE_KEY 환경변수 미설정" });

  // getTotalAptList3 로 전국 단지를 페이지로 긁어 동구만 필터링.
  // (getSigunguAptList3?sigunguCd=29110 는 현재 빈 결과 반환 — API 불량)
  const complexes = [];
  try {
    for (let pg = 1; pg <= MAX_PAGES; pg++) {
      const qs = new URLSearchParams({ _type: "json", numOfRows: String(MAX_ROWS), pageNo: String(pg) });
      const url = `${BASE}/getTotalAptList3?serviceKey=${encodeURIComponent(serviceKey)}&${qs}`;
      const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
      const text = await r.text();
      const { items, totalCount } = unwrapGov(text, "getTotalAptList3");
      if (!items.length) break;
      for (const it of items) {
        const bjdCode = String(it.bjdCode || "");
        if (!bjdCode.startsWith(SIGUNGU)) continue;   // 동구만
        complexes.push({
          kaptCode: String(it.kaptCode || "").trim(),
          kaptName: String(it.kaptName || "").trim(),
          bjdCode,
          as1: String(it.as1 || "").trim(),
          as2: String(it.as2 || "").trim(),
          as3: String(it.as3 || "").trim(),
        });
      }
      const fetched = pg * MAX_ROWS;
      if (fetched >= totalCount || items.length < MAX_ROWS) break;   // 전국 끝
    }
  } catch (e) {
    const aborted = e?.name === "AbortError";
    const masked = String(e?.message || e).replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
    console.error("[aptlist]", masked);
    return res.status(aborted ? 504 : 502)
      .json({ complexes: [], error: aborted ? "상류 응답 시간 초과" : "외부 API 오류" });
  }

  setSecurity(res);
  // 동구 단지 목록은 자주 바뀌지 않아 1시간 캐시
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
  return res.status(200).json({ complexes, totalCount: complexes.length });
}
