// scripts/compare-parcels.mjs
// 다필지 검증(#6): 대장 부속지번(getBrAtchJibunInfo) vs 인허가 대지위치(getApPlatPlcInfo)의
// '필지 수'를 PNU 기준으로 중복 제거한 뒤 나란히 비교한다.
//
// 목적: 대장으로 다필지가 안 잡히는지(대장 < 인허가) 표본으로 확인 → #6(getApPlatPlcInfo 보강) 정당성 판단.
//
// 사용법 (서비스키는 '디코딩 키'를 넣을 것 — 프로젝트 프록시와 동일):
//   BLD_SERVICE_KEY=발급키 [ARCH_SERVICE_KEY=발급키] node scripts/compare-parcels.mjs
//   (ARCH_SERVICE_KEY 미지정 시 BLD_SERVICE_KEY로 폴백 — 두 서비스에 같은 키가 승인된 경우)
//
// 표본 코드 얻는 법: 앱에서 해당 주소 조회 → 네트워크탭의 /api/building 요청 쿼리에서
//   sigunguCd / bjdongCd / platGbCd / bun / ji 값을 그대로 복사해 SAMPLES에 추가.

import { unwrapGov } from "../api/_lib/govapi.js";

const BLD  = "https://apis.data.go.kr/1613000/BldRgstHubService";
const ARCH = "https://apis.data.go.kr/1613000/ArchPmsHubService";

const BLD_KEY  = process.env.BLD_SERVICE_KEY;
const ARCH_KEY = process.env.ARCH_SERVICE_KEY || process.env.BLD_SERVICE_KEY;
if (!BLD_KEY) { console.error("환경변수 BLD_SERVICE_KEY 필요(디코딩 키)"); process.exit(1); }

// ── 표본: [라벨, sigunguCd, bjdongCd, platGbCd, bun(4자리), ji(4자리)] ──
// 다필지 의심 건물 + 단필지 대조군을 섞어 넣을 것(거짓양성 점검).
const SAMPLES = [
  ["서남로 1(동구청)", "29110", "11800", "0", "0031", "0000"],
  // ["○○로 ○ (다필지 의심)", "29110", "?????", "0", "????", "????"],
  // ["△△ (단필지 대조군)",   "29110", "?????", "0", "????", "????"],
];

// PNU 19자리: 시군구5 + 법정동5 + 산여부1(1:대지·2:산) + 본번4 + 부번4
function pnu(sigungu, bjdong, platGb, bun, ji) {
  const san = String(platGb) === "1" ? "2" : "1";
  return `${sigungu}${bjdong}${san}${String(bun).padStart(4, "0")}${String(ji ?? "0").padStart(4, "0")}`;
}

async function callGov(base, op, key, p) {
  // serviceKey는 디코딩 키 → URLSearchParams가 1회 인코딩(프로젝트와 동일)
  const q = new URLSearchParams({
    serviceKey: key, _type: "json", numOfRows: "100", pageNo: "1",
    sigunguCd: p[1], bjdongCd: p[2], platGbCd: p[3], bun: p[4], ji: p[5],
  });
  const r = await fetch(`${base}/${op}?${q}`);
  const text = await r.text();
  return unwrapGov(text, op); // { items, totalCount }
}

// 대장: 대표지번 + 부속지번(getBrAtchJibunInfo) → PNU 집합
async function ledgerParcels(p) {
  const set = new Set([ pnu(p[1], p[2], p[3], p[4], p[5]) ]);
  const { items } = await callGov(BLD, "getBrAtchJibunInfo", BLD_KEY, p);
  for (const it of items) {
    if (it.atchBjdongCd && it.atchBun != null) {
      set.add(pnu(it.atchSigunguCd || p[1], it.atchBjdongCd, it.atchPlatGbCd || "0", it.atchBun, it.atchJi));
    }
  }
  return set;
}

// 인허가: 대지위치(getApPlatPlcInfo) → 관련지번 PNU 집합(인허가건 반복 → dedup)
async function permitParcels(p) {
  const set = new Set();
  const { items } = await callGov(ARCH, "getApPlatPlcInfo", ARCH_KEY, p);
  for (const it of items) {
    if (it.sigunguCd && it.bjdongCd && it.bun != null) {
      set.add(pnu(it.sigunguCd, it.bjdongCd, it.platGbCd || "0", it.bun, it.ji));
    }
  }
  return set;
}

console.log("라벨".padEnd(20), "대장", "인허가", "인허가만(대장누락)", "판정");
for (const s of SAMPLES) {
  try {
    const led = await ledgerParcels(s);
    const per = await permitParcels(s);
    if (per.size === 0) {
      console.log(s[0].padEnd(20), `${led.size}`.padEnd(4), "0".padEnd(6), "-", "인허가 없음 → 비교 불가");
      continue;
    }
    const onlyPermit = [...per].filter(x => !led.has(x));
    const verdict = onlyPermit.length > 0 ? "← 대장 누락 의심(#6 정당)" : "일치(보강 불필요)";
    console.log(s[0].padEnd(20), `${led.size}`.padEnd(4), `${per.size}`.padEnd(6), `${onlyPermit.length}`.padEnd(18), verdict);
  } catch (e) {
    console.log(s[0].padEnd(20), "오류:", e.message);
  }
}
