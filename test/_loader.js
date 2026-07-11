// test/_loader.js
// transform.js 는 브라우저 전역용(function 선언, export 없음)이므로,
// ESM import 로 직접 가져올 수 없다. 대신 텍스트로 읽어 샌드박스 평가하여
// 순수 함수들을 추출해 테스트에 제공한다.
//
// transform.js 의 함수들은 DOM·fetch·전역 의존이 없으므로(파일 헤더 명시),
// 어떤 환경에서도 동일하게 동작한다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "transform.js");

// transform.js 소스를 평가한 뒤, 정의된 함수들을 객체로 묶어 반환.
// new Function 스코프 안에서 선언된 function 은 그 스코프에 남으므로,
// 같은 스코프에서 객체 리터럴로 명시적으로 꺼내 돌려준다.
export function loadTransform() {
  const src = readFileSync(SRC, "utf8");
  // 동일 스코프 평가 → 함수들을 객체로 수집
  const wrapper = new Function(`
    ${src}
    // 평가된 함수들을 외부로 노출
    return {
      jusoToBldCandidates, jusoToBldGroup, pickTop, extractDong, dongDigits,
      cleanForSearch, stripParens, totalParking, mergeBuilding,
      archRowToBuilding, pickArchMain,
      toPNU, hdongOf, fmt, esc, extractYear, fmtUseApr, norm,
      matchCat, leadNum, dongMatch, dedupeBy, bldLabel, gbLabel,
      roadMatches, geomAreaM2, geomContainsPoint,
    };
  `);
  return wrapper();
}
