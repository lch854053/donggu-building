// transform.js
// 순수 변환·포맷 유틸 (DOM·fetch·전역상태 의존 없음).
// index.html 의 메인 <script> 보다 먼저 로드되어 전역에 정의됨.
// 분리 출처: index.html (동작 보존 리팩토링, 로직 무변경)

function jusoToBldCandidates(j){
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if(p.sigunguCd !== "29110") return;          // 동구만
    const k = `${p.bjdongCd}-${p.bun}-${p.ji}-${p.platGbCd}`;
    if(seen.has(k)) return;                       // 중복 제거
    seen.add(k);
    out.push(p);
  };

  // admCd = 주소 자체(jibunAddr)의 법정동 — 법정동 판단의 기준
  const admCd = String(j.admCd || "").padEnd(10, "0");
  const admBjdong = admCd.substring(5, 10);

  // 후보 A: bdMgtSn 기반 (본번·부번이 정확한 경우가 많음)
  let candA = null;
  const sn = String(j.bdMgtSn || "");
  if(/^\d{19,}$/.test(sn)){
    candA = {
      sigunguCd: sn.substring(0, 5),
      bjdongCd:  sn.substring(5, 10),
      platGbCd:  sn.substring(10, 11) === "2" ? "1" : "0",
      bun:       sn.substring(11, 15),
      ji:        sn.substring(15, 19),
    };
  }

  // 후보 B: admCd + lnbr 기반 (주소의 법정동·지번)
  const candB = {
    sigunguCd: admCd.substring(0, 5),
    bjdongCd:  admBjdong,
    platGbCd:  j.mtYn === "1" ? "1" : "0",
    bun:       String(j.lnbrMnnm ?? 0).padStart(4, "0"),
    ji:        String(j.lnbrSlno ?? 0).padStart(4, "0"),
  };

  // bdMgtSn의 법정동이 주소(admCd)의 법정동과 다르면 그 건물관리번호는 신뢰 불가 →
  // bdMgtSn 후보(A)를 버리고 주소 기준 후보(B)만 사용한다.
  if(candA && candA.bjdongCd === admBjdong){
    push(candA);
    push(candB);
  } else {
    push(candB);
  }

  return out;
}

// juso 결과 배열에서 입력 주소의 건물번호에 맞는 결과가 top([0])이 되도록
// 순서를 보정한 새 배열을 반환한다. juso는 countPerPage만큼 여러 후보를 주는데,
// 타깃 건물보다 인근 번지가 먼저 반환되는 경우(예: "증심사길 85" 검색 → [0]=81)가
// 있다. 이때 jusoToBldGroup이 top(81)을 기준으로 같은 건물군만 남기므로 진짜
// 타깃(85)이 배제된다. 이를 막기 위해 입력과 본번이 일치하는 결과를 맨 앞으로
// 끌어올린다. 반환된 배열을 jusoToBldGroup 에 그대로 넘기면 된다.
// 다만 입력번호가 항상 도로명 본번인 것은 아니므로(동번호·지번주소 등),
// 아래 안전 조건을 모두 만족할 때만 보정한다:
//   (a) 동 번호 입력이 아님 (extractDong==null) — 동번호와 충돌 방지
//   (b) 입력 끝이 "도로명+본번[-부번]" 형태 — 지번주소 보호
//   (c) top 본번과 다를 때만 — 이미 맞으면 미발동
//   (d) 같은 도로명(rn)에서 본번이 일치하는 항목이 있을 때
//   (e) 본번 기준(입력에 부번까지 있으면 부번 우선) — 부번 강제로 다필지 유실 방지
function pickTop(raw, cands){
  if(!cands || !cands.length) return [];
  const fallback = cands.slice();
  // (a) 동 번호 입력이면 보정 금지
  if(extractDong(raw) !== null) return fallback;

  // (b) 입력 끝의 "도로명 본번[-부번]" 추출. '번지'가 붙거나 쉼표 뒤 상세주소가 있으면 제외.
  const tail = String(raw).replace(/\s*번지/g,"").split(",")[0].trim();
  const m = tail.match(/([가-힣A-Za-z]+(?:길|로|가|나|대로|거리))\s*(\d+)(?:-(\d+))?\s*$/);
  if(!m) return fallback;                  // 도로명 본번 형태가 아니면 보정 안 함 (지번 등)
  const inMain = m[2], inSub = m[3] || null;

  // (c) 이미 top 본번과 같으면 보정 불필요
  const top0 = cands[0];
  if(String(top0.buldMnnm || "") === inMain) return fallback;

  // (d)(e) 같은 도로명(rn) + 본번 일치 항목 찾기
  const rn = top0.rn || "";
  let bestIdx = -1;
  cands.forEach((j, i) => {
    if(bestIdx >= 0 && inSub) return;      // 부번까지 맞는 항목 찾았으면 확정
    if((j.rn || "") !== rn) return;        // 다른 도로명은 무시
    if(String(j.buldMnnm || "") !== inMain) return;
    const sub = j.buldSlno && j.buldSlno !== "0" ? j.buldSlno : null;
    if(inSub && sub === inSub) bestIdx = i; // 부번까지 정확 일치 → 최우선
    else if(bestIdx < 0) bestIdx = i;       // 본번만 일치 → 첫 후보
  });
  if(bestIdx <= 0) return fallback;        // 못 찾거나 이미 [0]이면 원 순서 유지

  // bestIdx 항목을 [0]으로 끌어올린 새 배열 반환 (나머지 순서 보존)
  const out = [cands[bestIdx]];
  cands.forEach((j, i) => { if(i !== bestIdx) out.push(j); });
  return out;
}

