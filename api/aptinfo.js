// /api/aptinfo?op=getAphusBassInfoV4&kaptCode=A10025850
// /api/aptinfo?op=getAphusDtlInfoV4&kaptCode=A10025850
// 국토교통부 공동주택 기본 정보제공 서비스(AptBasisInfoServiceV4) 프록시
// 단지코드로 단지 기본/상세 정보 1건 조회
// 응답: { info:{...} } / 오류 시 { info:null, error }
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";
import { unwrapGov } from "./_lib/govapi.js";

const BASE = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4";
const FETCH_TIMEOUT_MS = 8000;

const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";
const codeRe = /^[A-Za-z0-9]{1,40}$/;

const ALLOWED_OPS = new Set(["getAphusBassInfoV4", "getAphusDtlInfoV4"]);

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const op = one(req.query.op).trim();
  if (!ALLOWED_OPS.has(op))
    return res.status(400).json({ info: null, error: "허용되지 않은 op" });

  const kaptCode = one(req.query.kaptCode).trim();
  if (!kaptCode || !codeRe.test(kaptCode))
    return res.status(400).json({ info: null, error: "kaptCode 누락/형식 오류" });

  // 공동주택 기본정보 서비스 전용 키. 미설정 시 기존 키로 폴백
  const serviceKey = process.env.APT_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
  if (!serviceKey)
    return res.status(500).json({ info: null, error: "APT_SERVICE_KEY/BLD_SERVICE_KEY 환경변수 미설정" });

  const qs = new URLSearchParams({ kaptCode, _type: "json" });
  // serviceKey 는 '디코딩 키'를 환경변수에 넣고 여기서 1회만 인코딩
  const url = `${BASE}/${op}?serviceKey=${encodeURIComponent(serviceKey)}&${qs}`;

  try {
    const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
    const text = await r.text();
    const { items, totalCount } = unwrapGov(text, op);
    const info = items[0] || null;   // 단지 1건
    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({ info, totalCount });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    const masked = String(e?.message || e).replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
    console.error("[aptinfo]", masked);
    return res.status(aborted ? 504 : 502)
      .json({ info: null, error: aborted ? "상류 응답 시간 초과" : "외부 API 오류" });
  }
}
