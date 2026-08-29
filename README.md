# 동구 건축물대장 일괄조회

전남광주통합특별시 동구의 건축물, 공동주택, 철거·멸실, 빈집, 주택 통계를 한곳에서 조회하는 웹 애플리케이션입니다.

서비스: https://donggu-building.vercel.app

## 주요 기능

- 주소 여러 건을 입력해 건축물대장을 일괄 조회하고 엑셀로 저장
- 행정동, 용도, 구조, 층수, 연면적, 사용승인 연도로 건축물 검색
- 건축물 단건 상세정보와 필지 지도 조회
- K-APT 및 동구 공동주택 현황 검색
- 철거·멸실 이력과 폐쇄말소대장 조회
- 빈집 등급·위치 및 KOSIS·SGIS·한국부동산원 통계 제공
- VWorld 건물 footprint 기반 Figure-Ground 테마지도 제공

## 로컬 실행

Node.js 20 이상과 Vercel CLI가 필요합니다.

```bash
git clone https://github.com/lch854053/donggu-building.git
cd donggu-building
npm install
npm install -g vercel
cp .env.example .env
vercel dev
```

브라우저에서 `http://localhost:3000`을 엽니다. 공공데이터포털 서비스키는 디코딩된 값을 사용합니다.

## 환경변수

| 변수 | 용도 |
|---|---|
| `DATA_SERVICE_KEY` | 건축물대장, 건축·주택인허가, 폐쇄말소대장, K-APT |
| `JUSO_CONFM_KEY` | 도로명주소 검색 및 PNU 보강 |
| `VWORLD_KEY` | 지오코딩, 필지·건물 정보, 지도 |
| `ODCLOUD_SERVICE_KEY` | 공동주택·빈집 공개데이터 |
| `KAKAO_REST_API_KEY` | 공동주택명 및 빈집 행정동 보정 |
| `KOSIS_API_KEY` | KOSIS 통계 갱신 |
| `SGIS_CONSUMER_KEY`, `SGIS_CONSUMER_SECRET` | SGIS 통계 갱신 |
| `REB_API_KEY` | 한국부동산원 통계 갱신 |

기존 서비스별 키(`BLD_SERVICE_KEY`, `ARCH_SERVICE_KEY`, `HSPMS_SERVICE_KEY`, `SHT_SERVICE_KEY`, `APT_SERVICE_KEY`)도 지원합니다. 전체 목록과 예시는 `.env.example`을 참고하세요.

## 구조

code-review-graph 기준으로 코드는 다음 네 영역으로 분리됩니다.

| 영역 | 역할 |
|---|---|
| `index.html`, `styles.css` | 탭 기반 정적 웹 UI |
| `app-api.js`, `transform.js` | 브라우저 API 호출과 순수 데이터 변환 |
| `api/*.js`, `api/_lib/*.js` | Vercel Serverless 프록시와 공통 인증·응답 처리 |
| `scripts/*.mjs` | 외부 데이터를 수집해 루트 JSON 저장소 갱신 |

조회 화면은 서버리스 API를 통해 실시간 데이터를 가져오고, 공동주택·빈집·통계·지도 데이터는 저장소의 정적 JSON을 함께 사용합니다. API 키는 브라우저에 노출하지 않습니다.

## 테스트

```bash
node --test
```

`transform.js`는 브라우저 전역 함수 파일입니다. ESM으로 직접 import하지 않고 `test/_loader.js`를 통해 테스트합니다.

## 데이터 갱신

| 명령 | 갱신 대상 |
|---|---|
| `npm run update-kapt` | K-APT 단지 기본·상세정보 |
| `npm run update-odcloud` | 동구 공동주택 공개데이터 |
| `npm run update-vacant` | 빈집 현황과 필지 도형 |
| `npm run update-stats` | KOSIS 주요 지표 |
| `npm run update-sgis-stats` | SGIS 주택·거처 통계 |
| `npm run update-reb-stats` | 한국부동산원 주택시장 통계 |
| `npm run collect-apt-geo` | 공동주택 필지 도형 |
| `npm run probe-footprints` | VWorld 건물 BBOX 조회 지원 여부 확인 |
| `npm run collect-footprints` | Figure-Ground 건물 도형 수집·격자 분할 |
| `npm run import-footprints -- --shp-dir=<폴더>` | 주소기반산업지원서비스 AL_D010 SHP에서 건물 도형 갱신 |
| `npm run update-officetel` | 건축인허가 기반 오피스텔 목록 |

수집 스크립트는 환경변수를 `process.env`에서 직접 읽습니다. 필요한 키를 명령 앞에 지정하거나, 지원되는 스크립트는 실행 중인 프록시를 `BASE_URL=http://localhost:3000`으로 지정합니다. GitHub Actions는 K-APT를 매주, 공동주택·빈집·통계를 매월 갱신합니다.

## 동구 코드 규칙

- 정적 PNU와 기존 데이터: `29110`
- 건축HUB·건축인허가·VWorld: `12210`
- 철거멸실관리대장 `getApDemolExtngMgmRgstInfo`: 상류 색인에 맞춰 `29110`

프록시가 서비스별 코드 변환을 담당하므로 브라우저 코드에서 임의로 변환하지 않습니다.

## 배포

정적 파일과 `api/*`를 함께 Vercel에 배포합니다. 운영 환경에도 `.env.example`의 필수 키를 등록해야 합니다.
