// Browser-global API and data access layer. Loaded after transform.js.

// Static PNU data keeps the legacy code. HUB proxies normalize it before upstream calls.
const SIGUNGU = "29110";
const SIGUNGU_NEW = "12210";
// Successful JSON responses only. Full path + sorted parameters form the key.
// Live API TTL: 2 minutes; normal empty response TTL: 30 seconds. In-flight requests coalesce.
const SHARED_API_CACHE = new Map();
async function apiShared(path, params={}, {ttl=120000}={}){
  const key=JSON.stringify([path,Object.entries(params).sort(([a],[b])=>a.localeCompare(b))]);
  let entry=SHARED_API_CACHE.get(key);
  if(!entry || entry.expires<=Date.now()){
    entry={expires:Infinity};
    entry.pending=api(path,params).then(result=>{
      if(!result.ok){if(SHARED_API_CACHE.get(key)===entry)SHARED_API_CACHE.delete(key);return result;}
      const arrays=Object.values(result.data || {}).filter(Array.isArray);
      const empty=result.data?.found===false || (Object.hasOwn(result.data || {},'info') && result.data.info==null) || (arrays.length && arrays.every(a=>!a.length));
      entry.expires=Date.now()+(empty ? Math.min(ttl,30000) : ttl);
      return result;
    }).catch(()=>{if(SHARED_API_CACHE.get(key)===entry)SHARED_API_CACHE.delete(key);return {ok:false,status:0,data:null,kind:'network',cancelled:false,error:'불러오지 못했습니다. 다시 조회해 주세요.'};});
    SHARED_API_CACHE.set(key,entry);
    if(SHARED_API_CACHE.size>250)SHARED_API_CACHE.delete(SHARED_API_CACHE.keys().next().value);
  }
  return JSON.parse(JSON.stringify(await entry.pending)); // caller mutations cannot contaminate cache
}
let VACANT_DATASET_CACHE=null;
async function loadVacantDataset(){
  if(VACANT_DATASET_CACHE && VACANT_DATASET_CACHE.expires>Date.now())return VACANT_DATASET_CACHE.pending;
  const entry={expires:Date.now()+600000};
  entry.pending=(async()=>{
    const listResponse=await fetch('/vacantlist_donggu.json');
    if(!listResponse.ok)throw new Error('빈집 원본 로드 실패');
    const rows=await listResponse.json();
    let geometry=[],geometryState='success';
    try{const r=await fetch('/vacant_geo.json');if(!r.ok)throw new Error('geometry');geometry=await r.json();if(!Array.isArray(geometry))throw new Error('geometry');}
    catch{geometryState='error';if(VACANT_DATASET_CACHE===entry)VACANT_DATASET_CACHE=null;}
    return {records:createVacantDataset(rows,geometry),geometryState};
  })().catch(error=>{if(VACANT_DATASET_CACHE===entry)VACANT_DATASET_CACHE=null;throw error;});
  VACANT_DATASET_CACHE=entry;return entry.pending;
}
function isDonggu(p){ return p && (p.sigunguCd === SIGUNGU || p.sigunguCd === SIGUNGU_NEW); }

async function api(path, params){
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  try{
    const r = await fetch(`/api/${path}${qs}`);
    if(!r.ok){
      console.warn('[api]', { kind:'http', status:r.status, query:path });
      return { ok:false, status:r.status, data:null, kind:'http', cancelled:false, error:'불러오지 못했습니다. 다시 조회해 주세요.' };
    }
    let data;
    try { data = await r.json(); }
    catch {
      console.warn('[api]', {kind:'format',status:r.status,query:path});
      return {ok:false,status:r.status,data:null,kind:'format',cancelled:false,error:'불러오지 못했습니다. 다시 조회해 주세요.'};
    }
    const field = {juso:'juso',building:'titles',archpms:'items',aptid:'complexes'}[path];
    if(data?.error || !data || (field && !Array.isArray(data[field]))){
      const kind = data?.error ? 'upstream' : 'format';
      console.warn('[api]', { kind, status:r.status, query:path, op:params?.op || 'default' });
      return { ok:false, status:r.status, data:null, kind, cancelled:false, error:'불러오지 못했습니다. 다시 조회해 주세요.' };
    }
    return { ok:true, status:r.status, data, kind:'success', cancelled:false, error:null };
  }catch(e){
    const cancelled = e?.name === 'AbortError';
    console.warn('[api]', { kind:cancelled ? 'cancelled' : 'network', status:0, query:path });
    return { ok:false, status:0, data:null, cancelled, kind:cancelled ? 'cancelled' : 'network', error:'불러오지 못했습니다. 다시 조회해 주세요.' };
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
  retries = Math.min(3, Math.max(0, retries));
  let last = { ok:false, status:0, data:null };
  for(let attempt = 0; attempt <= retries; attempt++){
    last = await api(path, params);
    if(last.ok || last.cancelled || !RETRYABLE_STATUS.has(last.status)) return last;
    if(attempt === retries) break;
    // 지터가 없으면 동시 5건이 같은 시점에 재시도해 한도를 다시 친다
    await apiSleep(baseDelay * 2 ** attempt + Math.random() * baseDelay);
  }
  return last;
}

// Coalesced parcel requests still use the same transient-only retry policy.
const PARCEL_REQUEST_CACHE=new Map();
async function apiSharedRetry(path,params){
  const key=JSON.stringify([path,Object.entries(params).sort(([a],[b])=>a.localeCompare(b))]);
  let entry=PARCEL_REQUEST_CACHE.get(key);
  if(!entry || entry.expires<=Date.now()){
    entry={expires:Infinity};entry.pending=apiRetry(path,params).then(result=>{
      if(!result.ok && PARCEL_REQUEST_CACHE.get(key)===entry)PARCEL_REQUEST_CACHE.delete(key);
      else {const arrays=Object.values(result.data || {}).filter(Array.isArray);entry.expires=Date.now()+(arrays.length && arrays.every(a=>!a.length)?30000:120000);}
      return result;
    });PARCEL_REQUEST_CACHE.set(key,entry);
    if(PARCEL_REQUEST_CACHE.size>250)PARCEL_REQUEST_CACHE.delete(PARCEL_REQUEST_CACHE.keys().next().value);
  }
  return JSON.parse(JSON.stringify(await entry.pending));
}

async function searchJuso(keyword){
  const { ok, data } = await api("juso", { keyword });
  if(!ok) throw new Error('주소를 불러오지 못했습니다. 다시 조회해 주세요.');
  return Array.isArray(data.juso) ? data.juso : [];
}

async function fetchBuilding(p){
  const { ok, status, data, error } = await apiShared("building", {
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
  const { ok, data } = await apiShared("vworld-bld", { pnu });
  if(!ok) return { state:'error' };
  if(!data.found) return { state:'empty' };
  return { state:'success', properties: data.properties || {}, violtAny: data.violtAny === true, scope:'parcel' };
}

async function loadBldgis(pnu){
  if(!/^\d{19}$/.test(pnu||"")) return null;
  return await bldgisFromPNU(pnu);
}

async function loadLdaData(pnu){
  if(!/^\d{19}$/.test(pnu||"")) return null;
  const { ok, data } = await apiShared("vworld-bld", { pnu, op: "lda" });
  return ok ? {...data,state:data.found?'success':'empty'} : {state:'error'};
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