// juso 결과 배열에서 "같은 건물군" 후보 PNU 파라미터들을 모은다.
// 같은 도로명(rn) + 같은 건물본번(buldMnnm) + 같은 법정동(emdNm)이면
// 도로명주소 체계상 같은 건물군(본번은 같고 부번만 다른 인접 필지)으로 본다.
// 예) "중흥로 223" 검색 → [223→576-16, 223-1→576-13] 모두 후보
// 부속지번에만 대장이 걸려 있는 다필지 건물(대표지번엔 대장 없음) 대응.
function jusoToBldGroup(jusoList){
  if(!jusoList || !jusoList.length) return [];
  const top = jusoList[0];
  const rn = top.rn || "";
  const mnnm = top.buldMnnm || "";
  const emd = top.emdNm || "";
  // 도로명 정보가 없는 결과(지번 검색 등)면 최상위 1건만 그룹으로 인정
  const useGroup = !!(rn && mnnm);
  const seen = new Set();
  const out = [];
  for(const j of jusoList){
    if(useGroup){
      const sameGroup = (j.rn||"") === rn
                     && (j.buldMnnm||"") === mnnm
                     && (j.emdNm||"") === emd;
      if(!sameGroup) continue;          // 다른 건물군은 제외
    }
    for(const p of jusoToBldCandidates(j)){
      const k = `${p.bjdongCd}-${p.bun}-${p.ji}-${p.platGbCd}`;
      if(seen.has(k)) continue;
      seen.add(k); out.push(p);
    }
  }
  return out;
}

// 입력 주소에서 '동' 번호 추출 (예: "108동", "제108동", "108-1동" → "108")
// 숫자 기준. 못 찾으면 null
function extractDong(raw){
  // 도로명/지번 본번과 혼동 방지: '동' 글자가 붙은 번호(본번[-부번]동)만.
  // "108-1동"에서 부번(1)이 아니라 본번(108)을 잡아야 하므로, '동' 직전의
  // "본번-부번" 전체를 매칭한 뒤 본번(첫 숫자)을 취한다.
  const m = raw.match(/(\d+)(?:-\d+)?\s*동(?![가-힣])/);
  return m ? m[1] : null;
}

// 동명칭에서 숫자만 뽑아 비교 (대장상 "제108동","108","가동" 등 표기차 흡수)
function dongDigits(s){ const m = String(s||"").match(/\d+/); return m ? m[0] : null; }

// juso 검색용 주소 정제: 상세주소(층/호/상호) 제거하고 건물번호까지만 남김
// 예) "무등로307번길 4, 1층 신부헤어샵" → "무등로307번길 4"
//     "계림동 521-58번지, 2층"        → "계림동 521-58"
function cleanForSearch(raw){
  let s = raw.trim();
  s = s.split(",")[0];                 // 쉼표 뒤(상세주소) 제거
  s = s.replace(/번지/g, "");          // '번지' 제거
  s = s.replace(/\s+/g, " ").trim();
  // 광역시/도·시군구가 없으면 '광주광역시 동구' 보강 (이 툴은 동구 전용)
  // "중앙로 254" 같은 흔한 도로명이 타 지역으로 매칭되는 것 방지
  const hasSido = /(특별자치|광역시|특별시|[가-힣]+도)\s/.test(s) || s.includes("광주");
  const hasGugun = /(동구|서구|남구|북구|광산구)/.test(s);
  if(!hasSido && !hasGugun){
    s = "광주광역시 동구 " + s;
  }
  return s;
}

// 표시용 주소 정제: 괄호 묶음 전부 제거 (인명·법정동 모두 제거)
// 예) "계림동 521-58 (윤지애)" → "계림동 521-58",  "무등로384번길 15 (계림동)" → "무등로384번길 15"
function stripParens(s){
  return String(s||"").replace(/\s*\([^)]*\)\s*$/,"").replace(/\s*\([^)]*\)/g,"").trim();
}

