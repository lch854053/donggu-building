// /api/vworld-tile?layer=Satellite&z=18&y=12345&x=54321
// VWorld WMTS(배경지도/항공영상) 타일 프록시 — 서버에서 키 주입(은닉)
import { guard, fetchWithTimeout, setSecurity, requireEnv } from "./_lib/proxy.js";

const LAYERS = { Satellite: "jpeg", Hybrid: "png", Base: "png", gray: "png", midnight: "png" };
const intRe = /^\d+$/;

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const layer = (req.query.layer || "Satellite").toString();
  const ext = LAYERS[layer];
  if (!ext) return res.status(400).json({ error: "layer 오류" });

  const z = (req.query.z || "").toString();
  const y = (req.query.y || "").toString();
  const x = (req.query.x || "").toString();
  if (![z, y, x].every((v) => intRe.test(v)))
    return res.status(400).json({ error: "타일 좌표 오류" });
  if (Number(z) > 20) return res.status(400).json({ error: "zoom 범위 초과" });

  const key = requireEnv(res, "VWORLD_KEY");
  if (!key) return;

  const url = `https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}/${z}/${y}/${x}.${ext}`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return res.status(204).end();   // 빈 타일 → 지도엔 공백
    const buf = Buffer.from(await r.arrayBuffer());
    setSecurity(res);
    res.setHeader("Content-Type", ext === "jpeg" ? "image/jpeg" : "image/png");
    res.setHeader("Cache-Control", "public, s-maxage=604800, max-age=86400, immutable");
    return res.status(200).send(buf);
  } catch (e) {
    console.error("[vworld-tile]", e?.name === "AbortError" ? "timeout" : e?.message || e);
    return res.status(204).end();
  }
}
