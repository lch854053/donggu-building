// /api/vworld-geocode?address=동계로 68
// VWorld 지오코더 프록시 (주소 → 좌표)
const VWORLD_URL = "https://api.vworld.kr/req/address";
const ALLOWED_HOSTS = ["donggu-building.vercel.app", "localhost:3000"];
const MAX_ADDR_LEN = 100;
const FETCH_TIMEOUT_MS = 5000;

function isAllowedOrigin(req) {
  const ref = req.headers.origin || req.headers.referer || "";
  if (!ref) return false;
  try {
    return ALLOWED_HOSTS.includes(new URL(ref).host);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET만 허용" });
  }
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: "허용되지 않은 출처" });
  }

  const address = (req.query.address || "").toString().trim();
  if (!address) return res.status(400).json({ error: "address 누락" });
  if (address.length > MAX_ADDR_LEN)
    return res.status(400).json({ error: "address가 너무 김" });

  const key = process.env.VWORLD_KEY;
  if (!key) return res.status(500).json({ error: "VWORLD_KEY 미설정" });

  // type: road(도로명) 우선, 실패 시 parcel(지번) 재시도
  async function geocode(type) {
    const params = new URLSearchParams({
      service: "address",
      request: "getcoord",
      crs: "epsg:4326",
      address,
      format: "json",
      type,
      key,
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(`${VWORLD_URL}?${params}`, { signal: ctrl.signal });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    let data = await geocode("road");
    let status = data?.response?.status;
    if (status !== "OK") {
      data = await geocode("parcel");
      status = data?.response?.status;
    }
    if (status !== "OK") {
      return res.status(200).json({ found: false });
    }

    const point = data.response.result.point;  // {x: 경도, y: 위도}
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).json({
      found: true,
      x: point.x,
      y: point.y,
    });
  } catch (e) {
    const aborted = e?.name === "AbortError";
    console.error("[vworld-geocode]", aborted ? "timeout" : e?.message || e);
    return res.status(aborted ? 504 : 502).json({ error: "서버 오류" });
  }
}
