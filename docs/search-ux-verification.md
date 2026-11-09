# 검색 UX 개선 검증

기준 화면은 PR 직전 커밋 `8f36dc9`, 변경 화면은 이 브랜치에서 각각 로컬 서버로 제공했습니다. 화면은 동일한 Edge Chromium과 로컬 라이브러리, 모의 API 응답으로 촬영했습니다. 모바일은 실기기가 아닌 터치 화면 에뮬레이션입니다.

| 화면 | 변경 전 | 변경 후 |
|---|---|---|
| 360px | [첫 화면](search-ux-evidence/before-360.png) | [첫 화면](search-ux-evidence/after-360.png), [결과 요약](search-ux-evidence/result-360.png) |
| 390px | [첫 화면](search-ux-evidence/before-390.png) | [첫 화면](search-ux-evidence/after-390.png) |
| 430px | [첫 화면](search-ux-evidence/before-430.png) | [첫 화면](search-ux-evidence/after-430.png) |
| 1366px | [첫 화면](search-ux-evidence/before-1366.png) | [첫 화면](search-ux-evidence/after-1366.png), [결과 요약](search-ux-evidence/result-1366.png) |

## 실행 결과

- `node --test`: 171개 통과. 부분 실패·재시도·취소·이전 요청 보호, 지도 보강 범위, 공유 상태 직렬화 등 기존 테스트 포함.
- `scripts/search-ux-browser.mjs`: 네 화면 크기에서 동구 후보 필터, 명시적 선택, 동 번호 보존, Escape, API 오류, 응답 역전 및 가로 넘침 확인.
- `scripts/search-ux-integration.mjs`: 실제 표제부 응답 fixture로 다동 변경에 따른 복사, 조회 시각 유지, Clipboard 실패 시 수동 복사, 여러 주소 조회와 XLSX 다운로드 확인.
- `ui-stage1-browser`: 네 크기 레이아웃 및 공유 링크 v1, 다동 선택, 뒤로/앞으로, 최근 검색, 조회 취소·실패 확인.
- `p3-browser-regression`: 공유·이력·최근 검색, 공동주택 및 철거멸실 선택 복원, 빈집과 지도 선택 복원, Figure-Ground 및 모바일 접근성 확인.
- `ui-stage3-regression`: 네 크기에서 공동주택·빈집·지도 상세, 조건 변경 후 이전 결과 안내, 엑셀 원본 값·조회 조건, 부분 실패·재시도·빈 결과·전체 실패·취소, 선택 동과 GIS 범위 경고 확인.
- `p2-browser-check`: 단건·공동주택·조건검색·지도 데이터 경로의 제어된 API 응답 측정 및 네 크기 레이아웃 확인. 타이밍은 모의 지연 환경의 수치이며 운영 성능을 의미하지 않음.

기존 스크립트의 외부 CDN 의존성은 `scripts/run-offline-regression.mjs`로 로컬 `xlsx`, `leaflet`, `leaflet.fullscreen`을 제공해 우회했습니다. 로컬 정적 서버를 3000번 포트에서 실행하고 `npm install --no-save --package-lock=false playwright leaflet leaflet.fullscreen`으로 테스트 도구를 설치한 뒤 `CHROMIUM_PATH`를 지정해 `node scripts/run-offline-regression.mjs ui-stage3-regression`을 실행합니다. 테스트 API는 모의 응답이며 운영 API를 대량 호출하지 않습니다.

## 제한

- 서비스 키가 있는 실제 Vercel Serverless 환경과 실제 모바일 기기·스크린리더에서는 검증하지 않았습니다.
- 주소 후보는 기존 주소 프록시가 반환하는 첫 5건 중 동구 코드가 확인된 결과만 표시합니다. 후보가 없거나 실패해도 직접 입력 조회가 가능합니다.
- 자동완성의 시간 역전은 이전 응답 무시 방식입니다. 이미 전송한 요청은 서버에서 취소하지 않습니다.
