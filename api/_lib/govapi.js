// api/_lib/govapi.js
// data.go.kr(공공데이터포털) 공통 응답 처리.
// 건축HUB·건축인허가 등 동일한 봉투(response.header / body.items.item) 재사용.

// item: 0건=없음, 1건=객체, n건=배열 → 항상 배열로 정규화
export function toArray(x) {
  if (x === undefined || x === null || x === "") return [];
  return Array.isArray(x) ? x : [x];
}

// 응답 텍스트 → { items, totalCount }. 오류면 throw.
// resultCode "00"(정상)·"03"(데이터 없음)만 통과.
export function unwrapGov(text, endpoint) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${endpoint} 응답 파싱 실패: ${text.slice(0, 120)}`); }

  // 인증/트래픽 한도 초과 등은 봉투 밖 cmmMsgHeader 로 옴
  const auth = data?.OpenAPI_ServiceResponse?.cmmMsgHeader || data?.cmmMsgHeader;
  if (auth) {
    const d = auth.errMsg || auth.returnAuthMsg || auth.returnReasonCode || "unknown";
    throw new Error(`${endpoint} 상류 인증/한도 오류: ${d}`);
  }

  const header = data?.response?.header || {};
  const code = header.resultCode;
  if (!code) throw new Error(`${endpoint}: 예상치 못한 응답 구조`);
  if (code !== "00" && code !== "03") throw new Error(`${endpoint}: ${header.resultMsg || code}`);

  const body = data?.response?.body || {};
  // items.item (건축HUB 계열) 또는 items 자체가 배열(K-apt 계열) 모두 지원
  const rawItems = body?.items?.item !== undefined ? body.items.item : body?.items;
  return { items: toArray(rawItems), totalCount: Number(body?.totalCount || 0) };
}
