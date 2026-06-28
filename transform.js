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
  // 도로명/지번 본번과 혼동 방지: '동' 글자가 붙은 숫자만
  const m = raw.match(/(\d+)\s*동(?![가-힣])/);
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
