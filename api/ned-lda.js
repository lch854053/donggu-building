// /api/ned-lda?pnu=2911010100101480001   (PNU → 대지권등록정보)
// VWorld NED 부동산 개방데이터 '건물일련번호조회'(buldSnList) 프록시.
// 집합건물(아파트·다세대·오피스텔)의 호실별 대지권비율을 상세카드 서브탭에 제공.
//
// 검증된 호출 제약(2026-07):
//   - domain 파라미터 필수 (키 인증 정책)
//   - PNU는 구 시군구코드(29110)만 인식. 신규(12210)로 오면 0건 → 29110으로 정규화
//   - 결과 0건이면 응답 루트가 ldaregVOList가 아니라 response 객체로 바뀜
//   - 단건이면 ldaregVOList가 배열이 아닌 단일 객체일 수 있음
// 주의: 조회 0건은 '대지권 없음'이 아니라 '미등록'일 수 있다(세대별 등기 기반).
import { guard, fetchWithTimeout, setSecurity, requireEnv, failJson } from "./_lib/proxy.js";

const NED = "https://api.vworld.kr/ned/data/buldSnList";
const DOMAIN = "https://donggu-building.vercel.app";
const pnuRe = /^\d{19}$/;

const SIGUNGU_OLD = "29110";  // 이 API가 인식하는 구 광주동구 코드
const SIGUNGU_VW  = "12210";

function mapItem(it) {
  const clean = v => { const s = String(v ?? "").trim(); return s && !/^0+$/.test(s) ? s : ""; };
  return {
    dong:  clean(it.buldDongNm),
    floor: clean(it.buldFloorNm),
    ho:    clean(it.buldHoNm),
    rate:  String(it.ldaQotaRate || "").trim(),
    bldNm: String(it.buldNm || "").trim(),
    regstrSe: String(it.regstrSeCodeNm || "").trim(),   // 토지대장/건물등기부 등
    closed: String(it.clsSeCode || "") !== "0",          // 0=현재, 그 외 말소
    baseDate: String(it.lastUpdtDt || "").trim(),
  };
}

export default async function handler(req, res) {
  if (!guard(req, res)) return;

  let pnu = (req.query.pnu || "").toString().trim();
  if (!pnu) return res.status(400).json({ error: "pnu 누락" });
  if (!pnuRe.test(pnu)) return res.status(400).json({ error: "PNU 형식 오류(19자리)" });
  if (pnu.startsWith(SIGUNGU_VW)) pnu = SIGUNGU_OLD + pnu.slice(5);

  const key = requireEnv(res, "VWORLD_KEY");
  if (!key) return;

  try {
    const params = new URLSearchParams({
      key, domain: DOMAIN, pnu, format: "json", numOfRows: "1000", pageNo: "1",
    });
    const r = await fetchWithTimeout(`${NED}?${params}`);
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const data = await r.json();

    setSecurity(res);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=3600");

    const L = data?.ldaregVOList;
    if (!L) return res.status(200).json({ found: false, total: 0, items: [] });

    const raw = L.ldaregVOList;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const items = list.map(mapItem);
    return res.status(200).json({
      found: items.length > 0,
      total: Number(L.totalCount || items.length),
      items,
    });
  } catch (e) {
    return failJson(res, e, "ned-lda");
  }
}
