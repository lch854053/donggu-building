/*
  aptlist_donggu.json 의 각 K-apt 단지에 대해,
  K-apt 기본정보의 도로명주소를 행안부 주소검색(juso)으로 정제하여
  올바른 PNU(법정동코드+대지+본번+부번)를 보강합니다.

  실행:
    node scripts/enrich-aptlist.mjs

  필요한 환경:
    - 프로젝트 루트의 aptlist_donggu.json
    - 동작 중인 로컬 또는 운영 API (/api/aptinfo, /api/juso)
    - BASE_URL 환경변수 (기본값: http://localhost:3000)
*/

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
const ORIGIN = process.env.ALLOWED_ORIGIN || BASE_URL;

const inputPath = join(ROOT, "aptlist_donggu.json");
const outputPath = inputPath;

async function api(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${qs ? "?" + qs : ""}`;
  const res = await fetch(url, { headers: { Origin: ORIGIN } });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

async function fetchAptBass(kaptCode) {
  const { info } = await api("/api/aptinfo", { op: "getAphusBassInfoV4", kaptCode });
  return info;
}

async function searchJuso(keyword) {
  const { juso } = await api("/api/juso", { keyword });
  return Array.isArray(juso) ? juso[0] : null;
}

function pnuFromJuso(j) {
  if (!j) return "";
  const adm = String(j.admCd || "").padEnd(10, "0");
  const bun = String(j.lnbrMnnm ?? 0).padStart(4, "0");
  const ji = String(j.lnbrSlno ?? 0).padStart(4, "0");
  return `${adm}1${bun}${ji}`;
}

function normalizeDoro(addr) {
  let s = String(addr || "")
    .replace(/전남광주통합특별시/g, "광주광역시")
    .replace(/\s+/g, " ")
    .trim();
  // "... 용산동 668 용산대성베르힐"처럼 뒤에 단지명이 붙은 경우,
  // 마지막 번호(또는 번호-부번) 뒤의 단지명을 제거한다.
  s = s.replace(/(\d+(?:-\d+)?)\s+[가-힣A-Za-z].*$/, "$1");
  return s;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const list = JSON.parse(await readFile(inputPath, "utf8"));
  const out = [];
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    process.stdout.write(`[${i + 1}/${list.length}] ${item.kaptName} ... `);
    try {
      const bass = await fetchAptBass(item.kaptCode);
      const doro = normalizeDoro(bass?.doroJuso);
      const jibun = normalizeDoro(bass?.kaptAddr);
      let pnu = "";
      if (doro) {
        const j = await searchJuso(doro);
        pnu = pnuFromJuso(j);
      }
      // 도로명주소가 없거나 PNU 미생성 시 지번주소로 폭백
      if (!pnu && jibun) {
        const j = await searchJuso(jibun);
        pnu = pnuFromJuso(j);
      }
      out.push({ ...item, pnu });
      if (pnu) {
        ok++;
        console.log(`OK ${pnu}`);
      } else {
        fail++;
        console.log("FAIL (PNU 없음)");
      }
    } catch (e) {
      out.push(item);
      fail++;
      console.log(`ERROR ${e.message}`);
    }
    await sleep(150);
  }

  await writeFile(outputPath, JSON.stringify(out, null, " ") + "\n", "utf8");
  console.log(`\n완료: PNU 보강 ${ok}건, 실패 ${fail}건, 총 ${list.length}건`);
  console.log(`출력: ${outputPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
