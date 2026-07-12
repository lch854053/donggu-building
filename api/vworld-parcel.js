// /api/vworld-parcel?x=126.92365&y=35.15785   (좌표 → 필지)
// /api/vworld-parcel?pnu=2911010300100140000   (PNU → 필지)
// /api/vworld-parcel?pnus=P1,P2,...            (복수 PNU → GeoJSON FeatureCollection)
// VWorld 2D데이터 프록시(좌표 또는 PNU → 연속지적도 필지)
import { guard, fetchWithTimeout, setSecurity, requireEnv, failJson } from "./_lib/proxy.js";

const VWORLD_URL = "https://api.vworld.kr/req/data";
const DOMAIN = "https://donggu-building.vercel.app";
const numRe = /^-?\d+(\.\d+)?$/;
const pnuRe = /^\d{19}$/;

// 복수 PNU 일괄조회 제한 — VWorld는 단일 필터만 지원하므로 서버에서 병렬 호출 후 병합.
// 한 번에 너무 많으면 Vercel 서버리스 타임아웃/상류 한도 위험이 있어 상한을 둔다.
const MAX_BATCH = 60;
const BATCH_CONCURRENCY = 8;

// 단일 PNU → VWorld 호출 → {properties, geometry} | null
async function fetchOne(pnu, key) {
  const params = new URLSearchParams({
    service: "data", request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",
    attrFilter: `pnu:=:${pnu}`,
    crs: "EPSG:4326", format: "json", size: "10", key, domain: DOMAIN,
  });
  const r = await fetchWithTimeout(`${VWORLD_URL}?${params}`);
  if (!r.ok) return null;
  const data = await r.json();
  if (data?.response?.status !== "OK") return null;
  const features = data?.response?.result?.featureCollection?.features || [];
  if (!features.length) return null;
  return { properties: features[0].properties || {}, geometry: features[0].geometry || null };
}

// 동시성 제한 병렬 실행
async function runPool(items, fn, concurrency) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch { results[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const x    = (req.query.x    || "").toString().trim();
  const y    = (req.query.y    || "").toString().trim();
  const pnu  = (req.query.pnu  || "").toString().trim();
  const pnus = (req.query.pnus || "").toString().trim();

  // 복수 PNU 일괄조회 모드 ─ GeoJSON FeatureCollection 으로 병합 반환
  if (pnus) {
    const list = pnus.split(",").map(s => s.trim()).filter(Boolean).filter(v => pnuRe.test(v));
    if (!list.length) return res.status(400).json({ error: "유효한 PNU 없음" });
    if (list.length > MAX_BATCH) return res.status(400).json({ error: `최대 ${MAX_BATCH}개까지 조회 가능` });

    const key = requireEnv(res, "VWORLD_KEY");
    if (!key) return;

    const raw = await runPool(list, p => fetchOne(p, key), BATCH_CONCURRENCY);
    const features = [];
    for (let idx = 0; idx < list.length; idx++) {
      const got = raw[idx];
      if (!got || !got.geometry) continue;
      const p = got.properties || {};
      features.push({
        type: "Feature",
        properties: {
          pnu: list[idx],
          sigunguCd: list[idx].substring(0, 5),
          bjdongCd:  list[idx].substring(5, 10),
          platGbCd:  list[idx].substring(10, 11) === "2" ? "1" : "0",
          bun:       list[idx].substring(11, 15),
          ji:        list[idx].substring(15, 19),
          addr:  p.addr  || "",
          jibun: p.jibun || "",
        },
        geometry: got.geometry,
      });
    }
    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json({ found: features.length > 0, features });
  }

  // 단일 조회: pnu 우선, 없으면 좌표(POINT)
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
