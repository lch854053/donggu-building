// VWorld 2D데이터 프록시 (좌표 → 연속지적도 필지 → PNU)

const VWORLD_URL = "https://api.vworld.kr/req/data";
const ALLOWED_HOSTS = ["donggu-building.vercel.app", "localhost:3000"];
const FETCH_TIMEOUT_MS = 5000;
const DOMAIN = "https://donggu-building.vercel.app";

function isAllowedOrigin(req) {
  const ref = req.headers.origin || req.headers.referer || "";
  if (!ref) return false;
  try {
    return ALLOWED_HOSTS.includes(new URL(ref).host);
  } catch {
    return false;
  }
}

const numRe = /^-?\d+(\.\d+)?$/;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET만 허용" });
  }

  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: "허용되지 않은 출처" });
  }

  const x = (req.query.x || "").toString().trim();  // 경도
  const y = (req.query.y || "").toString().trim();  // 위도
  const pnuQ = (req.query.pnu || "").toString().trim();

  if (!numRe.test(x) || !numRe.test(y)) {
    return res.status(400).json({ error: "좌표 형식 오류" });
  }

  const key = process.env.VWORLD_KEY;
  if (!key) return res.status(500).json({ error: "VWORLD_KEY 미설정" });

  // params 객체를 먼저 만들고 분기에서 추가
  const params = new URLSearchParams({
    service: "data",
    request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",       // 연속지적도 필지(부분)
    crs: "EPSG:4326",
    format: "json",
    size: "10",
    key,
    domain: DOMAIN,
  });

  if (pnuQ) {
    if (!/^\d{19}$/.test(pnuQ)) {
      return res.status(400).json({ error: "PNU 형식 오류" });
    }
    params.append("attrFilter", `pnu:=:${pnuQ}`);
  } else {
    params.append("geomFilter", `POINT(${x} ${y})`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const r = await fetch(`${VWORLD_URL}?${params}`, { signal: ctrl.signal });
    if (!r.ok) return res.status(502).json({ error: "지적도 API 응답 오류" });

    const data = await r.json();
    const status = data?.response?.status;

    if (status !== "OK") {
      return res.status(200).json({ found: false, raw: status || "no result" });
    }

    const features = data?.response?.result?.featureCollection?.features || [];
    if (!features.length) {
      return res.status(200).json({ found: false, raw: "필지 없음" });
    }

    const p = features[0].properties || {};
    const pnu = String(p.pnu || "");

    if (pnu.length !== 19) {
      return res.status(200).json({ found: false, raw: "PNU 형식 이상", pnu });
    }

    // PNU 19자리 분해: 시군구(5) 법정동(5) 산구분(1) 본번(4) 부번(4)
    const parsed = {
      pnu,
      sigunguCd: pnu.substring(0, 5),
      bjdongCd:  pnu.substring(5, 10),
      platGbCd:  pnu.substring(10, 11) === "2" ? "1" : "0",
      bun:       pnu.substring(11, 15),
      ji:        pnu.substring(15, 19),
    };

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).json({
      found: true,
      ...parsed,
      addr: p.addr || "",
      jibun: p.jibun || "",
      geometry: features[0].geometry || null,
    });

  } catch (e) {
    const aborted = e?.name === "AbortError";
    console.error("[vworld-parcel]", aborted ? "timeout" : e?.message || e);
    return res.status(aborted ? 504 : 502).json({ error: "서버 오류" });
  } finally {
    clearTimeout(timer);
  }
}
