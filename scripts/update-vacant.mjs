// scripts/update-vacant.mjs
// odcloud "전남광주통합특별시 동구_빈집 현황" 데이터를 수집하고,
// VWorld 지오코딩으로 행정동 중심 좌표를 획득한 뒤
// 같은 행정동의 빈집은 중심 좌표 주변에 분산 배치하여 vacantlist_donggu.json을 생성합니다.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ODCLOUD_SERVICE_KEY = process.env.ODCLOUD_SERVICE_KEY;
const VWORLD_KEY = process.env.VWORLD_KEY;
const ODCLOUD_ENDPOINT = "https://api.odcloud.kr/api/15144631/v1/uddi:4b08ea19-5d8e-4050-99a6-bf6905c56b06";
const PER_PAGE = 1000;

function fetchWithTimeout(url, { timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function geocodeDong(dongName) {
  if (!VWORLD_KEY || !dongName) return null;
  const address = `광주광역시 동구 ${dongName}`;
  const params = new URLSearchParams({
    service: "address",
    request: "getcoord",
    version: "2.0",
    crs: "epsg:4326",
    address,
    refine: "true",
    simple: "false",
    format: "json",
    type: "parcel",
    key: VWORLD_KEY,
  });
  try {
    const r = await fetchWithTimeout(`https://api.vworld.kr/req/address?${params}`, { timeout: 10000 });
    if (!r.ok) return null;
    const data = await r.json();
    const point = data?.response?.result?.point;
    if (!point) return null;
    return { lon: Number(point.x), lat: Number(point.y) };
  } catch {
    return null;
  }
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pseudoRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function offsetFor(idx, seedStr) {
  const seed = hashCode(seedStr + idx);
  const angle = pseudoRandom(seed) * Math.PI * 2;
  const radius = pseudoRandom(seed + 1) * 0.0005; // 약 50m
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

async function main() {
  if (!ODCLOUD_SERVICE_KEY) {
    console.error("ODCLOUD_SERVICE_KEY 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }
  if (!VWORLD_KEY) {
    console.warn("VWORLD_KEY 환경변수가 설정되지 않았습니다. 행정동 중심 좌표를 얻을 수 없습니다.");
  }

  console.log("odcloud 빈집 데이터 수집 중...");
  const rows = await fetchAllVacant();
  console.log(`odcloud 총 ${rows.length}건`);

  const dongSet = [...new Set(rows.map(r => String(r["읍면동명"] || "").trim()).filter(Boolean))];
  console.log(`행정동 종류: ${dongSet.length}개`);

  const dongCoords = {};
  if (VWORLD_KEY) {
    for (let i = 0; i < dongSet.length; i++) {
      const dong = dongSet[i];
      const coord = await geocodeDong(dong);
      dongCoords[dong] = coord;
      console.log(`[${i + 1}/${dongSet.length}] ${dong} -> ${coord ? `${coord.lon.toFixed(6)}, ${coord.lat.toFixed(6)}` : "실패"}`);
      await sleep(150);
    }
  }

  const out = [];
  const dongCounts = {};
  for (const row of rows) {
    const dong = String(row["읍면동명"] || "").trim();
    const coord = dongCoords[dong];
    if (!coord) continue;

    const idx = (dongCounts[dong] || 0) + 1;
    dongCounts[dong] = idx;
    const off = offsetFor(idx, dong);

    const tarea = Number(row["연면적"] || 0);
    const year = Number(row["건축년도"] || 0);

    out.push({
      dong,
      kind: String(row["주택유형"] || ""),
      year: year > 0 ? year : null,
      struct: String(row["건축물대장주구조"] || ""),
      tarea: Number.isFinite(tarea) ? tarea : 0,
      grade: String(row["등급판정결과"] || ""),
      baseDate: String(row["데이터기준일자"] || ""),
      lat: coord.lat + off.dy,
      lon: coord.lon + off.dx,
    });
  }

  const outputPath = join(ROOT, "vacantlist_donggu.json");
  await writeFile(outputPath, JSON.stringify(out, null, " ") + "\n", "utf8");

  console.log(`\n완료: ${out.length}건 저장 (좌표 실패 ${rows.length - out.length}건)`);
  console.log(`저장 경로: ${outputPath}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
