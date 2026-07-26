// api/_lib/datakey.js
// 공공데이터포털(data.go.kr) 서비스키 통합 해석.
//
// 검증(2026-07): 하나의 일반 인증키가 여러 서비스에 공용 승인되는 경우가 흔하다.
// 실제로 동일 키가 아래 서비스 모두에서 인증 통과함:
//   - BldRgstHubService (건축물대장)
//   - ArchPmsHubService (건축인허가)
//   - HsPmsHubService   (주택인허가)
//   - ShtRgstHubService (폐쇄말소대장)
//
// 따라서 환경변수는 DATA_SERVICE_KEY 하나만 설정하면 충분하다.
// 기존 개별 키(BLD/ARCH/HSPMS/SHT/APT)를 이미 설정해 둔 배포도 호환되도록,
// 폴백 체인으로 해석한다. 우선순위:
//   1) DATA_SERVICE_KEY (권장 — 단일 키)
//   2) 서비스별 레거시 키 (args)
//
// 사용:
//   const key = resolveDataKey(res, "ARCH_SERVICE_KEY");   // ARCH → BLD → DATA 순 폴백
//   const key = resolveDataKey(res, "SHT_SERVICE_KEY", "BLD_SERVICE_KEY");
// args 로 넘긴 레거시 키들 이후 항상 DATA_SERVICE_KEY 로 폴백한다.

export function resolveDataKey(res, ...legacyKeys) {
  // 1) 레거시 개별 키 (명시적으로 설정된 경우 우선)
  for (const k of legacyKeys) {
    const v = process.env[k];
    if (v) return v;
  }
  // 2) 통합 키 (권장)
  const unified = process.env.DATA_SERVICE_KEY;
  if (unified) return unified;
  // 전부 없음
  res.status(500).json({ error: "공공데이터 서비스키 미설정 (DATA_SERVICE_KEY 또는 레거시 키 필요)" });
  return null;
}
