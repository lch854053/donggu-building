// /api/building?sigunguCd=29110&bjdongCd=10100&platGbCd=0&bun=0123&ji=0004
// 국토교통부 건축HUB 표제부(getBrTitleInfo) + 기본개요(getBrBasisOulnInfo) 프록시
// 응답: { titles: [표제부 동 배열], basis: {기본개요} }  /  실패 시 { titles: [] }

const HUB = "http://apis.data.go.kr/1613000/BldRgstHubService";

// 건축HUB item 은 0건이면 없음, 1건이면 객체, 여러건이면 배열 → 항상 배열로 정규화
function toArray(x) {
  if (x === undefined || x === null || x === "") return [];
  return Array.isArray(x) ? x : [x];
}

async function callHub(endpoint, params, serviceKey) {
  const qs = new URLSearchParams({
    sigunguCd: params.sigunguCd,
    bjdongCd: params.bjdongCd,
    platGbCd: params.platGbCd,
    bun: params.bun,
    ji: params.ji,
    numOfRows: "100",
    pageNo: "1",
    _type: "json",
  }).toString();

  // serviceKey 는 '디코딩(Decoding) 키'를 환경변수에 넣고 여기서 1회만 인코딩
  const url = `${HUB}/${endpoint}?serviceKey=${encodeURIComponent(serviceKey)}&${qs}`;

  const r = await fetch(url);
  const text = await r.text();

  // 오류 시 XML(에러)로 오는 경우가 있어 방어적으로 파싱
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${endpoint} 응답 파싱 실패: ${text.slice(0, 120)}`); }

  const header = data?.response?.header || {};
  const code = header.resultCode;
  // 00: 정상, 03: 데이터 없음 → 빈 배열로 처리
  if (code && code !== "00" && code !== "03") {
    throw new Error(`${endpoint}: ${header.resultMsg || code}`);
  }
  return toArray(data?.response?.body?.items?.item);
}

export default async function handler(req, res) {
  const { sigunguCd, bjdongCd, platGbCd, bun, ji } = req.query;
  if (!sigunguCd || !bjdongCd || !bun) {
    return res.status(400).json({ titles: [], error: "필수 파라미터(sigunguCd/bjdongCd/bun) 누락" });
  }

  const serviceKey = process.env.BLD_SERVICE_KEY;
  if (!serviceKey) {
    return res.status(500).json({ titles: [], error: "BLD_SERVICE_KEY 환경변수 미설정" });
  }

  const params = {
    sigunguCd,
    bjdongCd,
    platGbCd: platGbCd || "0",
    bun: String(bun).padStart(4, "0"),
    ji: String(ji || "0").padStart(4, "0"),
  };

  try {
    const [titles, basisArr] = await Promise.all([
      callHub("getBrTitleInfo", params, serviceKey),
      callHub("getBrBasisOulnInfo", params, serviceKey),
    ]);

    if (!titles.length) return res.status(200).json({ titles: [] });

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({ titles, basis: basisArr[0] || {} });
  } catch (e) {
    return res.status(200).json({ titles: [], error: String(e?.message || e) });
  }
}
