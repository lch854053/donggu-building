// Shared browser-global model. IDs identify source records, NEVER buildings or parcels.
function vacantAddressKey(value){ return String(value || '').normalize('NFC').replace(/\s+/g,''); }
function vacantFingerprint(row){
  return JSON.stringify(['dong','kind','year','struct','tarea','grade','baseDate','x','y'].map(k=>row[k] ?? null));
}
function vacantHash(text){
  let hash = 14695981039346656037n;
  for(const c of text){ hash ^= BigInt(c.codePointAt(0)); hash = BigInt.asUintN(64,hash*1099511628211n); }
  return hash.toString(16).padStart(16,'0');
}
function identifyVacantRows(rows){
  const seen = new Map(), hashes = new Map();
  return rows.map(row=>{
    if(row.recordId) return {...row};
    const fingerprint = vacantFingerprint(row), hash = vacantHash(fingerprint);
    if(hashes.has(hash) && hashes.get(hash)!==fingerprint) throw new Error('빈집 식별자 충돌');
    hashes.set(hash,fingerprint);
    const hasSourceId=row.sourceId!=null && String(row.sourceId).trim()!=='';
    const key = hasSourceId ? `source:${encodeURIComponent(String(row.sourceId))}` : `derived:${hash}`;
    const occurrence = (seen.get(key)||0)+1; seen.set(key,occurrence);
    return {...row,recordId:`vacant:${key}:${occurrence}`,identityBasis:hasSourceId?'source-id':'source-fields-occurrence',
      identityNote:'원본 레코드 ID. 건물 식별자가 아니며 동일 행 사본의 개별 실체는 미확인.'};
  });
}
function vacantLegacyMatchKey(row){
  return JSON.stringify([vacantAddressKey(row.jibun),vacantAddressKey(row.doro),...['dong','hdong','kind','year','struct','tarea','grade'].map(k=>row[k] ?? null)]);
}
function vacantGeometryKey(row){
  return row.geometry ? `${row.parcelId || row.pnu || ''}:${JSON.stringify(row.geometry)}` : '';
}
function createVacantDataset(sourceRows, geometryRows){
  if(!Array.isArray(sourceRows)||!Array.isArray(geometryRows)) throw new Error('빈집 데이터 형식 오류');
  const ids = identifyVacantRows(sourceRows), byId = new Map(), legacy = new Map();
  for(const geo of geometryRows){
    if(geo.recordId) byId.set(geo.recordId,geo);
    else {
      const key=vacantLegacyMatchKey(geo);
      if(!legacy.has(key)) legacy.set(key,[]);
      legacy.get(key).push(geo);
    }
  }
  const records=ids.map(row=>{
    let match=byId.get(row.recordId), basis=match?'record-id':null;
    let reason='geometry-not-collected-or-record-unmatched';
    if(match && ((match.recordFingerprint && match.recordFingerprint!==vacantFingerprint(row)) ||
      (match.jibun!=null && vacantAddressKey(match.jibun)!==vacantAddressKey(row.jibun)))){match=null;basis=null;}
    if(!match){
      const candidates=legacy.get(vacantLegacyMatchKey(row)) || [];
      // Full available metadata must agree, and candidates must describe one geometry.
      // Sharing a parcel geometry does not merge or identify buildings.
      const shapes=new Set(candidates.filter(g=>g.geometry).map(vacantGeometryKey));
      if(candidates.length && shapes.size>1)reason='ambiguous-legacy-geometry';
      if(shapes.size===1){match=candidates.find(g=>g.geometry);basis='legacy-metadata-parcel';}
    }
    return {...row,source:row.source || '동구 빈집 현황 (odcloud)',collectedAt:row.collectedAt || null,
      addressBasis:row.addressBasis || '기존 주소 보강 자료 · 건물 매칭 미확인',
      parcelId:match?.parcelId || match?.pnu || row.parcelId || null,
      geometry:match?.geometry || null,geometryStatus:match?.geometry ? 'available' : match?.geometryStatus || 'unknown',
      geometryBasis:basis,geometryScope:match?.geometryScope || 'parcel-or-legacy-approximation',
      locationReason:match?.geometryReason || (match?.geometry?'matched-parcel-or-reference-geometry':reason),
      hasSourceCoordinates:Number.isFinite(row.x) && Number.isFinite(row.y),
      locationNote:match?.geometry ? '원본 레코드의 필지/참고 도형. 개별 건물 동일성은 미확인.' :
        match?.geometryStatus==='error' ? '위치정보 조회 실패 · 원본 레코드 보존, 개별 위치 미확인' :
        `위치 미확인 · 도형/레코드 대응 미확인. ${Number.isFinite(row.x)&&Number.isFinite(row.y)?'원본 좌표는 개별 건물 위치로 검증되지 않았습니다.':'원본 좌표 미제공.'}`};
  });
  if(new Set(records.map(r=>r.recordId)).size!==records.length) throw new Error('빈집 레코드 ID 중복');
  return records;
}
function groupVacantGeometry(records){
  const groups=new Map();
  for(const row of records){
    const key=vacantGeometryKey(row);if(!key)continue;
    if(!groups.has(key)) groups.set(key,{...row,members:[]});
    groups.get(key).members.push(row);
  }
  return [...groups.values()];
}
function vacantCounts(records){
  const located=records.filter(r=>r.geometry).length;
  return {total:records.length,located,unknown:records.length-located,shapes:groupVacantGeometry(records).length};
}
