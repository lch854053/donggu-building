// Browser-global API and data access layer. Loaded after transform.js.

// Static PNU data keeps the legacy code. HUB proxies normalize it before upstream calls.
const SIGUNGU = "29110";
const SIGUNGU_NEW = "12210";
function isDonggu(p){ return p && (p.sigunguCd === SIGUNGU || p.sigunguCd === SIGUNGU_NEW); }

async function api(path, params){
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  try{
    const r = await fetch(`/api/${path}${qs}`);
    if(!r.ok) return { ok:false, status:r.status, data:null };
    return { ok:true, status:r.status, data: await r.json() };
  }catch(e){
    return { ok:false, status:0, data:null, error:String(e?.message||e) };
  }
}

// 재시도 대상: 네트워크 끊김(0) + 상류 지연/한도초과로 프록시가 내는 5xx·429.
// 400/403 처럼 같은 요청을 다시 보내도 결과가 같은 응답은 재시도하지 않는다.
const RETRYABLE_STATUS = new Set([0, 408, 425, 429, 500, 502, 503, 504]);
const apiSleep = (ms)=> new Promise(r=>setTimeout(r, ms));

// 동단위 스캔처럼 한 번에 수십 건을 던지는 경로용 래퍼.
// 공공데이터포털이 느려지면 프록시가 8초 타임아웃으로 504를 내는데, 이를 그대로
// 빈 결과로 삼으면 "조회 0건"으로 보인다. 지수 백오프 + 지터로 일시 오류만 되돌린다.
async function apiRetry(path, params, { retries = 3, baseDelay = 400 } = {}){
  let last = { ok:false, status:0, data:null };
  for(let attempt = 0; attempt <= retries; attempt++){
    last = await api(path, params);
    if(last.ok || !RETRYABLE_STATUS.has(last.status)) return last;
    if(attempt === retries) break;
    // 지터가 없으면 동시 5건이 같은 시점에 재시도해 한도를 다시 친다
    await apiSleep(baseDelay * 2 ** attempt + Math.random() * baseDelay);
  }
  return last;
}

async function searchJuso(keyword){
  const { ok, data } = await api("juso", { keyword });
  if(!ok) return [];
  return Array.isArray(data.juso) ? data.juso : [];
}

async function fetchBuilding(p){
  const { ok, status, data, error } = await api("building", {
    sigunguCd:p.sigunguCd, bjdongCd:p.bjdongCd,
    platGbCd:p.platGbCd, bun:p.bun, ji:p.ji
  });
  if(!ok) return { titles:[], error: status ? `서버 오류 ${status}` : error };
  return {
    titles: Array.isArray(data.titles) ? data.titles : [],
    error:  data.error || null
  };
}

async function fetchArchBuilding(p){
  const { ok, status, data, error } = await api("archpms", {
    op:"getApBasisOulnInfo",
    sigunguCd:p.sigunguCd, bjdongCd:p.bjdongCd,
    platGbCd:p.platGbCd, bun:p.bun, ji:p.ji
  });
  if(!ok) return { items:[], error: status ? `서버 오류 ${status}` : error };
  return {
    items: Array.isArray(data.items) ? data.items : [],
    error:  data.error || null
  };
}

async function geocodeAddr(address){
  const { ok, data } = await api("vworld-geocode", { address });
  return ok && data.found ? {x:data.x, y:data.y} : null;
}

async function parcelFromCoord(x, y){
  const { ok, data } = await api("vworld-parcel", { x, y });
  return ok && data.found ? data : null;
}

async function fetchAllParcelPNUs(p){
  const set = new Set([ toPNU(p) ]);
  const { ok, data } = await api("building", {
    op:"getBrAtchJibunInfo",
    sigunguCd:p.sigunguCd, bjdongCd:p.bjdongCd,
    platGbCd:p.platGbCd, bun:p.bun, ji:p.ji
  });
  if(ok){
    for(const it of (data.titles || [])){
      if(it.atchBjdongCd && it.atchBun != null){
        set.add(toPNU({
          sigunguCd: it.atchSigunguCd || p.sigunguCd,
          bjdongCd:  it.atchBjdongCd,
          platGbCd:  it.atchPlatGbCd || "0",
          bun:       it.atchBun, ji: it.atchJi
        }));
      }
    }
  }
  return [...set];
}

async function parcelGeomFromPNU(pnu){
  const { ok, data } = await api("vworld-parcel", { pnu });
  return ok && data.found ? data.geometry : null;
}

async function bldgisFromPNU(pnu){
  const { ok, data } = await api("vworld-bld", { pnu });
  if(!ok || !data.found) return null;
  return { properties: data.properties || {}, violtAny: data.violtAny === true };
}

async function loadBldgis(pnu){
  if(!/^\d{19}$/.test(pnu||"")) return null;
  return await bldgisFromPNU(pnu);
}

async function loadLdaData(pnu){
  if(!/^\d{19}$/.test(pnu||"")) return null;
  const { ok, data } = await api("vworld-bld", { pnu, op: "lda" });
  return ok && data.found ? data : null;
}

async function paramsViaVworld(address){
  const pt = await geocodeAddr(address);
  if(!pt) return null;
  const parcel = await parcelFromCoord(pt.x, pt.y);
  if(!parcel) return null;
  return {
    sigunguCd: SIGUNGU,
    bjdongCd:  parcel.bjdongCd,
    platGbCd:  parcel.platGbCd,
    bun:       parcel.bun,
    ji:        parcel.ji,
  };
}
