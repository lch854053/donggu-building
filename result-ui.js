/* Progressive result presentation. Existing data, query owners and table renderers stay authoritative. */
(function(){
  'use strict';
  const F=ResultFormat,$=id=>document.getElementById(id),models=new Map(),inlineMaps=new Map();
  const configs=F.columns;
  const count=tab=>({bulk:B_RESULTS.length,cond:CRESULTS.length,housing:HRESULTS.length,demol:MRESULTS.length,vacant:V_RESULTS.length}[tab]||0);
  function record(tab,index){return {bulk:B_RESULTS,cond:CRESULTS,housing:HRESULTS,demol:MRESULTS,vacant:V_RESULTS}[tab]?.[index];}
  function offset(tab){return tab==='cond'?(C_PAGE-1)*C_PAGE_SIZE:tab==='housing'?(H_PAGE-1)*H_PAGE_SIZE:tab==='demol'?(M_PAGE-1)*M_PAGE_SIZE:tab==='vacant'?(V_PAGE-1)*V_PAGE_SIZE:0;}
  function cell(value,kind,unit=''){return F.scalar(value,kind)+(F.scalar(value,kind)==='미확인'?'':unit);}
  function button(text,fn){const b=document.createElement('button');b.type='button';b.className='result-action';b.textContent=text;b.onclick=e=>{e.stopPropagation();fn(b);};return b;}
  function address(tab,r){const d=tab==='bulk'?r.data:r;return String((tab==='bulk'?r.input:d?.newPlatPlc&&d.newPlatPlc!=='-'?d.newPlatPlc:d?.doroAddr||d?.doro||d?.platPlc||d?.adres||d?.jibun)||'').trim();}
  function detailLink(addr,title,selected){
    if(!addr||addr==='-')return null;
    const state={v:1,tab:'detail',f:{dInput:addr}};if(selected)state.pick={id:String(selected)};
    let href;try{href=SearchState.encode(state,location.href);}catch{return null;}
    const a=document.createElement('a');a.className='result-action';a.href=href;a.target='_blank';a.rel='noopener';a.textContent=title||'건물 상세 보기 · 새 탭';a.title='원래 목록을 유지하고 새 탭에서 이 주소만 조회합니다. 다건 필지는 동을 확인하세요.';a.onclick=e=>e.stopPropagation();return a;
  }
  function querySummary(tab){
    if(tab==='bulk')return `${B_RESULTS.length.toLocaleString('ko-KR')}개 입력주소 · 주소별 조회 상태 확인`;
    const run=FilterUI.models.get(tab)?.published;return run?FilterModel.summary(run.filters,run.defaults):'실제 조회 조건은 검색이 실행된 후 표시됩니다.';
  }
  function state(tab){
    if(tab==='bulk'){
      const pending=UI_QUERY_ACTIVITY.has('bulk'),bad=B_RESULTS.filter(r=>r.status==='err').length,success=B_RESULTS.filter(r=>['ok','warn','none'].includes(r.status)).length;
      return F.state(pending?'조회 중':models.get(tab)?.cancelled?'취소됨':bad?(success?'부분 조회':'전체 실패'):'전체 조회 완료',{busy:pending,count:B_RESULTS.filter(r=>['ok','warn'].includes(r.status)).length});
    }
    const model=FilterUI.models.get(tab),run=model?.published,attempt=model?.attempt;
    const phase=attempt&&attempt.id!==run?.id?attempt.phase:run?.phase||attempt?.phase||'조회 중';
    return F.state(phase,{count:count(tab),busy:!!attempt?.busy,cancelled:phase.includes('취소')});
  }
  function mount(tab){
    if(models.has(tab))return models.get(tab);
    const c=configs[tab],root=$(c.root),table=$(c.body).closest('table'),header=table.tHead.rows[0];
    if(tab==='cond'){const th=document.createElement('th');th.textContent='조회 상태';header.append(th);}
    const actionHead=document.createElement('th');actionHead.textContent='상세·위치';header.append(actionHead);
    const headers=[...header.cells];headers.forEach((th,i)=>{th.scope='col';th.id=`result-col-${tab}-${i}`;});
    if(tab==='housing')headers[4].textContent='주소 (도로명 우선)';if(tab==='cond')headers[3].textContent='주소 (도로명 우선)';
    const summary=document.createElement('section');summary.className='result-summary';summary.setAttribute('aria-label','조회 결과 요약');
    const live=document.createElement('p');live.className='result-summary-count';live.setAttribute('role','status');live.setAttribute('aria-live','polite');summary.append(live);
    const conditions=document.createElement('p');conditions.className='result-summary-conditions';summary.append(conditions);
    const status=document.createElement('p');status.className='result-summary-state';status.setAttribute('role','status');status.setAttribute('aria-live','polite');summary.append(status);
    const warning=document.createElement('p');warning.className='result-summary-warning';summary.append(warning);
    const actions=document.createElement('div');actions.className='result-summary-actions';summary.append(actions);
    const exportId={bulk:'exportBtn',cond:'cExportBtn',housing:'hExportBtn',demol:'mExportBtn',vacant:'vExportBtn'}[tab];actions.append($(exportId));
    actions.append(button('결과표로 이동',()=>{table.tabIndex=-1;table.focus();table.scrollIntoView({block:'start'});}));
    const help=document.createElement('small');help.textContent='행의 상세·위치에서 이어서 확인 · 엑셀은 전체 항목 저장';actions.append(help);
    const chooser=document.createElement('details');chooser.className='result-column-tools';chooser.innerHTML='<summary>표시 항목</summary><p>PC 표 표시 설정입니다. 모바일 필수 정보·검색 조건·엑셀에는 영향을 주지 않습니다.</p>';
    const selected=new Set(c.basic),required=new Set(c.required);
    const choices=document.createElement('div');choices.className='result-column-choices';
    for(const [i,th]of headers.entries()){
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=selected.has(i);input.disabled=required.has(i);input.dataset.column=i;input.onchange=()=>{input.checked?selected.add(i):selected.delete(i);applyColumns(tab);};label.append(input,th.textContent+(required.has(i)?' (필수)':''));choices.append(label);
    }
    chooser.append(choices,button('기본 항목',()=>{selected.clear();c.basic.forEach(i=>selected.add(i));applyColumns(tab);}),button('전체 항목',()=>{headers.forEach((_,i)=>selected.add(i));applyColumns(tab);}));summary.append(chooser);root.prepend(summary);
    const model={c,root,table,headers,summary,live,conditions,status,warning,actions,selected,chooser};models.set(tab,model);return model;
  }
  function applyColumns(tab){
    const m=mount(tab);for(const input of m.chooser.querySelectorAll('input'))input.checked=m.selected.has(+input.dataset.column);
    for(const th of m.headers)th.classList.toggle('result-column-hidden',!m.selected.has(th.cellIndex));
    for(const tr of $(m.c.body).rows){
      if(tr.classList.contains('h-detail-row')||tr.classList.contains('result-location-row')){tr.cells[0].colSpan=m.headers.length;continue;}
      for(const [i,td]of [...tr.cells].entries()){if(td.colSpan>1){td.colSpan=m.headers.length-i;continue;}td.classList.toggle('result-column-hidden',!m.selected.has(i));td.setAttribute('headers',m.headers[i]?.id||'');}
    }
    // No query, data sort, page change, selection replay or URL write happens here.
  }
  function summary(tab){
    const m=mount(tab),s=state(tab),n=count(tab),key=JSON.stringify([n,s.label]);
    if(m.live.dataset.key!==key){m.live.textContent=tab==='bulk'?`입력주소 ${n.toLocaleString('ko-KR')}건 · 대장 확인 ${B_RESULTS.filter(r=>['ok','warn'].includes(r.status)).length}건`:`조건 일치 ${n.toLocaleString('ko-KR')}${tab==='vacant'?'개 원본 레코드':'건'}`;m.live.dataset.key=key;}
    m.conditions.textContent='조회 조건: '+querySummary(tab);if(m.status.textContent!==s.label)m.status.textContent=s.label;m.status.dataset.state=s.key;m.warning.textContent=s.warning;
    const kind={cond:'condition',housing:'housing',demol:'demol'}[tab],technical=kind&&$('query-status-'+kind);if(technical&&technical.parentElement!==m.summary)m.summary.insertBefore(technical,m.chooser);
    if(technical?.firstChild?.nodeType===3){const text=technical.firstChild,outcome=document.createElement('span');outcome.className='query-outcome';technical.insertBefore(outcome,text);outcome.append(text);}
    if(tab==='bulk')m.warning.append(' 주소 조회 완료는 위반건축물 여부의 판정이 아닙니다.');
    if(tab==='vacant'){const located=V_RESULTS.filter(r=>r.geometry).length,shapes=groupVacantGeometry(V_RESULTS).length;m.warning.textContent+=` · 위치 연결 ${located}개 레코드 / 지도 도형 ${shapes}개 / 위치 미확인 ${n-located}개 레코드. 같은 필지의 원본 기록은 합치지 않습니다.`;}
  }
  function appendActions(tab,tr,r,index){
    if(!r)return;const c=configs[tab];
    if(tab==='cond'){const td=document.createElement('td');td.textContent='대장 수신';td.title='이 행의 대장을 수신했습니다. 요청 범위 전체 상태나 위반 여부와는 다릅니다.';tr.append(td);}
    const td=document.createElement('td');td.className='result-row-actions';td.dataset.mobileCore='true';
    const addr=address(tab,r),dong=tab==='cond'?dongDigits(r.dongNm):null,query=dong?addr+', '+dong+'동':addr;
    const link=detailLink(query,null,tab==='cond'&&r.registryId?'registry:'+r.registryId:null);if(link&&tab!=='demol'&&tab!=='vacant')td.append(link);
    if(tab==='bulk'&&tr.classList.contains('expandable'))td.append(button('동별 항목 펼치기',b=>{const open=tr.classList.toggle('open');for(const sub of $(configs.bulk.body).querySelectorAll('tr.sub-row'))if(sub.dataset.parent===tr.dataset.idx)sub.style.display=open?'table-row':'none';b.setAttribute('aria-expanded',String(open));}));
    if(tab==='housing'&&r.kaptCode)td.append(button('단지 상세 보기',b=>{openHousingDetail(r.kaptCode,r.pnu,tr);b.setAttribute('aria-expanded',String(!!tr.nextElementSibling?.classList.contains('h-detail-row')));}));
    if(tab==='demol')td.append(button('폐쇄말소 상세 보기',b=>{toggleDemolDetail(index,tr);b.setAttribute('aria-expanded',String(tr.classList.contains('m-selected')));}));
    if(tab==='vacant')td.append(button('자료 근거 보기',()=>{const evidence=tr.querySelector('.vacant-provenance');if(evidence){evidence.open=!evidence.open;evidence.querySelector('summary').focus();}}));
    td.append(button('지도에서 보기',b=>locationFor(tab,r,tr,b)));
    const d=tab==='bulk'?r.data:r,raw=document.createElement('details');raw.className='result-evidence result-raw-values';raw.innerHTML='<summary>원본 수치·자료 근거</summary>';
    const values=tab==='housing'?[['연면적(㎡)',d?.tarea],['세대수',d?.hhld],['주차대수',d?.parking],['단지 ID',r.kaptCode],['필지 ID',r.pnu]]:tab==='vacant'?[['연면적(㎡)',d?.tarea],['기준일자 원본',d?.baseDate],['레코드 ID',r.recordId]]:tab==='demol'?[['연면적(㎡)',d?.totArea],['철거·멸실일 원본',d.endDay||d.extngDay||d.strtDay],['필지 ID',pnu(tab,r)]]:[['연면적(㎡)',d?.totArea],['지상층수',d?.grndFlr],['지하층수',d?.ugrndFlr],['건폐율(%)',d?.bcRat],['용적률(%)',d?.vlRat],['사용승인일 원본',d?.useAprDay],['레코드 ID',r.registryId],['필지 ID',pnu(tab,r)]];
    for(const [label,value]of values){const p=document.createElement('p');p.textContent=label+': '+(value==null||String(value).trim()===''?'미확인':String(value));raw.append(p);}td.append(raw);
    tr.append(td);tr.dataset.resultRecord=String(index);
  }
  function formatRow(tab,tr,r){
    const d=tab==='bulk'?r?.data:r;if(!d)return;const cells=tr.cells;
    const rules={bulk:[[7,d.platArea,'area'],[8,d.archArea,'area'],[9,d.totArea,'area'],[10,d.bcRat,'ratio','%'],[11,d.vlRat,'ratio','%'],[12,d.grndFlr,'floor'],[13,d.ugrndFlr,'floor']],cond:[[8,d.totArea,'area'],[9,d.grndFlr,'floor'],[10,d.ugrndFlr,'floor'],[11,d.totPkng,'count']],housing:[[6,d.hhld,'count'],[7,d.dongCnt,'count'],[8,d.ugrndFlr,'floor'],[9,d.grndFlr,'floor'],[11,d.parking,'count'],[12,d.tarea,'area']],demol:[[7,d.totArea,'area']],vacant:[[6,d.tarea,'area']]}[tab];
    if(tab==='bulk'&&!['ok','warn'].includes(r.status))return;
    for(const [i,v,kind,u]of rules||[])if(cells[i]?.colSpan===1){cells[i].textContent=cell(v,kind,u);cells[i].title=`원본: ${v??'미확인'}${u||''}`;}
    if(tab==='bulk')cells[15].innerHTML=useAprCell(d.useAprDay);
    if(tab==='housing'&&!d.doroAddr)cells[4].textContent=d.adres||'미확인';
    if(tab==='cond'&&(!d.newPlatPlc||d.newPlatPlc==='-'))cells[3].textContent=d.platPlc||'미확인';
    if(tab==='vacant')cells[8].childNodes[0].textContent=F.date(d.baseDate);
    for(const td of cells)if(td.colSpan===1&&!td.querySelector('details,button,a'))td.title=td.title||td.textContent.trim();
  }
  function render(tab){
    const m=mount(tab);const rows=[...$(m.c.body).rows].filter(tr=>!tr.classList.contains('h-detail-row')&&!tr.classList.contains('result-location-row')&&!tr.classList.contains('sub-row'));
    let ordinal=0;for(const tr of rows){
      if(tr.cells.length!==m.c.base)continue;
      const index=tab==='bulk'?rows.indexOf(tr):offset(tab)+ordinal++;const r=record(tab,index);formatRow(tab,tr,r);appendActions(tab,tr,r,index);
    }
    if(tab==='bulk'){const positions=new Map();for(const tr of $(m.c.body).querySelectorAll('tr.sub-row')){if(tr.cells.length!==m.c.base)continue;const parent=+tr.dataset.parent,index=positions.get(parent)||0;positions.set(parent,index+1);const original=B_RESULTS[parent],building=original?.buildings?.[index];if(!building)continue;const dong=dongDigits(building.dongNm),r={...original,data:building,buildings:[building],input:original.input+(dong?', '+dong+'동':'')};formatRow(tab,tr,r);tr.cells[14].textContent=cell(building.totPkng,'count');appendActions(tab,tr,r,parent);}}
    for(const th of m.table.querySelectorAll('th'))th.scope='col';
    for(const tr of $(m.c.body).rows)for(const index of m.c.basic)if(tr.cells[index]?.colSpan===1)tr.cells[index].dataset.mobileCore='true';
    for(const tr of $(m.c.body).rows)for(const td of tr.cells)if(td.colSpan===1&&td.textContent.trim()==='-')td.textContent='미확인';
    applyColumns(tab);summary(tab);
    for(const th of m.headers)th.removeAttribute('aria-sort');
    const sort=tab==='housing'?H_SORT:tab==='vacant'?V_SORT:null,index=tab==='housing'?(sort?.startsWith('hhld')?6:sort?.startsWith('useApr')?10:null):tab==='vacant'?(sort?.startsWith('grade')?7:sort?.startsWith('year')?4:null):null;
    if(index!=null)m.headers[index].setAttribute('aria-sort',sort.endsWith('Desc')?'descending':'ascending');
  }
  let staticPromise;
  function geoCatalog(){if(!staticPromise)staticPromise=Promise.all(['apt_geo.json'].map(path=>fetch(path).then(r=>{if(!r.ok)throw new Error('위치 자료를 불러오지 못했습니다');return r.json();}))).then(([apt])=>Array.isArray(apt)?apt:apt.features||[]).catch(e=>{staticPromise=null;throw e;});return staticPromise;}
  function pnu(tab,r){if(r.pnu||r.parcelId)return r.pnu||r.parcelId;const p=r.params;if(p)return toPNU(p);if(tab==='demol'&&r.bjd)return toPNU({sigunguCd:SIGUNGU,bjdongCd:r.bjd,bun:r.bun,ji:r.ji,platGbCd:'0'});return '';}
  async function locationFor(tab,r,tr,trigger){
    const existing=tr.resultLocationRow;if(existing?.isConnected){removeLocation(existing);trigger.focus();return;}
    const row=document.createElement('tr');row.className='result-location-row';tr.resultLocationRow=row;const td=document.createElement('td');td.colSpan=mount(tab).headers.length;row.append(td);tr.after(row);
    const close=button('지도 닫기 · 목록으로',()=>{removeLocation(row);trigger.focus({preventScroll:true});});td.append(close);
    const info=document.createElement('p');info.textContent='해당 항목의 위치 자료를 확인하고 있습니다.';info.setAttribute('role','status');td.append(info);
    try{
      const id=pnu(tab,r),catalog=r.geometry?[r]:await geoCatalog(),matches=r.geometry?(tab==='vacant'&&id?V_RESULTS.filter(x=>x.parcelId===id):[r]):catalog.filter(x=>x.pnu===id||r.kaptCode&&x.kaptCode===r.kaptCode);
      if(!row.isConnected)return;
      const geometries=matches.filter(x=>x.geometry);if(!geometries.length){info.textContent='이 항목에 연결된 도형·좌표가 없습니다. 다른 건물의 위치로 대체하지 않았습니다. 주소 상세의 지도 탭에서는 해당 주소 위치 조회를 시도할 수 있습니다.';const a=detailLink(address(tab,r),'주소 상세에서 위치 확인 · 새 탭');if(a&&tab!=='vacant')td.append(a);return;}
      const g=geometries[0].geometry;info.textContent=(g.type==='Point'?'좌표 위치 · 건물 윤곽이 아닙니다.':'연결된 필지·참고 도형 · 선택 건물의 윤곽으로 확정하지 않습니다.')+` 연결 기록 ${matches.length}개.`;
      if(!r.geometry)info.textContent+=tab==='demol'?' 현재 공동주택 정적 자료의 같은 필지 참고 도형이며 철거 당시 건물 도형이 아닙니다.':' 공동주택 정적 자료의 같은 필지/단지 연결이며 개별 동과의 도형 일치는 미확인입니다.';
      if(matches.length>1){const list=document.createElement('details');list.innerHTML='<summary>연결된 기록 선택</summary>';for(const match of matches){const a=detailLink(match.addr||match.adres||address(tab,r),`${match.complexNm||match.recordId||'원본 기록'} · 주소 상세 새 탭`);if(a)list.append(a);}td.append(list);}
      const canvas=document.createElement('div');canvas.className='result-inline-map';canvas.setAttribute('aria-label','선택 항목의 연결 위치');td.append(canvas);const mobile=matchMedia('(max-width:820px)').matches,map=L.map(canvas,{scrollWheelZoom:false,dragging:!mobile,touchZoom:false});inlineMaps.set(row,map);
      if(mobile){const gesture=button('지도 조작 켜기',b=>{const on=!map.dragging.enabled();on?map.dragging.enable():map.dragging.disable();on?map.touchZoom.enable():map.touchZoom.disable();b.textContent=on?'지도 조작 끄기':'지도 조작 켜기';b.setAttribute('aria-pressed',String(on));});gesture.setAttribute('aria-pressed','false');td.insertBefore(gesture,canvas);}
      const blank='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
      for(const layer of ['Satellite','Hybrid'])L.tileLayer(`/api/vworld-tile?layer=${layer}&z={z}&y={y}&x={x}`,{maxZoom:19,errorTileUrl:blank,attribution:'VWorld'}).addTo(map);
      const layer=L.geoJSON(geometries.map(x=>({type:'Feature',properties:{},geometry:x.geometry}))).addTo(map);map.fitBounds(layer.getBounds().pad(.3),{maxZoom:18});setTimeout(()=>{if(row.isConnected)map.invalidateSize();},0);
      const evidence=document.createElement('details');evidence.className='result-evidence';const summary=document.createElement('summary');summary.textContent='자료 근거';evidence.append(summary);const text=document.createElement('p');text.textContent=`원본 ${r.recordId||r.kaptCode||'ID 미확인'} · 필지 ${id||'미확인'} · ${r.source||'원본 출처는 결과 조회정보 확인'} · 위치 출처 ${r.geometry?'원본 레코드에 연결된 도형':'apt_geo.json, 필지 PNU 또는 단지 코드 일치'} · 수집일 ${r.collectedAt||'미확인'}`;evidence.append(text);td.append(evidence);
    }catch(e){if(row.isConnected)info.textContent='위치 자료를 불러오지 못했습니다. 닫고 다시 시도하세요.';}
  }
  function removeLocation(row){inlineMaps.get(row)?.remove();inlineMaps.delete(row);row.remove();}
  function cleanMaps(){for(const [row,map]of inlineMaps)if(!row.isConnected){map.remove();inlineMaps.delete(row);}}
  function inlineClose(row,trigger,close){
    if(!row||row.querySelector('.result-inline-close'))return;
    row.cells[0].colSpan=mount(row.closest('tbody').id==='hResultBody'?'housing':'demol').headers.length;
    const b=button('상세 닫기 · 결과로',()=>{close();if(trigger?.isConnected)trigger.focus({preventScroll:true});});b.classList.add('result-inline-close');row.cells[0].prepend(b);
  }
  const housingOriginal=openHousingDetail;openHousingDetail=async function(code,pnu,row){const trigger=document.activeElement,promise=housingOriginal(code,pnu,row),detail=row?.nextElementSibling?.classList.contains('h-detail-row')?row.nextElementSibling:null;inlineClose(detail,trigger,closeHousingDetail);await promise;if(detail?.isConnected)inlineClose(detail,trigger,closeHousingDetail);};
  const demolOriginal=toggleDemolDetail;toggleDemolDetail=function(index,row){const trigger=document.activeElement,value=demolOriginal(index,row);inlineClose(row?.nextElementSibling?.classList.contains('h-detail-row')?row.nextElementSibling:null,trigger,closeDemolDetail);return value;};
  function detailHTML(t,html,kind){
    const template=document.createElement('template');template.innerHTML=html;const overview=template.content.querySelector('.card-body');if(!overview)return html;
    const summary=document.createElement('section');summary.className='result-detail-summary';summary.setAttribute('aria-label','선택 건물 요약');
    const b=mergeBuilding(t),title=document.createElement('h3');title.textContent=b.bldNm!=='-'?b.bldNm:b.newPlatPlc!=='-'?b.newPlatPlc:b.platPlc;summary.append(title);
    const data=[['도로명주소',b.newPlatPlc],['지번주소',b.platPlc],['선택 동',t.dongNm||'동명 미확인'],['주·부속 구분',F.designation(t)],['주용도',b.mainPurps],['연면적',cell(b.totArea,'area',' ㎡')],['층수',`지상 ${cell(b.grndFlr,'floor','층')} / 지하 ${cell(b.ugrndFlr,'floor','층')}`],['사용승인',F.date(b.useAprDay)]];
    const dl=document.createElement('dl');for(const [k,v]of data){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v&&v!=='-'?v:'미확인';dl.append(dt,dd);}summary.append(dl);overview.prepend(summary);
    // P1 parcel-scope GIS warnings and matching uncertainty remain outside collapsed sections.
    const warnings=document.createElement('div');warnings.className='d-kv result-visible-supplements';summary.after(warnings);
    for(const slot of overview.querySelectorAll('.supplement-slot'))warnings.append(slot);
    const details=document.createElement('details');details.className='result-detail-more';details.innerHTML='<summary>세부정보 · 면적·주차·구조 등</summary>';warnings.after(details);
    for(const part of [...overview.children])if(part.matches('.d-addr,.d-sec-title,.d-kv:not(.result-visible-supplements)'))details.append(part);
    const closed=kind==='폐쇄말소',parcel=closed&&MRESULTS[M_DET_IDX]?pnu('demol',MRESULTS[M_DET_IDX]):!closed&&D_CAND?toPNU(D_CAND):'미확인';
    const evidence=document.createElement('details');evidence.className='result-evidence';const heading=document.createElement('summary');heading.textContent='자료 근거 · 선택 동과 필지';evidence.append(heading);const p=document.createElement('p');p.textContent=`${closed?'폐쇄말소대장':'건축물대장 표제부'} · 레코드 ID ${t.mgmBldrgstPk||'미확인'} · 필지 ${parcel} · 수집일 ${t.collectedAt||'미확인 (실시간 응답)'} · 동 선택은 대장 표제부 기준. ${closed?'철거·멸실 기록과의 개별 동 연결을 확정하지 않습니다.':'GIS 높이·위반정보는 필지 대표 자료이며 선택 동과의 직접 연결은 확인되지 않았습니다.'}`;evidence.append(p);details.after(evidence);
    return template.innerHTML;
  }
  function mapCard(source,data){
    const card=$('mapCard');if(!card)return;
    const footer=document.createElement('div');footer.className='result-map-actions';
    const records=source==='vacant'?(data.members||[data]):source==='apt'&&data.pnu?M_RESULTS.apt.filter(r=>r.pnu===data.pnu):[data];
    if(source!=='vacant')for(const r of records){const a=detailLink(r.addr||r.adres||r.doroAddr||r.newPlatPlc||r.platPlc,records.length>1?`${r.complexNm||r.kaptCode||'연결 기록'} · 건물 상세 새 탭`:'건물 상세 보기 · 새 탭');if(a)footer.append(a);}
    if(records.length>1){const note=document.createElement('p');note.textContent=`연결된 원본 기록 ${records.length}개 · 하나의 건물로 확정하지 않습니다.`;footer.prepend(note);}
    if(source==='vacant')for(const r of records){const b=button(`목록에서 보기 · ${r.recordId||'ID 미확인'}`,()=>{const row=[...$('mapResultsList').children].find(el=>el.dataset.id===r.recordId);if(row){closeMapCard();row.focus({preventScroll:true});row.scrollIntoView({block:'nearest'});}else{const p=document.createElement('p');p.textContent='현재 지도 목록 표시 범위에서 이 원본 레코드를 찾지 못했습니다.';footer.append(p);}});footer.append(b);}
    card.append(footer);
    if(source!=='vacant'){const fields=card.querySelectorAll('tr');for(const tr of fields){const th=tr.querySelector('th'),td=tr.querySelector('td');if(!th||!td)continue;if(th.textContent.includes('연면적'))td.textContent=cell(data.tarea??data.totArea,'area',' ㎡');}}
  }
  const vacantCardOriginal=renderVacantCard;renderVacantCard=function(d){
    const html=vacantCardOriginal(d);if(d.members)return html;const template=document.createElement('template');template.innerHTML=html;const table=template.content.querySelector('table');if(!table)return html;
    const evidence=document.createElement('details');evidence.className='result-evidence';evidence.innerHTML='<summary>자료 근거 · 원본 기록</summary>';const evidenceTable=document.createElement('table');evidenceTable.className='mc-tbl';evidence.append(evidenceTable);
    for(const tr of [...table.rows]){const label=tr.querySelector('th')?.textContent,td=tr.querySelector('td');if(label==='연면적')td.textContent=cell(d.tarea,'area',' ㎡');if(label==='기준일자')td.textContent=F.date(d.baseDate);if(['수집일','출처','주소 기준','레코드 ID','필지 ID'].includes(label))evidenceTable.append(tr);}
    table.after(evidence);return template.innerHTML;
  };
  const cardOriginal=cardHTML;cardHTML=function(t,...args){return detailHTML(t,cardOriginal(t,...args),args[0]);};
  const housingHTMLOriginal=housingDetailHTML;housingDetailHTML=function(b,d,h){
    const template=document.createElement('template');template.innerHTML=housingHTMLOriginal(b,d,h);const body=template.content.querySelector('.card-body');if(!body)return template.innerHTML;
    const core=document.createElement('section');core.className='result-detail-summary';const title=document.createElement('h3');title.textContent=b?.kaptName||h?.mgm?.cmplxNm||'단지명 미확인';core.append(title);
    const dl=document.createElement('dl');for(const [k,v]of [['도로명주소',b?.doroJuso],['지번주소',b?.kaptAddr],['주택 종류',b?.codeAptNm],['세대수',cell(b?.hoCnt??b?.kaptdaCnt??h?.mgm?.hhldCnt,'count','세대')],['연면적',cell(b?.kaptTarea??h?.mgm?.totArea,'area',' ㎡')],['사용승인',F.date(b?.kaptUsedate)]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v||'미확인';dl.append(dt,dd);}core.append(dl);body.prepend(core);
    const more=document.createElement('details');more.className='result-detail-more';more.innerHTML='<summary>세부정보 · 관리·주차·설비</summary>';core.after(more);for(const child of [...body.children])if(child!==core&&child!==more&&!child.matches('.d-empty,.d-panel-hint'))more.append(child);
    const evidence=document.createElement('details');evidence.className='result-evidence';evidence.innerHTML='<summary>자료 근거</summary>';const text=document.createElement('p');text.textContent=`K-apt 기본·상세정보 / 주택인허가 보강 · 단지 ID ${b?.kaptCode||d?.kaptCode||'응답 ID 미확인'} · 수집일 미확인 (실시간 응답) · 보강은 필지·단지 기준이며 개별 동을 확정하지 않습니다. 주차는 기존 항목 합산·보강 기준입니다.`;evidence.append(text);more.after(evidence);return template.innerHTML;
  };
  for(const [name,tab]of Object.entries({renderResults:'bulk',renderCondPage:'cond',renderHousingPage:'housing',renderDemolPage:'demol',renderVacantPage:'vacant'})){
    const original=window[name];window[name]=function(...args){const value=original(...args);render(tab);cleanMaps();return value;};
  }
  const showOriginal=showQueryStatus;showQueryStatus=function(session){const value=showOriginal(session);const tab={condition:'cond',housing:'housing',demol:'demol'}[session.kind];if(tab)summary(tab);return value;};
  const cancelOriginal=cancelSearch;cancelSearch=function(kind){const value=cancelOriginal(kind);if(kind==='bulk'){mount('bulk').cancelled=true;summary('bulk');}else{const tab={condition:'cond',housing:'housing',demol:'demol',vacant:'vacant'}[kind];if(tab)summary(tab);}return value;};
  const lookupOriginal=runLookup;runLookup=async function(...args){mount('bulk').cancelled=false;try{return await lookupOriginal(...args);}finally{summary('bulk');}};
  for(const [name,tab]of Object.entries({runConditionSearch:'cond',runHousingSearch:'housing',runDemolSearch:'demol',runVacantSearch:'vacant'})){const original=window[name];window[name]=async function(...args){try{return await original(...args);}finally{summary(tab);}};}
  const mapOriginal=showMapDetailCard;showMapDetailCard=function(source,data){const value=mapOriginal(source,data);mapCard(source,data);return value;};
  const renderOriginal=renderDetail;renderDetail=function(...args){const value=renderOriginal(...args);const root=$('dResult');if(!root.querySelector('.result-return-search')){const b=button('검색으로 돌아가기',()=>{$('dInput').focus();$('dInput').scrollIntoView({block:'center'});});b.classList.add('result-return-search');root.append(b);}return value;};
  for(const tab of Object.keys(configs))mount(tab);
  window.ResultUI={render,summary,locationFor,detailLink,state,models};
})();
