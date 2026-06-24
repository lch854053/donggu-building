// /api/vworld-tile?layer=Satellite&z=18&y=12345&x=54321
// VWorld WMTS(배경지도/항공영상) 타일 프록시 — 서버에서 키 주입(은닉)
const ALLOWED_HOSTS = ["donggu-building.vercel.app", "localhost:3000"];
const FETCH_TIMEOUT_MS = 5000;
const LAYERS = { Satellite: "jpeg", Hybrid: "png", Base: "png", gray: "png", midnight: "png" };
const intRe = /^\d+$/;

function isAllowedOrigin(req) {
  const ref = req.headers.origin || req.headers.referer || "";
  if (!ref) return false;
  try { return ALLOWED_HOSTS.includes(new URL(ref).host); } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET만 허용" });
  }
  if (!isAllowedOrigin(req)) return res.status(403).json({ error: "허용되지 않은 출처" });

  const layer = (req.query.layer || "Satellite").toString();
  const ext = LAYERS[layer];
  if (!ext) return res.status(400).json({ error: "layer 오류" });

  const z = (req.query.z || "").toString();
  const y = (req.query.y || "").toString();
  const x = (req.query.x || "").toString();
  if (![z, y, x].every((v) => intRe.test(v)))
    return res.status(400).json({ error: "타일 좌표 오류" });
  if (Number(z) > 20) return res.status(400).json({ error: "zoom 범위 초과" });

  const key = process.env.VWORLD_KEY;
  if (!key) return res.status(500).json({ error: "VWORLD_KEY 미설정" });

  const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}/${z}/${y}/${x}.${ext}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return res.status(204).end();             // 빈 타일 → 지도엔 공백
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", ext === "jpeg" ? "image/jpeg" : "image/png");
    res.setHeader("Cache-Control", "public, s-maxage=604800, max-age=86400, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(buf);
  } catch (e) {
    const aborted = e?.name === "AbortError";
    console.error("[vworld-tile]", aborted ? "timeout" : e?.message || e);
    return res.status(204).end();
  } finally {
    clearTimeout(timer);
  }
}
