// /api/vworld-parcel?x=126.92365&y=35.15785   (좌표 → 필지)
// /api/vworld-parcel?pnu=2911010300100140000   (PNU → 필지)
// VWorld 2D데이터 프록시(좌표 또는 PNU → 연속지적도 필지)
import { guard, fetchWithTimeout, setSecurity, requireEnv, failJson } from "./_lib/proxy.js";

const VWORLD_URL = "https://api.vworld.kr/req/data";
const DOMAIN = "https://donggu-building.vercel.app";
const numRe = /^-?\d+(\.\d+)?$/;
const pnuRe = /^\d{19}$/;

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const x   = (req.query.x   || "").toString().trim();
  const y   = (req.query.y   || "").toString().trim();
  const pnu = (req.query.pnu || "").toString().trim();

  // pnu 우선, 없으면 좌표(POINT)
  let filter;
  if (pnu) {
    if (!pnuRe.test(pnu)) return res.status(400).json({ error: "PNU 형식 오류" });
    filter = { attrFilter: `pnu:=:${pnu}` };
  } else {
    if (!x || !y) return res.status(400).json({ error: "x/y 좌표 또는 pnu 누락" });
    if (!numRe.test(x) || !numRe.test(y))
      return res.status(400).json({ error: "좌표 형식 오류" });
    filter = { geomFilter: `POINT(${x} ${y})` };
  }

  const key = requireEnv(res, "VWORLD_KEY");
  if (!key) return;

  const params = new URLSearchParams({
    service: "data", request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",   // 연속지적도 필지(부분)
    ...filter,
    crs: "EPSG:4326", format: "json", size: "10", key, domain: DOMAIN,
  });

  try {
    const r = await fetchWithTimeout(`${VWORLD_URL}?${params}`);
    if (!r.ok) return res.status(502).json({ error: "지적도 API 응답 오류" });

    const data = await r.json();
    if (data?.response?.status !== "OK")
      return res.status(200).json({ found: false, raw: data?.response?.status || "no result" });

    const features = data?.response?.result?.featureCollection?.features || [];
    if (!features.length) return res.status(200).json({ found: false, raw: "필지 없음" });

    const p = features[0].properties || {};
    const got = String(p.pnu || "");
    if (got.length !== 19)
      return res.status(200).json({ found: false, raw: "PNU 형식 이상", pnu: got });

    // PNU 19자리: 시군구(5) 법정동(5) 산구분(1) 본번(4) 부번(4)
    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json({
      found: true,
      pnu: got,
      sigunguCd: got.substring(0, 5),
      bjdongCd:  got.substring(5, 10),
      platGbCd:  got.substring(10, 11) === "2" ? "1" : "0",  // 2=산
      bun:       got.substring(11, 15),
      ji:        got.substring(15, 19),
      addr:  p.addr  || "",
      jibun: p.jibun || "",
      geometry: features[0].geometry || null,
    });
  } catch (e) {
    return failJson(res, e, "vworld-parcel");
  }
}
