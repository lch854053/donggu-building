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
npm run collect-apt-geo  # VWorld 연속지적도에서 아파트 폴리곤
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

## 아키텍처

- `index.html`: 프론트엔드 전부 (탭 기반 SPA). `transform.js`를 `<script>`로 로드.
- `transform.js`: 브라우저 전역 함수 모음. DOM/fetch 의존 없는 순수 함수만 담고 있으며, 테스트용으로만 샌드박스 로딩한다.
- `styles.css`: 스타일
- `api/*`: Vercel serverless functions
  - `api/_lib/`: 공통 라이브러리 (엔드포인트로 노출되지 않음)
  - `api/_lib/proxy.js`: GET 강제, CORS 출처 검증 (`localhost:3000` 또는 `donggu-building*.vercel.app`)
- `scripts/*`: Node.js 데이터 수집/병합 스크립트 (ESM)
- `*.json` 루트 파일: 정적 데이터 저장소 (K-APT, 빈집, 폴리곤, 행정동 매핑 등)

## 핵심 데이터/코드 규칙

- **동구 시군구코드 이중 체계**
  - 건축HUB/건축인허가: `29110` (구 광주광역시 동구)
  - VWorld 연속지적도: `12210` (전남광주통합특별시 동구)
  - VWorld 폴백으로 찾은 지번은 그대로 쓰되, 건축HUB 조회용 `sigunguCd`는 `29110`으로 정규화해야 한다.
- **PNU 조립**: `sigunguCd(5) + bjdongCd(5) + platGbCd(1→1/2) + bun(4) + ji(4)` → 19자리. `platGbCd` 산(1)은 PNU에서 2다.
- **건축물대장 미등록 신축**: `getBrTitleInfo` 0건일 때 `getApBasisOulnInfo`로 폴백. 표제부가 없는 필드는 `-`로 표시.
- **주차대수**: `totPkngCnt` 우선, 없으면 `indrAutoUtcnt + oudrAutoUtcnt + indrMechUtcnt + oudrMechUtcnt` 합산.
- **K-APT 미등록 공동주택**: `aptlist_extra_donggu.json`에 수동 추가. `update-officetel`이 자동으로 오피스텔을 찾아 병합.

## 주의사항

- `api/_lib/*`는 Vercel이 `_` 접두 폴더를 엔드포인트로 만들지 않으므로 안전하게 import할 수 있다.
- `transform.js`를 수정하면 `node --test`로 반드시 검증할 것. 브라우저 전역 스타일이므로 import/export 문법을 추가하지 말 것.
- GitHub Actions가 커밋하는 JSON 파일들(`aptlist_donggu.json`, `vacantlist_donggu.json`, `apt_geo.json` 등)은 수동 편집 시 다음 실행과 충돌할 수 있으니 주의.

## Coding Rules

- 버그 수정 시 반드시 `debugging-protocol.md`의 6단계 프로토콜을 따릅니다
- 원인 분석 없이 코드를 수정하지 않습니다
- 가설 검증을 거치지 않은 수정은 허용되지 않습니다
