/* One adapter for existing multiselect/dual components, committed filters and result provenance. */
(function(){
  const M=FilterModel,S=SearchState,$=id=>document.getElementById(id),models=new Map(),executions=new Map();let serial=0;
  const tabFor=kind=>Object.keys(M.configs).find(t=>M.configs[t].kind===kind)||kind;
  function defaults(tab){const f={};for(const id of S.fields[tab]){const el=$(id);if(S.ranges[id])f[id]=[+el.dataset.min,+el.dataset.max];else if(el.type==='checkbox')f[id]=el.defaultChecked;else if(el.tagName==='SELECT')f[id]='__ALL__';else f[id]=[...el.querySelectorAll('input')].filter(c=>c.defaultChecked).map(c=>c.value).sort();}return f;}
  function read(tab){const f=defaults(tab);for(const id of S.fields[tab]){const el=$(id);if(el.filterControl)f[id]=el.filterControl.values?.()||el.filterControl.selected().sort();else if(el.type==='checkbox')f[id]=el.checked;else if(el.tagName==='SELECT')f[id]=el.value||'__ALL__';else if(!S.ranges[id])f[id]=[...el.querySelectorAll('input:checked')].map(c=>c.value).sort();}return f;}
  function set(id,value){const el=$(id);if(el.filterControl)el.filterControl.set(value,{notify:false});else if(el.type==='checkbox')el.checked=value;else if(el.tagName==='SELECT'){if([...el.options].some(o=>o.value===value))el.value=value;}else for(const c of el.querySelectorAll('input'))c.checked=value.includes(c.value);}
  function commit(tab,values){for(const [id,value]of Object.entries(values))set(id,value);if(tab==='general')syncMapCondSections();refresh(tab);$(M.configs[tab].root).dispatchEvent(new CustomEvent('filtercommit',{bubbles:true,detail:{tab}}));}
  function mount(tab){
    if(models.has(tab))return models.get(tab);
    const c=M.configs[tab],button=$(c.button),card=button.closest('.card'),root=$(c.root),grid=card?.querySelector('.form-grid');
    const advanced=document.createElement('details');advanced.id='advanced-'+tab;advanced.className='advanced-filters'+(tab==='general'?' ms-section':'');advanced.innerHTML='<summary aria-expanded="false">상세 조건</summary><div class="form-grid advanced-grid"></div>';
    const detailGrid=advanced.querySelector('.advanced-grid');
    if(tab==='general'){for(const id of ['map-cond-vacant','map-cond-apt','map-cond-cond'])detailGrid.append($(id));button.closest('.ms-section').before(advanced);}
    else {
      grid.after(advanced);
      for(const id of S.fields[tab].filter(id=>!c.basic.includes(id))){const el=$(id);if(id==='m-yearunknown'){const field=document.createElement('div');field.className='field';field.append(el.closest('label'));detailGrid.append(field);}else{const field=el.closest('.field');if(field&&!detailGrid.contains(field))detailGrid.append(field);}}
    }
    advanced.addEventListener('toggle',()=>advanced.querySelector('summary').setAttribute('aria-expanded',String(advanced.open)));
    const chips=document.createElement('div');chips.id='filter-chips-'+tab;chips.className='filter-chips'+(tab==='general'?' ms-section':'');chips.setAttribute('aria-label','편집 중인 검색 조건');advanced.after(chips);
    const quick=document.createElement('div');quick.id='filter-presets-'+tab;quick.className='filter-presets';(grid||$(c.button).closest('.ms-section')).before(quick);
    const feedback=document.createElement('div');feedback.id='filter-feedback-'+tab;feedback.className='filter-feedback';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');if(card)card.after(feedback);else $(c.result).before(feedback);
    (tab==='general'?button.closest('.ms-section'):button.parentElement).classList.add('filter-query-actions');
    const model={tab,c,advanced,chips,quick,feedback,attempt:null,published:null,chipKey:null,presetKey:null};models.set(tab,model);
    for(const id of S.fields[tab])if($(id).type==='checkbox')$(id).setAttribute('aria-label',M.labels[id]);
    for(const id of S.fields[tab])new MutationObserver(()=>refresh(tab)).observe($(id),{childList:true});
    return model;
  }
  function resultVisible(model){return $(model.c.result).style.display!=='none'||model.tab==='general'&&Object.values(M_LAYER).some(layer=>(layer.getLayers?.().length||0)>0);}
  function feedback(model){
    const {tab,c,attempt,published}=model,f=read(tab),shown=published&&resultVisible(model),dirty=!!published&&M.fingerprint(f)!==M.fingerprint(published.filters);
    const key=JSON.stringify([shown,dirty,attempt?.phase,attempt?.busy,$(c.button).disabled,published?.phase,published?.id,attempt?.id,model.reference]);if(model.feedbackKey===key)return;model.feedbackKey=key;
    model.feedback.replaceChildren();
    if(attempt?.busy){const p=document.createElement('p');p.textContent=(tab==='housing'?'조회·보강 중 · 잠정 결과':'조회 중 · 잠정 결과')+' · 조회 조건: '+M.summary(attempt.filters,attempt.defaults);model.feedback.append(p);}
    else if(attempt&&!attempt.published){const p=document.createElement('p');p.textContent=attempt.phase+' · 이번 조회에 사용한 조건: '+M.summary(attempt.filters,attempt.defaults);model.feedback.append(p);}
    if(model.reference&&!shown&&!attempt?.busy){const p=document.createElement('p');p.textContent='이전 조회 조건: '+M.summary({...defaults(tab),...(model.reference.f||{})},defaults(tab))+' · 대량 조회는 자동 재실행하지 않습니다. 현재 조건으로 검색해 주세요.';model.feedback.append(p);}
    if(published&&shown){const p=document.createElement('p');p.textContent='표시 결과의 조회 조건: '+M.summary(published.filters,published.defaults)+' · '+published.phase;model.feedback.append(p);}
    if(dirty&&(shown||attempt?.busy)){
      const p=document.createElement('p');p.className='filter-dirty';p.textContent='조건이 바뀌었어요. 다시 검색해 주세요. '+(shown?'이전 조건의 결과입니다.':'진행 중인 조회도 변경 전 조건을 사용합니다.');
      const rerun=document.createElement('button');rerun.type='button';rerun.textContent='현재 조건으로 다시 검색';rerun.disabled=$(c.button).disabled;rerun.onclick=()=>window[c.run]();p.append(' ',rerun);model.feedback.append(p);
    }else if(attempt?.busy&&M.fingerprint(f)!==M.fingerprint(attempt.filters)){
      const p=document.createElement('p');p.textContent='조건이 바뀌었어요. 진행 중인 조회는 변경 전 조건을 사용합니다. 완료 후 다시 검색해 주세요.';model.feedback.append(p);
    }
    const head=$(c.result).querySelector('.legend,.map-results-head');if(head&&published){let summary=head.querySelector('.result-condition-summary');if(!summary){summary=document.createElement('small');summary.className='result-condition-summary';head.append(summary);}summary.textContent='조회 조건: '+M.summary(published.filters,published.defaults);}
    model.feedback.hidden=!model.feedback.childNodes.length;
  }
  function refresh(tab){
    if(!M.configs[tab])return;const model=mount(tab),f=read(tab),d=defaults(tab),groups=M.groups(f,d),changed=Object.keys(f).filter(id=>!M.same(f[id],d[id])).length,unused=changed-groups.length,key=JSON.stringify(f);
    const detailCount=groups.filter(g=>!model.c.basic.includes(g.id)).length;model.advanced.querySelector('summary').firstChild.textContent='상세 조건'+(detailCount?` · ${detailCount}개 적용`:'')+(unused?` · 미사용 저장 ${unused}개`:'');
    if(model.chipKey!==key){model.chipKey=key;model.chips.replaceChildren();const title=document.createElement('span');title.className='filter-chip-caption';title.textContent=`편집 중인 조건 · ${groups.length}개 적용`+(unused?` · 미사용 저장 ${unused}개`:'');model.chips.append(title);
      for(const g of groups){const chip=document.createElement('button');chip.type='button';chip.className='filter-chip';chip.textContent=g.text+' ×';chip.setAttribute('aria-label',g.label+' 조건 해제');chip.onclick=()=>{commit(tab,{[g.id]:d[g.id]});$(model.c.button).focus({preventScroll:true});};model.chips.append(chip);}
      const clear=document.createElement('button');clear.type='button';clear.className='filter-clear';clear.textContent='조건 모두 지우기';clear.disabled=!changed;clear.title='현재 화면의 필터와 미사용 저장값만 기본값으로 되돌립니다. 결과는 유지하며 다시 검색해야 적용됩니다. 초기화는 결과도 지웁니다.';clear.onclick=()=>{commit(tab,d);$(model.c.button).focus({preventScroll:true});};model.chips.append(clear);
      if(changed){const hint=document.createElement('small');hint.className='filter-reset-hint';hint.textContent='조건만 변경합니다. 결과도 지우려면 초기화하세요.';model.chips.append(hint);}
    }
    const presets=M.presets(tab,new Date().getFullYear(),d),presetKey=JSON.stringify([presets,S.fields[tab].filter(id=>!S.ranges[id]).map(id=>[...$(id).querySelectorAll('input')].map(c=>c.value))]);
    if(model.presetKey!==presetKey){const focusPreset=model.quick.contains(document.activeElement)?document.activeElement.dataset.preset:null;model.presetKey=presetKey;model.quick.replaceChildren();if(presets.length){const label=document.createElement('span');label.textContent='빠른 조건 · 값만 설정, 검색은 직접 실행';model.quick.append(label);}
      for(const p of presets){const button=document.createElement('button');button.type='button';button.dataset.preset=p.id;const on=Object.entries(p.values).every(([id,v])=>M.same(f[id],v));button.textContent=p.name;button.setAttribute('aria-pressed',String(on));button.title=p.note+' · 같은 조건을 다시 누르면 담당 조건만 기본값으로 해제합니다.';
        button.disabled=Object.entries(p.values).some(([id,v])=>S.ranges[id]?(v[0]<d[id][0]||v[1]>d[id][1]):Array.isArray(v)&&v.some(x=>![...$(id).querySelectorAll('input')].some(c=>c.value===x)));
        button.onclick=()=>{const current=read(tab),enabled=Object.entries(p.values).every(([id,v])=>M.same(current[id],v));commit(tab,Object.fromEntries(Object.entries(p.values).map(([id,v])=>[id,enabled?d[id]:v])));};model.quick.append(button);
      }
      if(presets.length){const help=document.createElement('details');help.className='preset-help';const summary=document.createElement('summary');summary.textContent='빠른 조건 설명';help.append(summary);for(const p of presets){const line=document.createElement('p');line.textContent=p.name+': '+p.note;help.append(line);}const rule=document.createElement('p');rule.textContent='서로 다른 조건은 조합하며 같은 조건은 나중 값을 사용합니다. 해제는 해당 빠른 조건이 담당하는 항목만 초기값으로 돌립니다.';help.append(rule);model.quick.append(help);}
      if(focusPreset)model.quick.querySelector(`[data-preset="${focusPreset}"]`)?.focus({preventScroll:true});
    }
    for(const p of presets)model.quick.querySelector(`[data-preset="${p.id}"]`)?.setAttribute('aria-pressed',String(Object.entries(p.values).every(([id,v])=>M.same(f[id],v))));
    feedback(model);
  }
  function begin(kind,owner){const tab=tabFor(kind);if(!M.configs[tab])return null;const model=mount(tab),tag=executions.get(tab);if(model.attempt?.busy&&model.attempt.execution===tag){if(owner)model.attempt.owner=owner;return model.attempt;}const run={id:++serial,execution:tag,filters:read(tab),defaults:defaults(tab),owner,busy:true,published:false,phase:tab==='housing'?'보강 중':'조회 중',at:new Date().toISOString()};model.reference=null;model.attempt=run;refresh(tab);return run;}
  function statusFor(model){const run=model.attempt,session=run?.owner;if(model.tab==='housing'&&session)return H_PROGRESS_STATE;if(model.tab==='general')return (session?.ledger?session.ledger.status():run?.busy?'조회 중 · 잠정 결과':'조회 처리 완료')+' · 지도 위치·출처별 완전성 안내 확인';if(session?.ledger)return session.ledger.status();return run?.busy?'조회 중 · 잠정 결과':model.tab==='vacant'?'원본 레코드 조회 완료 · 위치 미확인 별도':'조회 처리 완료';}
  function publish(tab){const model=mount(tab),run=model.attempt;if(!run||run.owner&&!run.owner.current())return;run.published=true;run.phase=statusFor(model);model.published=run;refresh(tab);}
  function status(session){const tab=tabFor(session.kind),model=models.get(tab);if(model?.attempt?.owner===session){model.attempt.phase=statusFor(model);refresh(tab);}}
  function cancel(kind){const tab=tabFor(kind),model=models.get(tab);executions.delete(tab);if(model?.attempt){if(model.attempt.busy||model.attempt.owner?.ledger.busy||model.attempt.owner?.retrying){model.attempt.busy=false;model.attempt.phase='취소됨 · 미완료';}refresh(tab);}}
  function appendExcel(wb,tab){const run=models.get(tab)?.published;if(!run)return;const rows=[['구분','실제 내보내는 결과의 조회 조건 (편집 중인 조건 아님)'],['조회 시작',run.at],['결과 상태',run.phase],['조건 요약',M.summary(run.filters,run.defaults)],['필터값',JSON.stringify(run.filters)]];XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'결과조회조건');}
  function historyState(tab){const model=models.get(tab),run=model?.published;if(!model)return null;if(!run||!resultVisible(model))return model.reference||null;const state={v:1,menu:tab==='cond'?'building':tab==='general'?'map':tab};if(tab==='cond')state.tab='cond';const f={};for(const [id,value]of Object.entries(run.filters))if(!M.same(value,run.defaults[id]))f[id]=value;if(Object.keys(f).length)state.f=f;return S.validate(state);}
  function reference(tab,state){tab=tabFor(tab);const model=models.get(tab);if(model){model.reference=state;model.feedbackKey=null;refresh(tab);}}
  function suspend(){for(const [tab,model]of models){executions.delete(tab);model.attempt=null;model.reference=null;refresh(tab);}}
  const api={read,defaults,refresh,commit,begin,publish,status,cancel,appendExcel,models,historyState,reference,suspend,resultSources:()=>{const model=models.get('general');return (model.attempt?.busy?model.attempt.filters:model.published?.filters)?.mapSourceGrid||null;},matches:run=>!!run&&M.fingerprint(read(tabFor(run.owner.kind)))===M.fingerprint(run.filters),resultSession:kind=>models.get(tabFor(kind))?.published?.owner};
  window.FilterUI=api;
  for(const tab of Object.keys(M.configs))mount(tab);
  for(const [tab,c]of Object.entries(M.configs)){
    const original=window[c.run];window[c.run]=async function(...args){const ticket=++serial;executions.set(tab,ticket);try{return await original(...args);}finally{const model=models.get(tab),run=model.attempt;if(executions.get(tab)===ticket&&run?.execution===ticket){run.busy=false;run.phase=run.published||run.owner?statusFor(model):'조회 실패·미완료 또는 결과 없음';refresh(tab);}}};
  }
  for(const [name,tab]of Object.entries({renderConditionResults:'cond',renderHousingResults:'housing',renderDemolResults:'demol',renderVacantPage:'vacant',renderMapResults:'general'})){const original=window[name];window[name]=function(...args){const result=original(...args);publish(tab);return result;};}
  for(const [name,tab]of Object.entries({clearCond:'cond',clearHousing:'housing',clearDemol:'demol',clearVacant:'vacant',clearMapSelection:'general'})){const original=window[name];window[name]=function(...args){const result=original(...args),model=models.get(tab);model.attempt=null;model.published=null;model.reference=null;refresh(tab);return result;};}
  const cancelOriginal=cancelSearch;cancelSearch=function(kind){cancel(kind);return cancelOriginal(kind);};
  function edited(tab){refresh(tab);const session=QUERY_SESSIONS.get(M.configs[tab].kind);if(session?.current()&&session.apply)showQueryStatus(session);}
  for(const type of ['change','input'])document.addEventListener(type,event=>{if(event.target.type==='number'&&type==='input')return;const tab=Object.keys(M.configs).find(t=>S.fields[t].some(id=>$(id).contains(event.target)));if(tab)edited(tab);});
  document.addEventListener('filtercommit',event=>{if(event.detail?.tab)edited(event.detail.tab);else{const tab=Object.keys(M.configs).find(t=>S.fields[t].some(id=>$(id).contains(event.target)));if(tab)edited(tab);}});
  for(const tab of Object.keys(M.configs))refresh(tab);
})();
