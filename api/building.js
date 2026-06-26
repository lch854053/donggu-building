// /api/building?sigunguCd=29110&bjdongCd=10100&platGbCd=0&bun=0123&ji=0004   (단건: 번지 지정)
// /api/building?sigunguCd=29110&bjdongCd=10100&numOfRows=1000&pageNo=1       (동단위: 번지 생략)
// 국토교통부 건축HUB 표제부(getBrTitleInfo) 등 프록시
// 응답: { titles:[...], totalCount } / 오류 시 { titles:[], error }
import { guard, fetchWithTimeout, setSecurity } from "./_lib/proxy.js";
import { unwrapGov } from "./_lib/govapi.js";

const HUB = "https://apis.data.go.kr/1613000/BldRgstHubService";
const FETCH_TIMEOUT_MS = 8000;
const MAX_ROWS = 1000;

const VALID_PLATGB = new Set(["0", "1", "2"]);   // 0:대지 1:산 2:블록
const numRe = /^\d+$/;
const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";
// dongNm / hoNm: 숫자·한글·영문·하이픈만, 40자 제한
const cleanField = (v) => String(v || "").replace(/[^0-9가-힣A-Za-z\-]/g, "").slice(0, 40);

// 허용 오퍼레이션(화이트리스트) — op 미지정 시 표제부
const ALLOWED_OPS = new Set([
  "getBrTitleInfo", "getBrRecapTitleInfo", "getBrBasisOulnInfo",
  "getBrFlrOulnInfo", "getBrAtchJibunInfo", "getBrExposPubuseAreaInfo",
  "getBrWclfInfo", "getBrHsprcInfo", "getBrExposInfo", "getBrJijiguInfo",
]);

async function callHub(endpoint, params, serviceKey) {
  const q = { sigunguCd: params.sigunguCd, bjdongCd: params.bjdongCd, _type: "json" };
  const targetPlatGb = String(params.platGbCd || "");
  if (VALID_PLATGB.has(targetPlatGb)) q.platGbCd = targetPlatGb;
  if (params.bun) q.bun = params.bun;
  if (params.ji)  q.ji  = params.ji;
  if (params.dongNm) q.dongNm = params.dongNm;
  if (params.hoNm)   q.hoNm   = params.hoNm;
  q.numOfRows = params.numOfRows || "100";
  q.pageNo    = params.pageNo || "1";

  const qs = new URLSearchParams(q).toString();
  // serviceKey 는 '디코딩 키'를 환경변수에 넣고 여기서 1회만 인코딩
  const url = `${HUB}/${endpoint}?serviceKey=${encodeURIComponent(serviceKey)}&${qs}`;

  const r = await fetchWithTimeout(url, { timeout: FETCH_TIMEOUT_MS });
  const text = await r.text();
  const { items, totalCount } = unwrapGov(text, endpoint);
  return { titles: items, totalCount };
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const sigunguCd = one(req.query.sigunguCd).trim();
  const bjdongCd  = one(req.query.bjdongCd).trim();
  const platGbCd  = one(req.query.platGbCd).trim();
  const bunRaw    = one(req.query.bun).trim();
  const jiRaw     = one(req.query.ji).trim();

  if (!sigunguCd || !bjdongCd)
    return res.status(400).json({ titles: [], error: "필수 파라미터(sigunguCd/bjdongCd) 누락" });
  if (!numRe.test(sigunguCd) || !numRe.test(bjdongCd))
    return res.status(400).json({ titles: [], error: "sigunguCd/bjdongCd 형식 오류" });
  if (bunRaw && !numRe.test(bunRaw))
    return res.status(400).json({ titles: [], error: "bun 형식 오류" });
  if (jiRaw && !numRe.test(jiRaw))
    return res.status(400).json({ titles: [], error: "ji 형식 오류" });

  const serviceKey = process.env.BLD_SERVICE_KEY;
  if (!serviceKey)
    return res.status(500).json({ titles: [], error: "BLD_SERVICE_KEY 환경변수 미설정" });

  const normalizedBun = bunRaw ? bunRaw.padStart(4, "0") : "";
  const normalizedJi  = normalizedBun ? (jiRaw ? jiRaw.padStart(4, "0") : "0000") : "";

  const rows = Math.min(Math.max(parseInt(one(req.query.numOfRows), 10) || 100, 1), MAX_ROWS);
  const page = Math.max(parseInt(one(req.query.pageNo), 10) || 1, 1);

  const opRaw = one(req.query.op).trim();
  const op = ALLOWED_OPS.has(opRaw) ? opRaw : "getBrTitleInfo";

  const params = {
    sigunguCd, bjdongCd,
    platGbCd: platGbCd || "",
    bun: normalizedBun,
    ji:  normalizedJi,
    dongNm: cleanField(one(req.query.dongNm)),
    hoNm:   cleanField(one(req.query.hoNm)),
    numOfRows: String(rows),
    pageNo: String(page),
  };

  try {
    const { titles, totalCount } = await callHub(op, params, serviceKey);
    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({ titles, totalCount });
  } catch (e) {
    // 상세 메시지는 로그에만(키 마스킹), 사용자에겐 안전 문구
    const msg = e?.message || "";
    let safe = "서버 오류";
    if (e?.name === "AbortError") safe = "상류 응답 시간 초과";
    else if (msg.includes("파싱 실패")) safe = "API 응답 파싱 오류";
    else if (msg.includes("상류") || msg.includes(":")) safe = "외부 API 오류";

    const masked = msg.replace(/serviceKey=[^&\s]+/gi, "serviceKey=***");
    console.error("[building] handler error:", masked);
    return res.status(502).json({ titles: [], error: safe });
  }
}
