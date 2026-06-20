// /api/vworld-geocode?address=동계로 68  (디버그 버전: http + cause)
const ALLOWED_HOSTS = ["donggu-building.vercel.app", "localhost:3000"];
const MAX_ADDR_LEN = 100;

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

  try {
    const params = new URLSearchParams({
      service: "address",
      request: "getcoord",
      crs: "epsg:4326",
      address,
      format: "json",
      type: "road",
      key,
    });

    // http로 시도 (VWorld는 http가 더 안정적인 경우가 있음)
    const r = await fetch(`http://api.vworld.kr/req/address?${params}`, {
      headers: { "Referer": "https://donggu-building.vercel.app" },
    });
    const rawText = await r.text();

    return res.status(200).json({
      DEBUG: true,
      httpStatus: r.status,
      rawText: rawText.slice(0, 800),
    });
  } catch (e) {
    return res.status(200).json({
      DEBUG: true,
      caught: String(e?.message || e),
      cause: String(e?.cause?.message || e?.cause || "none"),
    });
  }
}
