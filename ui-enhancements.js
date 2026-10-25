// Small progressive enhancements; desktop tables and existing event handlers remain authoritative.
const UI_QUERY_ACTIVITY=new Map();
let UI_QUERY_TICKET=0;
function resetQueryActivity(){UI_QUERY_ACTIVITY.clear();syncQueryActivity();}
function syncQueryActivity(){
  for(const kind of ['bulk','detail','condition','housing','demol','vacant','map']){
    const button=document.getElementById('cancel-'+kind);if(!button)continue;
    const supplement=kind==='detail'&&document.getElementById('dResult').style.display==='block'&&(D_BLDGIS?.state==='loading'||D_LDA?.state==='loading');
    button.hidden=!(UI_QUERY_ACTIVITY.has(kind)||supplement);
    button.textContent=supplement?'보강정보 조회 취소':'조회 취소';
  }
}
function syncScreenPresentation(){
  const menu=['building','housing','demol','vacant','stats','map'].find(t=>document.getElementById('tab-btn-'+t)?.classList.contains('active'))||'building';
  const tab=menu==='building'?B_SUBTAB:menu==='map'?MAP_SUBTAB:menu;
  for(const button of document.querySelectorAll('.tab'))button.setAttribute('aria-current',button.id==='tab-btn-'+menu?'page':'false');
  for(const button of document.querySelectorAll('[data-sub],[data-map-sub]')){
    const on=button.hasAttribute('data-sub')?button.dataset.sub===B_SUBTAB:button.dataset.mapSub===MAP_SUBTAB;
    button.classList.toggle('active',on);button.setAttribute('aria-current',on?'page':'false');button.setAttribute('aria-pressed',String(on));
  }
  const panel=document.getElementById(menu==='building'?'building-sub-'+tab:menu==='map'?'map-sub-'+tab:'tab-'+menu);
  const [title,description]=UiLabels.screens[tab];
  let heading=document.getElementById('screenHeading');
  if(!heading){heading=document.createElement('div');heading.id='screenHeading';heading.className='screen-heading';heading.innerHTML='<h2 id="screenTitle"></h2><p id="screenDescription"></p>';}
  panel.prepend(heading);document.getElementById('screenTitle').textContent=title;document.getElementById('screenDescription').textContent=description;document.title=title+' · 동구 건축물 정보';
  const tools=document.querySelector('.share-tools');
  if(tools){
    const runId={bulk:'runBtn',detail:'dRunBtn',cond:'cRunBtn',housing:'hRunBtn',demol:'mRunBtn',vacant:'vRunBtn',general:'mapRunBtn'}[tab];
    const run=runId&&document.getElementById(runId),card=run?.closest('.card');
    const mapLayout=menu==='map'?panel.querySelector(tab==='general'?'.map-layout':'.fg-layout'):null;
    if(mapLayout)mapLayout.after(tools);else if(card)card.after(tools);else if(run)run.parentElement.after(tools);else heading.after(tools);
    document.getElementById('conditionTools').hidden=tab==='stats';
  }
  syncQueryActivity();
}
function setMapPanelOpen(open){
  const layout=document.querySelector('.map-layout'),button=document.getElementById('mapPanelToggle');
  if(!layout || !button)return;
  layout.classList.toggle('conditions-collapsed',!open);
  button.setAttribute('aria-expanded',String(open));button.textContent=open?'검색 조건 접기':'검색 조건 펼치기';
  requestAnimationFrame(()=>{if(typeof M_MAP!=='undefined' && M_MAP)M_MAP.invalidateSize();});
}
let MOBILE_MAP_INTERACTIVE=false;
function syncMobileMapInteraction(){
  if(typeof M_MAP==='undefined' || !M_MAP)return;
  const mobile=matchMedia('(max-width:820px)').matches,enabled=!mobile || MOBILE_MAP_INTERACTIVE;
  for(const handler of [M_MAP.dragging,M_MAP.touchZoom])if(handler)enabled?handler.enable():handler.disable();
  if(mobile)M_MAP.scrollWheelZoom?.disable();
  document.getElementById('mapView').classList.toggle('map-interactive',enabled);
  const button=document.getElementById('mapGestureToggle');
  if(button){button.textContent=enabled?'지도 조작 끄기 (페이지 스크롤)':'지도 조작 켜기';button.setAttribute('aria-pressed',String(enabled));}
}
function enhanceResults(tbody){
  const headers=[...tbody.closest('table').querySelectorAll('thead th')].map(el=>el.textContent.trim());
  for(const row of tbody.children){
    if(row.dataset.mobileReady || row.children.length!==headers.length || row.classList.contains('h-detail-row'))continue;
    row.dataset.mobileReady='true';
    [...row.children].forEach((cell,i)=>{
      cell.dataset.label=headers[i];
      if(i===0 || /주소|건물명|건물|단지명|공동주택명|주용도|연면적|등급|상태|기준일|층수|사용승인|세대수/.test(headers[i]))cell.dataset.mobileCore='true';
    });
    const toggle=document.createElement('button');toggle.className='mobile-row-toggle';toggle.type='button';toggle.textContent='기타 항목 펼치기';toggle.setAttribute('aria-expanded','false');
    toggle.onclick=event=>{event.stopPropagation();const open=row.classList.toggle('mobile-expanded');toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'기타 항목 접기':'기타 항목 펼치기';};
    row.firstElementChild.append(toggle);
  }
}
function initUsability(){
  document.querySelector('.tabs').setAttribute('aria-label','서비스 메뉴');
  for(const tab of document.querySelectorAll('.tab')){
    tab.addEventListener('click',()=>{
      if(matchMedia('(max-width:820px)').matches)tab.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    });
  }
  for(const [id,kind] of [['runBtn','bulk'],['dRunBtn','detail'],['cRunBtn','condition'],['mRunBtn','demol'],['hRunBtn','housing'],['vRunBtn','vacant'],['mapRunBtn','map']]){
    const run=document.getElementById(id);if(!run)continue;
    const cancel=document.createElement('button');cancel.type='button';cancel.className='ghost cancel-query';cancel.id=`cancel-${kind}`;cancel.textContent='조회 취소';cancel.hidden=true;cancel.onclick=()=>cancelSearch(kind);run.after(cancel);
  }
  for(const [name,kind]of Object.entries({runLookup:'bulk',runDetail:'detail',runConditionSearch:'condition',runHousingSearch:'housing',runDemolSearch:'demol',runVacantSearch:'vacant',runMapSearch:'map'})){
    const original=window[name];window[name]=async function(...args){const ticket=++UI_QUERY_TICKET;UI_QUERY_ACTIVITY.set(kind,ticket);syncQueryActivity();try{return await original(...args);}finally{if(UI_QUERY_ACTIVITY.get(kind)===ticket)UI_QUERY_ACTIVITY.delete(kind);syncQueryActivity();}};
  }
  const cancelOriginal=cancelSearch;cancelSearch=function(kind){UI_QUERY_ACTIVITY.delete(kind);try{return cancelOriginal(kind);}finally{syncQueryActivity();}};
  for(const id of ['dResult','dStatus'])new MutationObserver(syncQueryActivity).observe(document.getElementById(id),{subtree:true,childList:true});
  for(const id of ['resultBody','cResultBody','hResultBody','mResultBody','vResultBody']){
    const body=document.getElementById(id);if(!body)continue;
    enhanceResults(body);new MutationObserver(()=>enhanceResults(body)).observe(body,{childList:true});
  }
  for(const id of ['dStatus','cHint','hHint','mHint','vHint','mapHint','progText','cProgText','hProgText','mProgText','mapVacantDate']){
    const el=document.getElementById(id);if(el){el.setAttribute('role','status');el.setAttribute('aria-live','polite');}
  }
  for(const input of document.querySelectorAll('input:not([aria-label]),select:not([aria-label]),textarea:not([aria-label])')){
    const label=input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
    if(!label){const text=input.closest('.field')?.querySelector('label')?.textContent.trim();if(text)input.setAttribute('aria-label',text);}
  }
  const layout=document.querySelector('.map-layout');
  if(layout){
    const tools=document.createElement('div');tools.className='mobile-map-tools';
    tools.innerHTML='<button id="mapPanelToggle" aria-controls="mapSide" aria-expanded="true">검색 조건 접기</button><button id="mapGestureToggle" aria-pressed="false">지도 조작 켜기</button><small>지도 조작을 끄면 페이지를 스크롤할 수 있습니다.</small>';
    layout.before(tools);
    document.getElementById('mapPanelToggle').onclick=()=>setMapPanelOpen(layout.classList.contains('conditions-collapsed'));
    document.getElementById('mapGestureToggle').onclick=()=>{MOBILE_MAP_INTERACTIVE=!MOBILE_MAP_INTERACTIVE;syncMobileMapInteraction();};
    window.addEventListener('resize',()=>{syncMobileMapInteraction();if(typeof M_MAP!=='undefined')M_MAP?.invalidateSize();if(typeof FG_MAP!=='undefined')FG_MAP?.invalidateSize();});
  }
  syncScreenPresentation();
}
initUsability();
