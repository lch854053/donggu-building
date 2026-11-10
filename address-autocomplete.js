/* Suggestions only fill the existing search field; the normal lookup remains authoritative. */
(function(){
  const input=document.getElementById('dInput'), list=document.getElementById('addressSuggestions'), status=document.getElementById('addressSuggestionStatus');
  let timer, sequence=0, active=-1, items=[], composing=false;
  const cache=new Map();
  function close(){clearTimeout(timer);sequence++;items=[];active=-1;list.hidden=true;list.replaceChildren();input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');status.textContent='';}
  function select(index){const item=items[index];if(!item)return;const dong=input.value.match(/(?:제)?\d+(?:-\d+)?\s*동(?![가-힣])/);input.value=item+(dong?' '+dong[0]:'');input.dispatchEvent(new Event('input',{bubbles:true}));close();input.focus();}
  function show(values){
    items=values;active=-1;list.replaceChildren();
    values.forEach((value,i)=>{const option=document.createElement('li');option.id='address-option-'+i;option.role='option';option.textContent=value;option.addEventListener('mousedown',e=>e.preventDefault());option.addEventListener('click',()=>select(i));list.append(option);});
    list.hidden=!values.length;input.setAttribute('aria-expanded',String(!!values.length));status.textContent=values.length?`주소 후보 ${values.length}개. 방향키로 선택하세요.`:'';
  }
  function schedule(){
    close();const query=input.value.trim(),id=sequence;
    if(composing||query.length<3)return;
    timer=setTimeout(async()=>{
      try{
        let values=cache.get(query);
        if(!values){const addressQuery=cleanForSearch(query.replace(/\s+(?:제)?\d+(?:-\d+)?\s*동(?![가-힣]).*$/,''));const result=await searchJuso(addressQuery);values=[...new Set(result.filter(x=>/^(29110|12210)/.test(String(x.admCd||''))).map(x=>x.roadAddrPart1||x.roadAddr||x.jibunAddr).filter(Boolean))].slice(0,5);cache.set(query,values);if(cache.size>30)cache.delete(cache.keys().next().value);}
        if(id===sequence&&input.value.trim()===query&&document.activeElement===input)show(values);
      }catch{if(id===sequence)status.textContent='주소 후보를 불러오지 못했습니다. 직접 입력해 조회할 수 있습니다.';}
    },400);
  }
  input.addEventListener('compositionstart',()=>{composing=true;close();});
  input.addEventListener('compositionend',()=>{composing=false;schedule();});
  input.addEventListener('input',schedule);
  input.addEventListener('keydown',e=>{
    if(e.isComposing)return;
    if(e.key==='Escape'&&!list.hidden){e.preventDefault();e.stopImmediatePropagation();close();return;}
    if((e.key==='ArrowDown'||e.key==='ArrowUp')&&items.length){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;[...list.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));input.setAttribute('aria-activedescendant',list.children[active].id);return;}
    if(e.key==='Enter'&&!list.hidden){if(active>=0||items.length>1){e.preventDefault();e.stopImmediatePropagation();if(active>=0)select(active);else status.textContent='주소 후보를 선택하거나 Escape를 눌러 직접 조회하세요.';}else close();}
  },true);
  input.addEventListener('blur',()=>setTimeout(close,150));
  document.getElementById('dRunBtn').addEventListener('click',e=>{if(!list.hidden&&items.length>1){e.preventDefault();e.stopImmediatePropagation();status.textContent='주소 후보를 선택하거나 Escape를 눌러 직접 조회하세요.';input.focus();}else close();},true);
})();
