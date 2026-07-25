// /api/vworld-bld?pnu=2911011200101420006   (PNU → GIS건물통합정보 속성)
// VWorld NED GIS건물통합정보 WFS(getBldgisSpceWFS) 프록시.
// 건축물대장에 없는 보조 속성(높이 hg·위반건축물 violt_bild 등)을 카드에 보강 표시하기 위함.
// 건물 윤곽선(ag_geom) 오버레이는 이익보다 리스크가 커 철회했으므로 도형은 다루지 않는다.
//
// 검증된 호출 제약(2026-07):
//   - domain 파라미터 필수 (키 인증 정책 — 없으면 INCORRECT_KEY)
//   - VERSION=1.1.0 강제 (1.0.0 은 INVALID_RANGE)
//   - TYPENAME=dt_d010, SRSNAME=EPSG:4326, OUTPUT=application/json → GeoJSON FeatureCollection
//   - 단순 pnu= GET 파라미터로 단건 필터링
//   - WFS는 구/신규 시군구코드(29110/12210) 둘 다 수용하지만 응답 pnu는 항상 12210로 정규화됨.
//     안전하게 두 체계를 순차 시도한다.
//
// 한 필지(pnu)에 건물이 여러 개일 수 있다(학교 교사 본관/별관 등). 보조 속성 표시의 일관성을 위해
// '건물명이 있는 것 → 그중 연면적 최대' 우선으로 대표 속성 1건을 골라 반환한다.
import { guard, fetchWithTimeout, setSecurity, requireEnv, failJson } from "./_lib/proxy.js";

const VWORLD_NED = "https://api.vworld.kr/ned/wfs/getBldgisSpceWFS";
const DOMAIN = "https://donggu-building.vercel.app";
const pnuRe = /^\d{19}$/;

// 우리 데이터는 구 광주동구(29110) 코드를 쓰므로 WFS 조회 시 신규 코드(12210)로 정규화 시도.
const SIGUNGU_OLD = "29110";
const SIGUNGU_VW  = "12210";

async function fetchBldProps(pnu, key) {
  const params = new URLSearchParams({
    key, domain: DOMAIN,
    SERVICE: "WFS", VERSION: "1.1.0", REQUEST: "GetFeature",
    TYPENAME: "dt_d010", SRSNAME: "EPSG:4326",
    OUTPUT: "application/json", MAXFEATURES: "50",
    pnu,
  });
  const r = await fetchWithTimeout(`${VWORLD_NED}?${params}`);
  if (!r.ok) return null;
  let data;
  try { data = await r.json(); }
  catch { return null; }
  const features = data?.features || [];
  if (!features.length) return null;
  return features.map(f => f.properties || {});
}

// 건물 속성 목록 → 대표 1건 선택 (본관 우선).
// 건물명(buld_nm)이 있으면 그중 면적 최대, 건물명이 전혀 없으면 전체 중 면적 최대.
function pickMainProps(propsList) {
  const area = p => Number(p.totar) || Number(p.ar) || 0;
  const named = propsList.filter(p => String(p.buld_nm || "").trim());
  const pool = named.length ? named : propsList;
  return pool.slice().sort((a, b) => area(b) - area(a))[0] || {};
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
    const candidates = pnu.startsWith(SIGUNGU_OLD)
      ? [SIGUNGU_VW + pnu.slice(5), pnu]
      : [pnu, pnu.startsWith(SIGUNGU_VW) ? SIGUNGU_OLD + pnu.slice(5) : null].filter(Boolean);

    let propsList = null;
    for (const cand of candidates) {
      propsList = await fetchBldProps(cand, key);
      if (propsList) break;
    }

    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");
    if (!propsList) return res.status(200).json({ found: false });

    return res.status(200).json({ found: true, properties: pickMainProps(propsList) });
  } catch (e) {
    return failJson(res, e, "vworld-bld");
  }
}