// 표제부(동 1개) 정보 정리
// 표제부 → 총주차 대수. totPkngCnt 가 비었으면 옥내/옥외 × 자주식/기계식 합산(폴백).
// 지자체가 합계칸은 비우고 항목별만 입력하는 경우가 흔해 합산이 필요함. 0이면 0 반환.
function totalParking(t){
  if(!t) return 0;
  const tot = Number(t.totPkngCnt || 0);
  if(tot > 0) return tot;
  return ["indrAutoUtcnt","oudrAutoUtcnt","indrMechUtcnt","oudrMechUtcnt"]
    .reduce((s,k)=> s + (Number(t[k]||0) || 0), 0);
}

function mergeBuilding(title){
  return {
    dongNm:       title.dongNm || "",                 // 동명칭 (단지일 때만)
    atchGb:       title.mainAtchGbCdNm || "주건축물", // 주/부속 구분
    bldNm:        stripParens(title.bldNm) || "-",
    platPlc:      stripParens(title.platPlc) || "-",
    newPlatPlc:   stripParens(title.newPlatPlc) || "-",
    mainPurps:    title.mainPurpsCdNm || "-",
    strct:        title.strctCdNm || "-",
    platArea:     title.platArea ?? null,
    archArea:     title.archArea ?? null,
    totArea:      title.totArea ?? null,
    bcRat:        title.bcRat ?? null,
    vlRat:        title.vlRat ?? null,
    grndFlr:      title.grndFlrCnt ?? null,
    ugrndFlr:     title.ugrndFlrCnt ?? null,
    useAprDay:    title.useAprDay || "-",
    totPkng:      totalParking(title),                // 총주차(합산 폴백 포함)
  };
}

// 필지 파라미터 → PNU 19자리 (vworld-parcel.js 의 platGbCd 역변환과 일치)
function toPNU(p){
  const san = p.platGbCd === "1" ? "2" : "1";   // 1=산, 0/일반=대지
  return `${p.sigunguCd}${p.bjdongCd}${san}` +
         `${String(p.bun).padStart(4,"0")}${String(p.ji).padStart(4,"0")}`;
}

// 필지 파라미터 → 행정동명.
// 매핑 키는 법정동코드(5)+번(4)+지(4)=13자리 (haengjeong.json jibun2hdong 키와 동일).
// HJ(행정동 매핑 객체)를 인자로 받아 DOM·전역 의존 없이 순수 유지.
// 매핑이 없으면 빈 문자열 반환.
function hdongOf(p, HJ){
  if(!p || !HJ) return "";
  const key = `${p.bjdongCd}${String(p.bun||"").padStart(4,"0")}${String(p.ji||"").padStart(4,"0")}`;
  return (HJ.jibun2hdong || {})[key] || "";
}

function fmt(n){ return n==null ? "-" : Number(n).toLocaleString("ko-KR"); }

function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// 사용승인일에서 연도만 추출 ("20150911"→2015, "2015"→2015, 누락→null)
function extractYear(useAprDay){
  if(!useAprDay || useAprDay==="-") return null;
  const s = String(useAprDay).replace(/\D/g,"");   // 숫자만
  if(s.length>=4) return parseInt(s.substring(0,4),10);
  return null;
}

// 표시용 날짜 포맷 ("20150911"→2015.09.11, "201509"→2015.09, "2015"→2015)
function fmtUseApr(s){
  const d = String(s||"").replace(/\D/g,"");
  if(d.length>=8) return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
  if(d.length>=6) return `${d.slice(0,4)}.${d.slice(4,6)}`;
  if(d.length>=4) return d.slice(0,4);
  return esc(s||"-");
}

// 공백 제거
function norm(s){ return String(s||"").replace(/\s/g,""); }

// 카테고리 매칭: sel 비었으면 전체통과. '기타'=알려진 어디에도 안 걸리는 값
function matchCat(value, sel, opts){
  if(!sel.length) return true;
  const v = norm(value);
  const known = opts.map(norm);
  for(const s of sel){
    if(s==="기타"){ if(!known.some(k=>v.includes(k))) return true; }
    else if(v.includes(norm(s))) return true;
  }
  return false;
}

// 동 시작 숫자(없으면 Infinity) — 숫자 동 정렬용
function leadNum(t){
  const s = String(t.dongNm||"").trim() || stripParens(String(t.bldNm||"").trim());
  const m = s.match(/^(\d+)/);
  return m ? parseInt(m[1],10) : Infinity;
}

// 동명칭 매칭 (표제부 동 ↔ 층별 동)
function dongMatch(a, b){
  a=String(a||"").trim(); b=String(b||"").trim();
  if(!a||!b) return false;
  if(a===b) return true;
  const da=dongDigits(a), db=dongDigits(b);
  return !!(da && db && da===db);
}

