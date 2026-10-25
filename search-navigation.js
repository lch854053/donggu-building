/* Small adapter around the existing SPA. State contains conditions, never API responses. */
(function(){
  'use strict';
  const S=SearchState,$=id=>document.getElementById(id);
  if('scrollRestoration' in history)history.scrollRestoration='manual';
  let epoch=0,depth=0,restoring=0,running=0,replaying=0,pickRevision=0,selected=null,pending=null,entryRan=false;
  const raw={},recentKey='donggu.recent.v1';
  const host=document.createElement('section');host.className='share-tools';host.setAttribute('aria-label','검색 조건 공유 및 최근 검색');
  host.innerHTML=`<div class="share-actions"><button id="shareCopy" title="현재 편집 중인 조건 링크 복사">공유</button><details id="conditionTools"><summary>검색 조건 저장·불러오기</summary><div class="condition-actions"><button id="conditionExport">조건 파일 저장</button><button id="conditionImportButton">조건 파일 불러오기</button><input id="conditionImport" type="file" accept=".json,application/json" hidden><small>현재 편집 중인 조건을 JSON 파일로 저장합니다. 결과 엑셀은 실제 조회 조건을 기록합니다. 입력 주소가 포함되므로 저장·전달 대상을 확인하세요.</small></div></details><details id="recentSearches"><summary>최근 검색</summary><p>이 브라우저에 최대 10개 · 열면 조건만 복원합니다. 여러 주소 입력은 자동 저장하지 않습니다.</p><div id="recentRows"></div><button id="recentClear">최근 검색 전체 삭제</button></details></div><small id="sharePrivacy" hidden>현재 편집 중인 조건을 공유합니다. 링크에는 입력 주소가 포함되며 자료 갱신에 따라 결과는 달라질 수 있습니다.</small><div id="shareStatus" role="status" aria-live="polite"></div><input id="shareFallback" aria-label="공유 링크 — 선택 후 수동 복사" readonly hidden>`;
  document.querySelector('main')?.prepend(host);
  if(!host.isConnected)document.querySelector('.tabs')?.after(host);
  if(!host.isConnected)document.body.insertBefore(host,document.body.firstChild);
  let messageTimer,messageRevision=0;
  function say(message,{temporary=false}={}){clearTimeout(messageTimer);const revision=++messageRevision;$('shareStatus').textContent=message;if(temporary)messageTimer=setTimeout(()=>{if(revision===messageRevision){$('shareStatus').textContent='';$('sharePrivacy').hidden=true;}},4000);}
  function clearToolFeedback(){say('');$('shareFallback').hidden=true;$('shareFallback').value='';$('sharePrivacy').hidden=true;for(const id of ['conditionTools','recentSearches'])$(id).open=false;}
  $('conditionImportButton').onclick=()=>$('conditionImport').click();
  for(const id of ['conditionTools','recentSearches']){const node=$(id),summary=node.querySelector('summary');summary.setAttribute('aria-expanded','false');node.addEventListener('toggle',()=>summary.setAttribute('aria-expanded',String(node.open)));}
  syncScreenPresentation();
  function invoke(name,...args){depth++;try{return (raw[name]||window[name])(...args);}finally{depth--;}}
  function active(){const menu=['building','housing','demol','vacant','stats','map'].find(t=>$('tab-btn-'+t)?.classList.contains('active'))||'building';return {menu,tab:menu==='building'?B_SUBTAB:menu==='map'?MAP_SUBTAB:menu};}
  function defaultValue(id){const el=$(id);if(!el)return null;if(S.ranges[id])return [+el.dataset.min,+el.dataset.max];if(el.matches('textarea,input[type=text]'))return el.defaultValue||'';if(el.type==='checkbox')return el.defaultChecked;if(el.tagName==='SELECT')return '__ALL__';return [...el.querySelectorAll('input')].filter(c=>c.defaultChecked).map(c=>c.value).sort();}
  function value(id){const el=$(id);if(!el)return null;if(el.filterControl)return el.filterControl.values?.()||el.filterControl.selected().sort();if(S.ranges[id])return $(id+'-min')&&$(id+'-max')?[+$(id+'-min').value,+$(id+'-max').value]:null;if(el.matches('textarea,input[type=text],select'))return el.value;if(el.type==='checkbox')return el.checked;return [...el.querySelectorAll('input:checked')].map(c=>c.value).sort();}
  function capture(){
    const {menu,tab}=active(),s={v:1,menu,tab:menu==='building'||menu==='map'?tab:undefined},f={};
    if(s.tab===undefined)delete s.tab;
    for(const id of S.fields[tab]){const v=value(id);if(v!==null&&JSON.stringify(v)!==JSON.stringify(defaultValue(id)))f[id]=v;}
    if(Object.keys(f).length)s.f=f;
    if(selected||pending?.pick)s.pick=selected||pending.pick;
    const sort=tab==='housing'?$('hSort').value:tab==='vacant'?$('vSort').value:null;if(sort&&sort!=='default')s.sort=sort;
    const page=tab==='housing'?H_PAGE:tab==='vacant'?V_PAGE:tab==='cond'?C_PAGE:tab==='demol'?M_PAGE:1;if(page>1)s.page=page;
    if(menu==='map'){
      const map=tab==='general'?M_MAP:FG_MAP;if(map){const p=map.getCenter();s.view=[p.lat,p.lng,map.getZoom()];}
      if(tab==='figure'){s.theme=FG_COLOR_MODE;s.shape=document.querySelector('.fg-disc.is-square')?'square':'circle';}
    }
    return S.validate(s,{file:true});
  }
  function checkpoint(mode='push',ran=entryRan){
    if(depth||restoring)return;
    try{
      const state=capture(),url=S.encode(state,location.href),previous=history.state;
      if(mode==='push')history.replaceState({...previous,scroll:[scrollX,scrollY]},'');
      const data={p3:1,conditions:state,ran,scroll:[scrollX,scrollY]};
      if(typeof FilterUI!=='undefined'){const resultConditions=FilterUI.historyState(active().tab);if(resultConditions)data.resultConditions=resultConditions;}
      if(mode==='push'&&(location.href!==url||!!previous?.ran!==!!ran))history.pushState(data,'',url);else history.replaceState(data,'',url);
    }catch(e){say(e.message+' 현재 조건은 화면에 유지됩니다.');}
  }
  function stop(hide=true){
    ++epoch;restoring=0;running=0;replaying=0;
    clearToolFeedback();resetQueryActivity();
    B_GATE.invalidate();D_GATE.invalidate();D_TAB_GATE.invalidate();V_GATE.invalidate();MAP_RUN_GATE.invalidate();++M_COND_SEARCH_ID;M_DET_GATE.invalidate();M_DET_TAB_GATE.invalidate();
    for(const kind of ['condition','housing','demol','map'])invalidateQuery(kind);
    if(!hide){if(D_BLDGIS?.state==='loading')D_BLDGIS={state:'cancelled'};if(D_LDA?.state==='loading')D_LDA={state:'cancelled'};refreshDetailSupplements();if(H_PROGRESS_STATE.includes('보강 중'))H_PROGRESS_STATE='취소됨 · 잠정 결과';}
    for(const id of ['runBtn','dRunBtn','cRunBtn','hRunBtn','mRunBtn','mapRunBtn'])if($(id))$(id).disabled=false;
    if(hide)for(const id of ['resultArea','dResult','cResultArea','hResultArea','mResultArea','vResultArea','mapResultsWrap','mapCard'])if($(id))$(id).style.display='none';
    for(const id of ['progWrap','cProgWrap','hProgWrap','mProgWrap'])$(id)?.classList.remove('on');
    if(typeof FilterUI!=='undefined'){for(const kind of ['condition','housing','demol','vacant','map'])FilterUI.cancel(kind);FilterUI.suspend();}
  }
  async function ready(menu,tab){
    if(menu==='building'&&tab==='cond'||menu==='demol')await loadHaengjeong();
    if(menu==='housing')await loadHousing();
    if(menu==='demol')initDemolFilters();
    if(menu==='vacant')await initVacantTab();
    if(menu==='map'){if(tab==='general')await initMapTab();else await initFigureGroundMap();}
  }
  function setFields(s,tab){
    const warnings=[];
    for(const id of S.fields[tab]){
      const el=$(id);if(!el){warnings.push(id);continue;}const v=Object.hasOwn(s.f||{},id)?s.f[id]:defaultValue(id);
      if(S.ranges[id]){if(!$(id+'-min')||v[0]<+el.dataset.min||v[1]>+el.dataset.max){warnings.push(id);continue;}if(el.filterControl)el.filterControl.set(v,{notify:false});else{$(id+'-min').value=v[0];$(id+'-max').value=v[1];$(id+'-min').dispatchEvent(new Event('change',{bubbles:true}));}}
      else if(el.type==='checkbox')el.checked=v;
      else if(el.matches('textarea,input[type=text]'))el.value=v;
      else if(el.tagName==='SELECT'){if([...el.options].some(o=>o.value===v))el.value=v;else warnings.push(id);}
      else {if(el.filterControl)el.filterControl.set(v,{notify:false});else for(const c of el.querySelectorAll('input')){c.checked=v.includes(c.value);c.dispatchEvent(new Event('change',{bubbles:true}));}if(v.some(x=>![...el.querySelectorAll('input')].some(c=>c.value===x)))warnings.push(id);}
    }
    if(typeof FilterUI!=='undefined')FilterUI.refresh(tab);
    return warnings;
  }
  function itemId(kind,r){
    if(kind==='detail')return r?.mgmBldrgstPk?`registry:${r.mgmBldrgstPk}`:`dong:${String(r?.dongNm||'').trim()}|${String(r?.bldNm||'').trim()}`;
    if(kind==='housing')return r?.kaptCode?`kapt:${r.kaptCode}`:r?.pnu?`pnu:${r.pnu}`:null;
    if(kind==='demol')return r?.recordId||`demol:${[r?.bjd,r?.bun,r?.ji,r?.demolGb,r?.extngDay,r?.strtDay,r?.endDay].join('|')}`;
    return kind==='vacant'?r?.selectedRecordId||r?.recordId||r?.records?.[0]?.recordId:r?.kaptCode?`kapt:${r.kaptCode}`:r?.pnu?`pnu:${r.pnu}`:null;
  }
  function partial(tab){const kind={cond:'condition',housing:'housing',demol:'demol',general:'map'}[tab];return !!QUERY_SESSIONS.get(kind)?.ledger.failed().length||(tab==='housing'&&H_PROGRESS_STATE!=='전체 조회 완료');}
  async function restorePick(s,token){
    if(token!==epoch)return;
    const {menu,tab}=active();const p=s.pick;if(!p){selected=null;return;}
    let found=false,ambiguous=false;
    if(tab==='detail'){
      if(p.id){const matches=(D_DONGS.length?D_DONGS:D_TITLES).map((r,i)=>({r,i})).filter(x=>itemId('detail',x.r)===p.id);ambiguous=matches.length>1;if(matches.length===1){if(D_DONGS.length)invoke('selectDong',matches[0].i);found=true;}}
      else found=!!D_TITLES.length;
      if(found&&p.panel){if(['flr','park','wclf','jiji','hist','tmphdcr','lda','map'].includes(p.panel)){document.querySelectorAll('#dResult .d-subtab').forEach(b=>{b.classList.toggle('active',b.dataset.tab===p.panel);b.setAttribute('aria-pressed',String(b.dataset.tab===p.panel));});await invoke('loadSubtab',p.panel,D_SELDONG);}else found=false;}
    }else if(menu==='housing'){
      const matches=HRESULTS.filter(r=>itemId('housing',r)===p.id);ambiguous=matches.length>1;
      if(matches.length===1){const r=matches[0];invoke('gotoHousingPage',Math.floor(HRESULTS.indexOf(r)/H_PAGE_SIZE)+1);const a=[...$('hResultBody').querySelectorAll('[data-dtl]')].find(a=>a.dataset.pnu===r.pnu&&a.dataset.dtl===r.kaptCode);if(a){await invoke('openHousingDetail',a.dataset.dtl,a.dataset.pnu,a.closest('tr'));found=true;}}
    }else if(menu==='demol'){
      const matches=MRESULTS.map((r,i)=>({r,i})).filter(x=>itemId('demol',x.r)===p.id);ambiguous=matches.length>1;if(matches.length===1){const {i}=matches[0];invoke('gotoDemolPage',Math.floor(i/M_PAGE_SIZE)+1);const tr=$('mResultBody').querySelector(`[data-idx="${i}"]`);if(tr){await invoke('toggleDemolDetail',i,tr);found=true;}}
    }else if(menu==='map'&&tab==='general'&&['vacant','apt','cond'].includes(p.source)){
      const matches=M_RESULTS[p.source].filter(r=>itemId(p.source,r)===p.id);ambiguous=matches.length>1;if(matches.length===1){invoke('focusMapResult',p.source,matches[0]);found=true;}
    }
    if(token!==epoch)return;
    if(found){selected=p;say('조건·선택 항목을 복원했습니다. 결과는 데이터 갱신에 따라 달라질 수 있습니다.');}
    else say(ambiguous?'같은 식별자의 후보가 여러 개여서 선택하지 않았습니다.':partial(tab)?'부분·미완료 조회에서 선택 항목을 찾지 못했습니다. 삭제된 것으로 판단할 수 없습니다.':'현재 결과에서 선택 항목을 찾지 못했습니다. 데이터 변경·필터·식별자를 확인하세요. 삭제 여부는 확정하지 않습니다.');
  }
  async function afterSearch(s,token,keepUserSelection=false){
    if(token!==epoch||keepUserSelection)return;
    const {tab}=active();
    if(tab==='housing'){$('hSort').value=s.sort||'default';invoke('applyHousingSort');if(s.page)invoke('gotoHousingPage',s.page);}
    if(tab==='vacant'){$('vSort').value=s.sort||'default';invoke('applyVacantSort');V_PAGE=Math.min(s.page||1,Math.max(1,Math.ceil(V_RESULTS.length/V_PAGE_SIZE)));renderVacantPage();}
    if(tab==='cond'&&s.page)invoke('gotoCondPage',s.page);
    if(tab==='demol'&&s.page)invoke('gotoDemolPage',s.page);
    await restorePick(s,token);
    if(token!==epoch)return;
    if(s.view){const map=tab==='general'?M_MAP:FG_MAP;map?.stop().setView(s.view.slice(0,2),s.view[2],{animate:false});}
  }
  async function restore(state,{reason='url',ran=false,scroll=null,resultConditions=null}={}){
    let s;try{s=S.validate(state,{file:reason==='file'});}catch(e){say(e.message);return;}
    stop();const token=epoch;restoring=token;selected=null;pending=s;entryRan=false;
    const menu=s.menu||'building',tab=s.tab||(menu==='building'?'bulk':menu==='map'?'general':menu);
    try{
      invoke('switchTab',menu);if(menu==='building')invoke('switchBuildingSubtab',tab);if(menu==='map')invoke('switchMapSubtab',tab);
      await ready(menu,tab);if(token!==epoch)return;
      const warnings=setFields(s,tab);
      if(menu==='map'&&tab==='figure'){invoke('setFigureGroundColorMode',s.theme||'plain');invoke('setFigureGroundShape',s.shape||'circle');}
      if(s.view){const map=tab==='general'?M_MAP:FG_MAP;map?.stop().setView(s.view.slice(0,2),s.view[2],{animate:false});}
      if(warnings.length){say('일부 조건을 복원하지 못했습니다: '+warnings.join(', ')+'. 값을 확인한 뒤 조회하세요.');return;}
      // Only single-address detail auto-runs from an explicit link. History replays local-dong intent, not bulk/all-district scans.
      const local=!(Object.values(s.f||{}).includes('__ALL__')) && Object.keys(s.f||{}).some(k=>k.endsWith('hdong'));
      const auto=reason!=='recent'&&(tab==='detail'&&!!s.f?.dInput||reason==='history'&&ran&&(tab==='vacant'||tab==='general'&&!s.f?.mapSourceGrid?.includes('cond')||local&&['cond','housing','demol'].includes(tab)));
      const name={detail:'runDetail',cond:'runConditionSearch',housing:'runHousingSearch',demol:'runDemolSearch',vacant:'runVacantSearch',general:'runMapSearch'}[tab];
      if(reason==='history'&&!ran&&resultConditions&&typeof FilterUI!=='undefined'&&FilterModel.configs[tab]){
        try{
          const previous=S.validate(resultConditions),previousMenu=previous.menu||'building',previousTab=previous.tab||(previousMenu==='map'?'general':previousMenu==='building'?'bulk':previousMenu);
          if(previousTab===tab){
            const pf=previous.f||{},safe=tab==='vacant'||tab==='general'&&!(pf.mapSourceGrid||[]).includes('cond')||Object.entries(pf).some(([k,v])=>k.endsWith('hdong')&&v!=='__ALL__');
            if(safe&&name){const failed=setFields(previous,tab);if(!failed.length){await invoke(name);if(token!==epoch)return;await afterSearch(previous,token);if(token!==epoch)return;setFields(s,tab);pending=null;entryRan=false;say('편집 중인 조건과 이전 조회 조건을 구분해 복원했습니다. 결과는 현재 자료로 다시 조회했습니다.');return;}}
            FilterUI.reference(tab,previous);
          }
        }catch{/* Invalid optional history metadata must not prevent restoring the explicit URL. */}
      }
      if(auto&&name){await invoke(name);if(token!==epoch)return;entryRan=true;await afterSearch(s,token);pending=null;}
      else say(menu==='stats'?'통계 화면을 복원했습니다.':'조건을 복원했습니다. 조회 버튼을 누르면 검색하며, 선택 항목·정렬·페이지는 데이터 로딩 뒤 적용합니다.');
      if(token!==epoch)return;
      if(scroll)requestAnimationFrame(()=>{if(token===epoch)window.scrollTo(...scroll);});
    }catch{if(token===epoch)say('검색 상태 복원을 완료하지 못했습니다. 조건을 확인한 뒤 다시 조회하세요.');}
    finally{if(token===epoch){restoring=0;checkpoint('replace',entryRan);}}
  }
  function storage(){try{return localStorage;}catch{return null;}}
  function recent(){return S.readRecent(storage());}
  async function openState(s,reason){checkpoint('replace');try{history.pushState({p3:1,ran:false},'',S.encode(s,location.href));}catch{/* Long JSON conditions intentionally remain in memory, not history. */}const job=restore(s,{reason}),owner=epoch;await job;if(owner===epoch){const {tab}=active(),id={detail:'dInput',bulk:'input',cond:'c-hdong',housing:'h-hdong',demol:'m-hdong',vacant:'v-hdong',general:'map-hdong'}[tab];(id?$(id):$('shareCopy'))?.focus({preventScroll:true});}}
  function renderRecent(){const rows=recent(),body=$('recentRows');body.replaceChildren();rows.forEach((r,i)=>{const div=document.createElement('div'),open=document.createElement('button'),del=document.createElement('button'),label=UiLabels.recent(r.state);open.className='recent-open';open.textContent=label+' · '+r.at.slice(0,10);open.title=open.textContent;open.setAttribute('aria-label',open.textContent);open.onclick=()=>openState(r.state,'recent');del.textContent='삭제';del.setAttribute('aria-label',`${i+1}번 최근 검색 삭제`);del.onclick=()=>{rows.splice(i,1);if(!S.saveRecent(storage(),rows))say('최근 검색 삭제를 저장하지 못했습니다.');renderRecent();};div.append(open,del);body.append(div);});}
  function remember(s){if(s.f?.input||(!s.menu&&!s.tab))return;const rows=recent().filter(r=>JSON.stringify(r.state)!==JSON.stringify(s));rows.unshift({state:s,at:new Date().toISOString()});if(!S.saveRecent(storage(),rows))say('브라우저 저장소를 사용할 수 없어 최근 검색을 저장하지 않았습니다.');renderRecent();}
  $('recentClear').onclick=()=>{try{const store=storage();if(!store)throw Error();store.removeItem(recentKey);}catch{say('최근 검색 삭제를 저장하지 못했습니다.');}renderRecent();};
  $('shareCopy').onclick=async()=>{
    const owner=epoch;say('');const requestRevision=messageRevision;$('sharePrivacy').hidden=false;
    try{const url=S.encode(capture(),location.href);checkpoint('replace');$('shareFallback').hidden=true;try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(url);if(owner!==epoch||requestRevision!==messageRevision)return;say('현재 조건 링크를 복사했습니다. 주소가 포함되므로 공유 대상을 확인하세요.',{temporary:true});}catch{if(owner!==epoch||requestRevision!==messageRevision)return;$('shareFallback').hidden=false;$('shareFallback').value=url;$('shareFallback').focus();$('shareFallback').select();say('자동 복사를 사용할 수 없습니다. 선택된 링크를 직접 복사하세요.');}}
    catch(e){say(e.message);}
  };
  $('conditionExport').onclick=()=>{try{const data=JSON.stringify(capture(),null,2),blob=new Blob([data],{type:'application/json'});if(blob.size>S.MAX_FILE)throw Error('조건 파일이 너무 큽니다. 주소를 나누세요.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='donggu-search-conditions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say('조건만 내보냈습니다. 주소가 포함됩니다.');}catch(e){say(e.message);}};
  $('conditionImport').onchange=async event=>{const file=event.target.files[0];try{if(!file)return;if(file.size>S.MAX_FILE)throw Error('조건 파일은 250KB까지 불러올 수 있습니다.');const state=S.validate(JSON.parse(await file.text()),{file:true});await openState(state,'file');}catch(e){say('조건 파일을 읽지 못했습니다: '+e.message);}finally{event.target.value='';}};
  function wrap(name,handler){if(typeof window[name]!=='function')return;raw[name]=window[name];window[name]=function(...args){return handler.call(this,args);};}
  for(const name of ['switchTab','switchBuildingSubtab','switchMapSubtab'])wrap(name,function(args){if(depth)return raw[name](...args);checkpoint('replace');stop();selected=null;pending=null;entryRan=false;depth++;let r;try{r=raw[name](...args);}finally{depth--;}checkpoint('push');return r;});
  for(const name of ['runLookup','runDetail','runConditionSearch','runHousingSearch','runDemolSearch','runVacantSearch','runMapSearch'])wrap(name,async function(args){
    if(depth)return raw[name](...args);
    // Invalidate an unfinished URL restoration before accepting a new user query.
    const plan=pending,requested=capture(),revision=pickRevision;if(restoring)stop();else ++epoch;const token=epoch;pending=null;selected=null;entryRan=true;running=1;replaying=plan?token:0;
    checkpoint('push',true);
    try{const result=await invoke(name,...args);if(token!==epoch)return result;const unchanged=JSON.stringify(capture().f||{})===JSON.stringify(requested.f||{});if(plan&&unchanged)await afterSearch(plan,token,pickRevision!==revision);if(token!==epoch)return result;remember(unchanged?capture():requested);entryRan=unchanged;checkpoint('replace',unchanged);return result;}
    finally{if(token===epoch){running=Math.max(0,running-1);replaying=0;}}
  });
  const picks={
    selectDong:args=>({id:itemId('detail',D_DONGS[args[0]])}),
    loadSubtab:args=>({id:itemId('detail',D_SELECTED_TITLE),...selected,panel:args[0]}),
    openHousingDetail:()=>{const a=$('hResultBody')?.querySelector('.h-name.active');return a?{id:a.dataset.dtl?`kapt:${a.dataset.dtl}`:`pnu:${a.dataset.pnu}`}:null;},
    closeHousingDetail:()=>null,
    toggleDemolDetail:()=>M_DET_IDX>=0?{id:itemId('demol',MRESULTS[M_DET_IDX])}:null,
    closeDemolDetail:()=>null,
    showMapDetailCard:args=>({source:args[0],id:itemId(args[0],args[1])}),closeMapCard:()=>null
  };
  for(const [name,pick]of Object.entries(picks))wrap(name,function(args){const user=!!window.event?.isTrusted;if(depth||(!user&&(restoring||running)))return raw[name](...args);if(restoring){stop(false);pending=null;}checkpoint('replace');depth++;let result;try{result=raw[name](...args);selected=pick(args);pickRevision++;}finally{depth--;}checkpoint('push');return result;});
  for(const name of ['applyHousingSort','applyVacantSort','gotoHousingPage','gotoCondPage','gotoDemolPage','setFigureGroundColorMode','setFigureGroundShape'])wrap(name,function(args){const result=raw[name](...args);if(!depth&&!restoring&&!running)checkpoint(name.startsWith('goto')?'push':'replace');return result;});
  for(const name of ['clearAll','clearDetail','clearCond','clearHousing','clearDemol','clearVacant','clearMapSelection'])wrap(name,function(args){if(depth)return raw[name](...args);stop();selected=null;pending=null;entryRan=false;depth++;let result;try{result=raw[name](...args);}finally{depth--;}checkpoint('push',false);return result;});
  wrap('cancelSearch',function(args){if(!depth){++epoch;restoring=0;running=0;replaying=0;pending=null;entryRan=false;}const result=raw.cancelSearch(...args);checkpoint('replace',false);return result;});
  // Filter typing/sliders/map movement never create entries. Copy/search/navigation snapshots them.
  document.addEventListener('change',event=>{
    if(depth||host.contains(event.target))return;
    const isFilter=Object.values(S.fields).flat().some(id=>$(id)?.contains(event.target));
    if(restoring){if(!event.isTrusted)return;if(isFilter){stop(false);pending=null;}else return;}
    if(isFilter){pending=null;selected=null;const wasRun=entryRan;entryRan=false;checkpoint(wasRun?'push':'replace',false);}else if(!running)checkpoint('replace');
  });
  document.addEventListener('filtercommit',event=>{if(depth||restoring)return;const {tab}=active();if(event.detail?.tab&&event.detail.tab!==tab)return;pending=null;selected=null;const wasRun=entryRan;entryRan=false;checkpoint(wasRun?'push':'replace',false);});
  window.addEventListener('popstate',event=>{const p=S.parse(location.href);if(!p.ok){stop();say(p.error);return;}restore(p.state||(event.state?.p3?event.state.conditions:null)||{v:1,tab:'detail'},{reason:'history',ran:!!event.state?.ran,scroll:event.state?.scroll,resultConditions:event.state?.resultConditions});});
  let scrollTimer;window.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{if(!restoring&&history.state?.p3)history.replaceState({...history.state,scroll:[scrollX,scrollY]},'');},120);},{passive:true});
  window.addEventListener('hashchange',()=>{if(history.state?.p3)return;const p=S.parse(location.href);if(p.ok&&p.state)restore(p.state);else if(!p.ok)say(p.error);});
  renderRecent();
  const initial=S.parse(location.href);let historyOptions={};try{if(initial.state&&history.state?.p3&&S.encode(initial.state,location.href)===S.encode(history.state.conditions,location.href))historyOptions={reason:'history',ran:!!history.state.ran,scroll:history.state.scroll,resultConditions:history.state.resultConditions};}catch{/* URL is authoritative if optional history metadata is invalid. */}if(initial.ok&&initial.state)restore(initial.state,historyOptions);else if(!initial.ok)say(initial.error);else if(history.state?.p3&&history.state.conditions)restore(history.state.conditions,{reason:'history',ran:!!history.state.ran,scroll:history.state.scroll,resultConditions:history.state.resultConditions});else{invoke('switchBuildingSubtab','detail');checkpoint('replace',false);}
  window.SearchNavigation={capture,restore,itemId,checkpoint,replaying:()=>!!(restoring||replaying)};
})();
