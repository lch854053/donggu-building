// /api/vworld-bld?pnu=2911011200101420006   (PNU → GIS건물통합정보 1건: 윤곽선+속성)
// VWorld NED GIS건물통합정보 WFS(getBldgisSpceWFS) 프록시.
// 연속지적도(필지)와 달리 '건물 단위' 도형(ag_geom)과 속성(높이·용도·건물명·위반건축물 등)을 제공.
//
// 검증된 호출 제약(2026-07):
//   - domain 파라미터 필수 (키 인증 정책 — 없으면 INCORRECT_KEY)
//   - VERSION=1.1.0 강제 (1.0.0 은 INVALID_RANGE)
//   - TYPENAME=dt_d010, SRSNAME=EPSG:4326, OUTPUT=application/json → GeoJSON FeatureCollection
//   - 단순 pnu= GET 파라미터로 단건 필터링
//   - WFS는 구/신규 시군구코드(29110/12210) 둘 다 수용하지만 응답 pnu는 항상 12210로 정규화됨.
//     안전하게 두 체계를 순차 시도한다.
import { guard, fetchWithTimeout, setSecurity, requireEnv, failJson } from "./_lib/proxy.js";

const VWORLD_NED = "https://api.vworld.kr/ned/wfs/getBldgisSpceWFS";
const DOMAIN = "https://donggu-building.vercel.app";
const pnuRe = /^\d{19}$/;

// 우리 데이터는 구 광주동구(29110) 코드를 쓰므로 WFS 조회 시 신규 코드(12210)로 정규화 시도.
const SIGUNGU_OLD = "29110";
const SIGUNGU_VW  = "12210";

async function fetchBld(pnu, key) {
  const params = new URLSearchParams({
    key, domain: DOMAIN,
    SERVICE: "WFS", VERSION: "1.1.0", REQUEST: "GetFeature",
    TYPENAME: "dt_d010", SRSNAME: "EPSG:4326",
    OUTPUT: "application/json", MAXFEATURES: "5",
    pnu,
  });
  const r = await fetchWithTimeout(`${VWORLD_NED}?${params}`);
  if (!r.ok) return null;
  let data;
  try { data = await r.json(); }
  catch { return null; }
  const features = data?.features || [];
  if (!features.length) return null;
  const f = features[0];
  return { properties: f.properties || {}, geometry: f.geometry || null };
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  const pnu = (req.query.pnu || "").toString().trim();
  if (!pnu) return res.status(400).json({ error: "pnu 누락" });
  if (!pnuRe.test(pnu)) return res.status(400).json({ error: "PNU 형식 오류(19자리)" });

  const key = requireEnv(res, "VWORLD_KEY");
  if (!key) return;

  try {
    // 구코드(29110)면 신규(12210)로 정규화하여 먼저 시도, 비어있으면 원본 PNU로 재시도.
    // (WFS가 양 체계를 수용하긴 하나 일부 필지는 한쪽에서만 잡히는 안전장치)
    const candidates = pnu.startsWith(SIGUNGU_OLD)
      ? [SIGUNGU_VW + pnu.slice(5), pnu]
      : [pnu, pnu.startsWith(SIGUNGU_VW) ? SIGUNGU_OLD + pnu.slice(5) : null].filter(Boolean);

    let got = null;
    for (const cand of candidates) {
      got = await fetchBld(cand, key);
      if (got) break;
    }

    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    if (!got) return res.status(200).json({ found: false });

    return res.status(200).json({ found: true, properties: got.properties, geometry: got.geometry });
  } catch (e) {
    return failJson(res, e, "vworld-bld");
  }
}
