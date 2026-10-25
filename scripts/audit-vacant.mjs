import {readFile,writeFile} from 'node:fs/promises';
import {createVacantDataset,vacantCounts,vacantAddressKey,vacantLegacyMatchKey,vacantFingerprint,groupVacantGeometry} from './lib/vacant-model.mjs';
const root=new URL('../',import.meta.url);
const list=JSON.parse(await readFile(new URL('vacantlist_donggu.json',root)));
const geo=JSON.parse(await readFile(new URL('vacant_geo.json',root)));
const records=createVacantDataset(list,geo);
const groups=new Map(), duplicates=new Map();
for(const r of records){
  const address=vacantAddressKey(r.jibun);
  if(!groups.has(address))groups.set(address,[]);groups.get(address).push(r);
  const fingerprint=vacantFingerprint(r);
  if(!duplicates.has(fingerprint))duplicates.set(fingerprint,[]);duplicates.get(fingerprint).push(r.recordId);
}
const report={unit:'source-record; not confirmed building count',counts:vacantCounts(records),legacyGeometryRows:geo.length,
  normalizedAddresses:groups.size,sourceIdRows:records.filter(r=>r.sourceId).length,
  rawCoordinateRows:records.filter(r=>r.hasSourceCoordinates).length,
  duplicateSourceFieldGroups:[...duplicates.values()].filter(a=>a.length>1),
  sameAddressGroups:[...groups].filter(([k,a])=>a.length>1).map(([address,a])=>({address,recordIds:a.map(r=>r.recordId),years:a.map(r=>r.year),coordinates:a.map(r=>[r.x,r.y]),conclusion:'동일 건물 여부 미확인; 원본 행 모두 보존'})),
  sharedGeometryGroups:groupVacantGeometry(records).filter(g=>g.members.length>1).map(g=>({parcelId:g.parcelId,recordIds:g.members.map(r=>r.recordId)})),
  unlocated:records.filter(r=>!r.geometry).map(r=>({recordId:r.recordId,address:r.jibun,rawCoordinatesAvailable:r.hasSourceCoordinates,reason:r.locationReason,note:r.locationNote})),
  orphanGeometry:geo.filter(g=>!list.some(r=>vacantLegacyMatchKey(r)===vacantLegacyMatchKey(g))).map(g=>({pnu:g.pnu,address:g.jibun,note:'기준 목록에 동일 속성 레코드 없음; 별도 검토 필요'}))};
await writeFile(new URL('docs/p2-vacant-audit.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,sameAddressGroups:report.sameAddressGroups.length,sharedGeometryGroups:report.sharedGeometryGroups.length,unlocated:report.unlocated.length,orphanGeometry:report.orphanGeometry.length},null,2));