function dedupeBy(items, keyFn){
  const seen=new Set(); const out=[];
  for(const r of items){ const k=keyFn(r); if(seen.has(k)) continue; seen.add(k); out.push(r); }
  return out;
}

// 표제부 1건 → 표시용 명칭 (동명칭→건물명→주부속구분, 숫자 동만 '동' 부착)
function bldLabel(t){
  const dong = String(t.dongNm||"").trim();
  if(dong) return /^\d+$/.test(dong) ? dong+"동" : dong;
  const bld = stripParens(String(t.bldNm||"").trim());
  if(bld) return bld;
  return String(t.mainAtchGbCdNm||"").trim() || "-";
}

function gbLabel(rows){ return rows.some(t=>String(t.regstrGbCd)==="2") ? "집합건물" : "일반건축물"; }

// juso 결과(j)의 도로명 건물번호와, 건축물대장 결과(t)의 도로명주소(newPlatPlc)가
// 일치하는지 검사. juso의 bdMgtSn이 다른 건물(예: 운림길 57-16에 57-12의 관리번호
// 부여)을 가리키는 오매핑을 걸러내기 위함.
// 비교: juso의 "도로명 본번-부번"(buldMnnm/buldSlno) ↔ newPlatPlc에서 추출한 번호.
//   예) j.buldMnnm=57, j.buldSlno=16 ↔ newPlatPlc "...운림길 57-16 ..."
// 번호가 없거나 도로명이 아니면 true(통과) — 폴백 지번주소 검색 등 무해하게.
function roadMatches(j, t){
  const mnnm = String(j?.buldMnnm || "").trim();
  if(!mnnm) return true;                  // 도로명 정보 없으면 검사 생략
  const slno = String(j?.buldSlno || "0").trim();
  const road = String(t?.newPlatPlc || "").replace(/\s*\([^)]*\)/g, "");
  // 도로명주소 끝의 "본번" 또는 "본번-부번" 추출
  const m = road.match(/(\d+)(?:-(\d+))?\s*$/);
  if(!m) return true;                     // 도로명 형태 아니면 검사 생략
  const main = m[1], sub = m[2] || "0";
  return main === mnnm && sub === slno;
}

// GeoJSON 필지 geometry의 대략적 면적(㎡) 계산.
// 위경도 좌표를 평면 투영 근사(cos(lat) 보정). 지도 표시용 필터링에만 쓰임.
// MultiPolygon/Polygon 모두 처리(외곽 링만 합산). 비정상적으로 큰 부속 필지(산림 등)를
// 거르는 용도이므로 정밀도보다 크기 차수가 중요.
function geomAreaM2(geom){
  if(!geom || !geom.coordinates) return 0;
  const R = 6378137;   // 지구 반경(m)
  const toRad = d => d * Math.PI / 180;
  const ringArea = (ring) => {
    if(!ring || ring.length < 3) return 0;
    let s = 0;
    for(let i=0; i<ring.length; i++){
      const a = ring[i], b = ring[(i+1) % ring.length];
      const ax = a[0] * Math.cos(toRad((a[1]+b[1])/2)) * (Math.PI/180) * R;
      const bx = b[0] * Math.cos(toRad((a[1]+b[1])/2)) * (Math.PI/180) * R;
      const ay = a[1] * (Math.PI/180) * R;
      const by = b[1] * (Math.PI/180) * R;
      s += ax * by - bx * ay;
    }
    return Math.abs(s) / 2;
  };
  let total = 0;
  if(geom.type === "Polygon") total += ringArea(geom.coordinates[0]);
  else if(geom.type === "MultiPolygon") for(const poly of geom.coordinates) total += ringArea(poly[0]);
  return total;
}

// GeoJSON 폴리곤 안에 점(lon,lat)이 포함되는가 (Ray-casting, 외곽 링 기준).
// Polygon/MultiPolygon 모두 처리. bbox contains와 달리 실제 모양을 따져 거대 산림
// 필지가 좌표를 bbox로만 덮을 때 오탐되는 것을 방지.
function geomContainsPoint(geom, lon, lat){
  if(!geom || !geom.coordinates) return false;
  const inRing = (ring) => {
    let inside = false;
    for(let i=0, j=ring.length-1; i<ring.length; j=i++){
      const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
      if(((yi>lat)!=(yj>lat)) && (lon < (xj-xi)*(lat-yi)/(yj-yi)+xi)) inside = !inside;
    }
    return inside;
  };
  if(geom.type === "Polygon") return inRing(geom.coordinates[0]);
  if(geom.type === "MultiPolygon") return geom.coordinates.some(p => inRing(p[0]));
  return false;
}
