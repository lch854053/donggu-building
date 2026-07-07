# 광주 동구 건축물대장 일괄조회

광주광역시 동구 건축물대장 및 공동주택 정보를 일괄 조회하는 웹 애플리케이션입니다.

## 환경변수

`.env.example`을 복사해 `.env`를 만들고 아래 값을 채웁니다.

```bash
cp .env.example .env
```

| 변수 | 설명 | 필수 |
|---|---|---|
| `BLD_SERVICE_KEY` | 공공데이터포털 건축HUB 서비스키 | ✅ |
| `APT_SERVICE_KEY` | 공공데이터포털 공동주택 서비스키 | ✅ |
| `KAKAO_REST_API_KEY` | 카카오 REST API 키 | ✅ (공동주택명 보정용) |
| `ARCH_SERVICE_KEY` | 공공데이터포털 건축인허가 서비스키 | (미설정 시 `BLD_SERVICE_KEY` 폴백) |
| `HSPMS_SERVICE_KEY` | 공공데이터포털 주택인허가 서비스키 | (미설정 시 `BLD_SERVICE_KEY` 폴백) |

서비스키는 공공데이터포털의 **디코딩된 키**를 입력해야 합니다.

## 카카오 로컬 키워드 검색 API

K-apt(공동주택관리정보시스템)의 단지명이 `'서석동 445-12 업무시설'`처럼 **행정동·지번·용도** 형태로 내려올 때, 4단계 폴백으로 실제 단지/건물명을 보정합니다.

1. 건축물대장 표제부(`getBrTitleInfo`) — 1차
2. 건축인허가정보(`getApHsTpInfo`) — 2차
3. **주택인허가정보 동별개요(`getHpDongOulnInfo`) — 3차** ⭐ 신규
4. 카카오 로컬 키워드 검색 API — 4차 (최종 폴백)

주택인허가(HsPmsHubService)의 동별개요는 단지 단위로 건물명(`bldNm`)을 일관되게 제공해, 공공데이터 기반 보정 정확도를 높입니다. 카카오(상업 상호)로 넘어가기 전 공공데이터 보정 기회를 한 번 더 확보합니다.

관련 파일:

- `api/hspms.js` — 주택인허가 프록시 엔드포인트 (3차 보정)
- `api/kakao-local.js` — 카카오 프록시 엔드포인트 (4차 보정)
- `index.html` — 공동주택 관리 탭의 보정 파이프라인
- `transform.js` — HTML 태그 제거 유틸리티

> 참고: 동일 목적으로 네이버 Local Search API도 검토했으나, 도로명/지번 주소로는 결과 항목이 반환되지 않아 카카오 API로 대체했습니다.

## K-APT 미등록 단지 추가

K-APT에 등록되지 않은 오피스텔·다세대 등은 `aptlist_extra_donggu.json`에 직접 추가하면 공동주택 관리 탭에 함께 표시됩니다.

`aptlist_extra_donggu.json` 예시:

```json
[
  {
    "pnu": "2911010400100680001",
    "complexNm": "금남로 유탑유블레스 원시티",
    "doroAddr": "전남광주통합특별시 동구 천변우로 361-21",
    "adres": "전남광주통합특별시 동구 수기동 68-1",
    "kind": "오피스텔",
    "hhld": 480,
    "dongCnt": 1,
    "grndFlr": 27,
    "ugrndFlr": 2,
    "useAprDay": "20220614",
    "tarea": 45603.70,
    "parking": 494
  }
]
```

필수 항목: `pnu`, `complexNm`, `doroAddr`, `adres`, `kind`  
선택 항목: `hhld`, `dongCnt`, `grndFlr`, `ugrndFlr`, `useAprDay`, `tarea`, `parking`, `area`

## 로컬 실행

Vercel CLI가 설치되어 있어야 합니다.

```bash
npm i -g vercel
vercel dev
```

