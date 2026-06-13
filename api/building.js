// /api/building?sigunguCd=29110&bjdongCd=10100&platGbCd=0&bun=0123&ji=0004   (단건: 번지 지정)
// /api/building?sigunguCd=29110&bjdongCd=10100&numOfRows=1000&pageNo=1       (동단위: 번지 생략)
// 국토교통부 건축HUB 표제부(getBrTitleInfo) 프록시
// 응답: { titles: [...], totalCount }  /  오류 시 { titles: [], error }

const HUB = "http://apis.data.go.kr/1613000/BldRgstHubService";

// 건축HUB item 은 0건이면 없음, 1건이면 객체, 여러건이면 배열 → 항상 배열로 정규화
function toArray(x) {
  if (x === undefined || x === null || x === "") return [];
  return Array.isArray(x) ? x : [x];
}

async function callHub(endpoint, params, serviceKey) {
  // 값이 있는 파라미터만 전송 (bun/ji 생략 시 법정동 전체 조회)
  const q = { sigunguCd: params.sigunguCd, bjdongCd: params.bjdongCd, _type: "json" };
  if (params.platGbCd) q.platGbCd = params.platGbCd;
  if (params.bun)      q.bun = params.bun;
  if (params.ji)       q.ji = params.ji;
  q.numOfRows = params.numOfRows || "100";
  q.pageNo    = params.pageNo || "1";

  const qs = new URLSearchParams(q).toString();
  // serviceKey 는 '디코딩(Decoding) 키'를 환경변수에 넣고 여기서 1회만 인코딩
  const url = `${HUB}/${endpoint}?serviceKey=${encodeURIComponent(serviceKey)}&${qs}`;

  const r = await fetch(url);
  const text = await r.text();

  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${endpoint} 응답 파싱 실패: ${text.slice(0, 120)}`); }

  const header = data?.response?.header || {};
  const code = header.resultCode;
  if (code && code !== "00" && code !== "03") {
    throw new Error(`${endpoint}: ${header.resultMsg || code}`);
  }
  const body = data?.response?.body || {};
  return { titles: toArray(body?.items?.item), totalCount: Number(body?.totalCount || 0) };
}

export default async function handler(req, res) {
  const { sigunguCd, bjdongCd, platGbCd, bun, ji, numOfRows, pageNo } = req.query;
  if (!sigunguCd || !bjdongCd) {
    return res.status(400).json({ titles: [], error: "필수 파라미터(sigunguCd/bjdongCd) 누락" });
  }

  const serviceKey = process.env.BLD_SERVICE_KEY;
  if (!serviceKey) {
    return res.status(500).json({ titles: [], error: "BLD_SERVICE_KEY 환경변수 미설정" });
  }

  const normalizedBun = bun ? String(bun).padStart(4, "0") : "";
  const normalizedJi = normalizedBun
    ? (ji ? String(ji).padStart(4, "0") : "0000")
    : "";

  const params = {
    sigunguCd,
    bjdongCd,
    platGbCd: platGbCd || "",
    bun: normalizedBun,
    ji:  normalizedJi,
    numOfRows: numOfRows || "100",
    pageNo: pageNo || "1",
  };

  try {
    const { titles, totalCount } = await callHub("getBrTitleInfo", params, serviceKey);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    return res.status(200).json({ titles, totalCount });
  } catch (e) {
    const msg = e?.message || "";
    // 서비스 키·내부 URL 등이 포함될 수 있으므로 외부에는 일반 메시지만 노출
    const safe = msg.includes("파싱 실패") ? "API 응답 파싱 오류" :
                 msg.includes("resultMsg") || /^\w+:/.test(msg) ? "외부 API 오류" : "서버 오류";
    console.error("[building] handler error:", msg);
    return res.status(502).json({ titles: [], error: safe });
  }
}
