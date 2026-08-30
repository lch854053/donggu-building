# AGENTS.md

광주 동구 건축물대장 일괄조회 (정적 웹 + Vercel Serverless + Node.js 데이터 수집)

## 로컬 실행

- Vercel CLI 필요: `npm i -g vercel`
- 실행: `vercel dev` (기본 포트 3000)
- 정적 웹 + `/api/*` 서버리스 함수가 함께 떠서 프록시 모드로 데이터 스크립트를 테스트할 수 있음

## 환경변수

`.env.example`을 복사해 `.env`를 만들고 **디코딩된** 공공데이터포털 서비스키를 채운다.

```bash
cp .env.example .env
```

필수: `BLD_SERVICE_KEY`, `APT_SERVICE_KEY`, `KAKAO_REST_API_KEY`
폴백: `ARCH_SERVICE_KEY`, `HSPMS_SERVICE_KEY`가 없으면 `BLD_SERVICE_KEY`를 사용
빈집/오피스텔: `ODCLOUD_SERVICE_KEY`, `JUSO_CONFM_KEY`, `VWORLD_KEY`
통계: `KOSIS_API_KEY` (update-stats), `SGIS_CONSUMER_KEY`·`SGIS_CONSUMER_SECRET` (update-sgis-stats)

> scripts/*는 `process.env`에서 직접 읽는다. `vercel dev`의 `.env` 로딩은 별도로 확인할 것.

## 테스트

```bash
node --test
```

- Node.js 20+ 내장 test runner (`node:test`).
- `test/transform.test.js`는 `transform.js`를 ESM import하지 않고 `test/_loader.js`가 소스를 샌드박스 `new Function`으로 평가해 함수를 꺼낸다. `transform.js`는 브라우저 전역 함수 스타일이므로 직접 ESM import하면 안 된다.

## 데이터 갱신 스크립트

```bash
npm run update-kapt      # K-apt 단지 기본/상세 정보
npm run update-odcloud   # 오픈데이터 동구 아파트 (월 1회)
npm run update-vacant    # 동구 빈집 현황 + 폴리곤 (월 1회)
npm run update-stats     # KOSIS e-지방지표 동구 통계 (월 1회)
npm run update-sgis-stats # SGIS 인구주택총조사 주택·거처 통계 (월 1회)
npm run update-reb-stats  # 한국부동산원 동구 주택시장 통계 (월 1회)
npm run collect-apt-geo  # VWorld 연속지적도에서 아파트 폴리곤
npm run collect-footprints # VWorld GIS건물통합정보 Figure-Ground 격자 데이터
npm run import-road-footprints -- --shp-dir=<폴더> --facility-dbf=<파일> # 재개발 공동주택 도형 + 용도·승인연도 보정
npm run import-road-footprints -- --shp-dir=<폴더> --facility-dbf=<파일> --registry-shp=<D198 SHP> --registry-csv=<D199 CSV> # 건축물대장 누락 도형 추가
npm run update-officetel # 건축인허가 기반 오피스텔 자동 발견
```

- 스크립트는 두 가지 모드로 동작:
  1. **직접 호출**: `APT_SERVICE_KEY=... npm run update-kapt`
  2. **프록시 모드**: `BASE_URL=http://localhost:3000 npm run update-kapt` (로컬 `vercel dev` 필요)
- `update-vacant`는 `data/vacant-supplement.xlsx`를 우선 매칭하고, 1년 이상 지나면 `data/.vacant-excel-stale`에 플래그를 쓴다.
- `update-officetel`은 `aptlist_extra_donggu.json`에 병합하며 기존 수동 등록 항목을 우선 보존한다.

## CI (GitHub Actions)

- `.github/workflows/update-kapt.yml`: 매주 일요일 — K-APT + 폴리곤 + 오피스텔
- `.github/workflows/update-odcloud.yml`: 매월 1일 — 오픈데이터 아파트 + 폴리곤
- `.github/workflows/update-vacant.yml`: 매월 1일 — 빈집 데이터 + stale 이슈 생성
- `.github/workflows/update-stats.yml`: 매월 1일 — KOSIS + SGIS + REB 동구 통계 (`KOSIS_API_KEY`, `SGIS_CONSUMER_KEY`, `SGIS_CONSUMER_SECRET`, `REB_API_KEY` 시크릿 필요)
- `.github/workflows/update-footprints.yml`: 수동 실행 — 동구 건물 footprint 수집·분할 (`VWORLD_KEY`, PNU 폴백 시 `BLD_SERVICE_KEY` 필요)

## 아키텍처

- `index.html`: 프론트엔드 전부 (탭 기반 SPA). `transform.js`를 `<script>`로 로드.
- `transform.js`: 브라우저 전역 함수 모음. DOM/fetch 의존 없는 순수 함수만 담고 있으며, 테스트용으로만 샌드박스 로딩한다.
- `styles.css`: 스타일
- `api/*`: Vercel serverless functions
  - `api/_lib/`: 공통 라이브러리 (엔드포인트로 노출되지 않음)
  - `api/_lib/proxy.js`: GET 강제, CORS 출처 검증 (`localhost:3000` 또는 `donggu-building*.vercel.app`)
- `api/building.js`: 건축물대장 외에 폐쇄말소대장(getSr*)·유지점검(getMaintenanceHistory/getInspectionAgency)을 op 분기로 통합 — Serverless 슬롯 절약
- `scripts/*`: Node.js 데이터 수집/병합 스크립트 (ESM)
- `*.json` 루트 파일: 정적 데이터 저장소 (K-APT, 빈집, 폴리곤, 행정동 매핑 등)
- `stats_donggu.json`: KOSIS e-지방지표 정적 통계
- `sgis_stats_donggu.json`: SGIS 인구주택총조사 주택·거처 정적 통계
- `reb_stats_donggu.json`: 한국부동산원 동구 주택 가격·거래 정적 통계 (토지 통계 제외)

## 핵심 데이터/코드 규칙

- **동구 시군구코드 이중 체계**
  - 기존 정적 PNU·로컬 데이터: `29110` (구 광주광역시 동구)
  - 건축HUB/건축인허가·VWorld 연속지적도: `12210` (전남광주통합특별시 동구)
  - `building`·`archpms`·`hspms` 프록시는 기존 `29110` 요청을 상류 API 호출 직전에 `12210`으로 정규화한다. 단, 철거멸실관리대장(`getApDemolExtngMgmRgstInfo`)은 상류 데이터가 기존 코드로 색인되어 `29110`을 사용한다. 정적 PNU 형식은 데이터 마이그레이션 전까지 `29110`을 유지한다.
- **PNU 조립**: `sigunguCd(5) + bjdongCd(5) + platGbCd(1→1/2) + bun(4) + ji(4)` → 19자리. `platGbCd` 산(1)은 PNU에서 2다.
- **건축물대장 미등록 신축**: `getBrTitleInfo` 0건일 때 `getApBasisOulnInfo`로 폴백. 표제부가 없는 필드는 `-`로 표시.
- **주차대수**: `totPkngCnt` 우선, 없으면 `indrAutoUtcnt + oudrAutoUtcnt + indrMechUtcnt + oudrMechUtcnt` 합산.
- **K-APT 미등록 공동주택**: `aptlist_extra_donggu.json`에 수동 추가. `update-officetel`이 자동으로 오피스텔을 찾아 병합.
- **Figure-Ground 용적률**: D199 `용적율` 양수만 `far`로 저장하고 0·음수·미기재는 미확인으로 처리한다. 현재 지도 색상 모드로는 노출하지 않는다.
- **Figure-Ground 지상층수**: D199 `지상층수` 양의 정수만 `floors`로 저장하고 0·미기재는 미확인으로 처리한다. 지도 구간은 `1층`·`2–3층`·`4–5층`·`6–9층`·`10–19층`·`20층 이상`이다.
- **Figure-Ground 구조**: D199 `건축물구조명` 비공백 값만 `structure`로 저장하고 미기재는 미확인으로 처리한다. 지도는 `벽돌구조`·`철근콘크리트구조`·`일반목구조`·`블록구조`·`경량철골구조` 상위 5종과 기타로 구분한다.

## 주의사항

- `api/_lib/*`는 Vercel이 `_` 접두 폴더를 엔드포인트로 만들지 않으므로 안전하게 import할 수 있다.
- `transform.js`를 수정하면 `node --test`로 반드시 검증할 것. 브라우저 전역 스타일이므로 import/export 문법을 추가하지 말 것.
- GitHub Actions가 커밋하는 JSON 파일들(`aptlist_donggu.json`, `vacantlist_donggu.json`, `apt_geo.json` 등)은 수동 편집 시 다음 실행과 충돌할 수 있으니 주의.

## Coding Rules

- 원인 분석 없이 코드를 수정하지 않습니다
- 가설 검증을 거치지 않은 수정은 허용되지 않습니다
- 버그 수정 시: 실제 데이터/API로 원인을 먼저 규명하고, 가설을 코드로 검증한 뒤 수정한다 (transform.js 순수 함수는 `node --test`로, 프론트 로직은 실제 데이터 시뮬레이션으로)
