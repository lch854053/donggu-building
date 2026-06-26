// /api/vworld-geocode?address=동계로 68
// VWorld 지오코더 프록시(주소 → 좌표). road 우선, 실패 시 parcel 재시도.
import { guard, fetchWithTimeout, setSecurity, requireEnv, failJson } from "./_lib/proxy.js";

const VWORLD_URL = "https://api.vworld.kr/req/address";
const MAX_ADDR_LEN = 100;

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const address = (req.query.address || "").toString().trim();
  if (!address) return res.status(400).json({ error: "address 누락" });
  if (address.length > MAX_ADDR_LEN)
    return res.status(400).json({ error: "address가 너무 김" });

  const key = requireEnv(res, "VWORLD_KEY");
  if (!key) return;

  async function geocode(type) {
    const params = new URLSearchParams({
      service: "address", request: "getcoord", crs: "epsg:4326",
      address, format: "json", type, key,
    });
    try {
      const r = await fetchWithTimeout(`${VWORLD_URL}?${params}`);
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  try {
    let data = await geocode("road");
    if (data?.response?.status !== "OK") data = await geocode("parcel");
    if (data?.response?.status !== "OK") return res.status(200).json({ found: false });

    const point = data.response.result.point;  // {x:경도, y:위도}
    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json({ found: true, x: point.x, y: point.y });
  } catch (e) {
    return failJson(res, e, "vworld-geocode");
  }
}
