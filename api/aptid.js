// /api/aptid
// 한국부동산원 공동주택 단지 식별정보 조회 서비스(AptIdInfoSvc) 프록시
// odcloud 형식 응답({ data:[...], totalCount }) — 기존 unwrapGov 와 구조가 다름.
// 동구 전체 단지(아파트/연립/다세대/맨션/빌라, ~340개)를 1회 호출로 반환.
// 응답: { complexes:[{complexPk,complexNm,adres,complexGbCd,dongCnt,unitCnt,useaprDt,pnu}], totalCount }
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";

const BASE = "https://api.odcloud.kr/api/AptIdInfoSvc/v1";
const FETCH_TIMEOUT_MS = 15000;
const SIGUNGU = "광주광역시 동구";

const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  // 한국부동산원·K-apt 공통 키. 미설정 시 건축물대장 키로 폴백(동일 키)
  const serviceKey = process.env.APT_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
  if (!serviceKey)
    return res.status(500).json({ complexes: [], error: "APT_SERVICE_KEY/BLD_SERVICE_KEY 환경변수 미설정" });

  // 동구 전체 단지 1회 호출 (perPage 크게)
  const params = new URLSearchParams({
    page: "1",
    perPage: "1000",
    serviceKey,
  });
  // cond[ADRES::LIKE]=광주광역시 동구 → URLSearchParams 는 키에 [ ] 를 인코딩하지만
  // odcloud 는 인코딩된 cond%5B...%5D 를 그대로 받으므로 직접 조립
  const url = `${BASE}/getAptInfo?${params.toString()}&cond%5BADRES%3A%3ALIKE%5D=${encodeURIComponent(SIGUNGU)}`;

  try {
    const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`getAptInfo 응답 파싱 실패: ${text.slice(0, 120)}`); }

    // odcloud 인증 오류 처리
    if (data?.errMsg || data?.returnAuthMsg) {
      throw new Error(`getAptInfo 인증/한도 오류: ${data.errMsg || data.returnAuthMsg}`);
    }

    const rows = Array.isArray(data.data) ? data.data : [];
    const complexes = rows
      .map(d => ({
        complexPk: String(d.COMPLEX_PK || "").trim(),
        complexNm: String(d.COMPLEX_NM1 || d.COMPLEX_NM2 || d.COMPLEX_NM3 || "").trim(),
        adres:     String(d.ADRES || "").trim(),
        complexGbCd: String(d.COMPLEX_GB_CD || "").trim(),
        dongCnt:   Number(d.DONG_CNT || 0),
        unitCnt:   Number(d.UNIT_CNT || 0),
        useaprDt:  String(d.USEAPR_DT || "").trim(),
        pnu:       String(d.PNU || "").trim(),
      }))
      .filter(c => c.complexNm && c.pnu);

    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json({ complexes, totalCount: Number(data.totalCount || complexes.length) });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    const masked = String(e?.message || e).replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
    console.error("[aptid]", masked);
    return res.status(aborted ? 504 : 502)
      .json({ complexes: [], error: aborted ? "상류 응답 시간 초과" : "외부 API 오류" });
  }
}
