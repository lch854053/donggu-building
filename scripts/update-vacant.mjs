// scripts/update-vacant.mjs
// odcloud "전남광주통합특별시 동구_빈집 현황" 데이터를 수집하여 vacantlist_donggu.json을 생성합니다.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ODCLOUD_SERVICE_KEY = process.env.ODCLOUD_SERVICE_KEY;
const ODCLOUD_ENDPOINT = "https://api.odcloud.kr/api/15144631/v1/uddi:4b08ea19-5d8e-4050-99a6-bf6905c56b06";
const PER_PAGE = 1000;

function fetchWithTimeout(url, { timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function fetchAllVacant() {
  if (!ODCLOUD_SERVICE_KEY) throw new Error("ODCLOUD_SERVICE_KEY 환경변수 필요");
  const all = [];
  let page = 1;
  while (true) {
    const url = `${ODCLOUD_ENDPOINT}?page=${page}&perPage=${PER_PAGE}&serviceKey=${encodeURIComponent(ODCLOUD_SERVICE_KEY)}`;
    const r = await fetchWithTimeout(url, { timeout: 20000 });
    if (!r.ok) throw new Error(`odcloud HTTP ${r.status}`);
    const data = await r.json();
    if (data?.errMsg || data?.returnAuthMsg) {
      throw new Error(`odcloud 오류: ${data.errMsg || data.returnAuthMsg}`);
    }
    const rows = Array.isArray(data?.data) ? data.data : [];
    all.push(...rows);
    const total = Number(data?.totalCount || 0);
    if (rows.length < PER_PAGE || all.length >= total) break;
    page++;
  }
  return all;
}

async function main() {
  if (!ODCLOUD_SERVICE_KEY) {
    console.error("ODCLOUD_SERVICE_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  console.log("odcloud 빈집 데이터 수집 중...");
  const rows = await fetchAllVacant();
  console.log(`odcloud 총 ${rows.length}건`);

  const out = rows.map(row => {
    const tarea = Number(row["연면적"] || 0);
    const year = Number(row["건축년도"] || 0);
    return {
      dong: String(row["읍면동명"] || "").trim(),
      kind: String(row["주택유형"] || "").trim(),
      year: year > 0 ? year : null,
      struct: String(row["건축물대장주구조"] || "").trim(),
      tarea: Number.isFinite(tarea) ? tarea : 0,
      grade: String(row["등급판정결과"] || "").trim(),
      baseDate: String(row["데이터기준일자"] || "").trim(),
    };
  });

  const outputPath = join(ROOT, "vacantlist_donggu.json");
  await writeFile(outputPath, JSON.stringify(out, null, " ") + "\n", "utf8");

  console.log(`\n완료: ${out.length}건 저장`);
  console.log(`저장 경로: ${outputPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
