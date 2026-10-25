// Small progressive enhancements; desktop tables and existing event handlers remain authoritative.
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
      for(const other of document.querySelectorAll('.tab'))other.setAttribute('aria-current',other.classList.contains('active')?'page':'false');
      if(matchMedia('(max-width:820px)').matches)tab.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    });
  }
  for(const [id,kind] of [['runBtn','bulk'],['dRunBtn','detail'],['cRunBtn','condition'],['mRunBtn','demol'],['hRunBtn','housing'],['vRunBtn','vacant'],['mapRunBtn','map']]){
    const run=document.getElementById(id);if(!run)continue;
    const cancel=document.createElement('button');cancel.type='button';cancel.className='ghost cancel-query';cancel.id=`cancel-${kind}`;cancel.textContent='조회 취소';cancel.onclick=()=>cancelSearch(kind);run.after(cancel);
  }
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
}
initUsability();
