// scripts/collect-bjd-bounds.mjs
// VWorld 법정동 경계(LT_C_ADEMD_INFO)에서 동구 34개 법정동 폴리곤을 수집해
// bjd_bounds.json(정적 파일)으로 저장. 지도 탭 조건검색의 뷰포트 필터링에 사용.
// 뷰포트 교차 판정에는 전체 폴리곤(644KB) 대신 bounds(직사각형, 3.4KB)만 있어 충분.
//
// 매핑: VWorld emd_cd(신 8자리, 12210109) ↔ 우리 bjdongCd(구 5자리, 10900)
//   emd_cd = "12210" + bjdongCd.slice(0,3)
//   bjdongCd = emd_cd.slice(5).padStart(3,"0") + "00"

import { writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const VWORLD_KEY = process.env.VWORLD_KEY;
const DOMAIN = "https://donggu-building.vercel.app";

if (!VWORLD_KEY) { console.error("VWORLD_KEY 미설정"); process.exit(1); }

// GeoJSON geometry의 모든 좌표 순회 → [minX, minY, maxX, maxY] bounds
function geomToBounds(geom) {
  let xs = [], ys = [];
  const walk = (a) => {
    if (typeof a[0] === "number") { xs.push(a[0]); ys.push(a[1]); }
    else if (Array.isArray(a)) a.forEach(walk);
  };
  walk(geom.coordinates);
  if (!xs.length) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

async function main() {
  const params = new URLSearchParams({
    service: "data", request: "GetFeature", data: "LT_C_ADEMD_INFO",
    attrFilter: "emd_cd:LIKE:12210",   // 동구 전체(신코드)
    crs: "EPSG:4326", format: "json", size: "100",
    key: VWORLD_KEY, domain: DOMAIN,
  });
  const r = await fetch(`https://api.vworld.kr/req/data?${params}`);
  const data = await r.json();
  if (data?.response?.status !== "OK") {
    console.error("VWorld 오류:", data?.response?.status, data?.response?.error?.text || "");
    process.exit(1);
  }
  const feats = data?.response?.result?.featureCollection?.features || [];
  console.log(`동구 법정동 경계: ${feats.length}건 수집`);

  // bjdongCd(구 5자리) → { name, b: [minX, minY, maxX, maxY] }
  const out = {};
  for (const f of feats) {
    const p = f.properties || {};
    const emdCd = String(p.emd_cd || "");                  // 12210109
    const bjdCd = emdCd.slice(5).padStart(3, "0") + "00";  // 109 → 10900
    const b = geomToBounds(f.geometry);
    if (b) out[bjdCd] = { name: p.emd_kor_nm || "", b };
  }

  const path = join(ROOT, "bjd_bounds.json");
  await writeFile(path, JSON.stringify(out, null, " ") + "\n", "utf8");
  const st = await stat(path);
  console.log(`저장: ${path} (${Object.keys(out).length}개 법정동, ${(st.size / 1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });

