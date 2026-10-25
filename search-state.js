/* Versioned, allowlisted search conditions only. No responses, geometry or credentials. */
(function(root){
  'use strict';
  const MAX_URL=8000,MAX_FILE=250000,MAX_RECENT=10;
  const fields={
    bulk:['input'],detail:['dInput'],
    cond:['c-hdong','ms-purps','ms-strct','dual-flr','dual-uflr','dual-area','dual-year','c-yearunknown'],
    housing:['h-hdong','h-ms-kind','h-dual-hhld','h-dual-area','h-dual-year','h-areaunknown','h-yearunknown'],
    demol:['m-hdong','mms-gb','mdual-year','m-yearunknown'],
    vacant:['v-hdong','vms-grade','v-dual-year','v-yearunknown'],
    general:['map-hdong','mapSourceGrid','map-ms-vgrade','map-ms-hkind','map-ms-purps','map-ms-strct'],figure:[],stats:[]
  };
  const ranges={'dual-flr':[0,30],'dual-uflr':[0,7],'dual-area':[0,3000],'dual-year':[1900,2100],'h-dual-hhld':[0,2000],'h-dual-area':[0,100000],'h-dual-year':[1900,2100],'mdual-year':[1990,2100],'v-dual-year':[1900,2100]};
  const fail=message=>{throw new Error(message);};
  function text(v,max=100){if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail('문자열 형식 또는 길이를 확인하세요.');return v;}
  function validate(input,{file=false}={}){
    if(!input||typeof input!=='object'||Array.isArray(input))fail('검색 조건 형식이 잘못되었습니다.');
    if(input.v!==1)fail('지원하지 않는 검색 링크 버전입니다.');
    const menu=input.menu||'building';if(!['building','housing','demol','vacant','map','stats'].includes(menu))fail('지원하지 않는 메뉴입니다.');
    const tab=menu==='building'?(input.tab||'bulk'):menu==='map'?(input.tab||'general'):menu;
    if(!['building','map'].includes(menu)&&input.tab!=null&&input.tab!==menu)fail('메뉴와 하위 탭이 일치하지 않습니다.');
    if(!fields[tab] || (menu==='building'&&!['bulk','cond','detail'].includes(tab)) || (menu==='map'&&!['general','figure'].includes(tab)))fail('지원하지 않는 탭입니다.');
    const out={v:1};if(menu!=='building')out.menu=menu;if((menu==='building'&&tab!=='bulk')||(menu==='map'&&tab!=='general'))out.tab=tab;
    const f={};if(input.f!=null&&(typeof input.f!=='object'||Array.isArray(input.f)))fail('필터 형식이 잘못되었습니다.');
    for(const [key,value] of Object.entries(input.f||{})){
      if(!fields[tab].includes(key))fail('지원하지 않는 검색 조건입니다.');
      if(ranges[key]){const [min,max]=ranges[key];if(!Array.isArray(value)||value.length!==2||value.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(key.includes('area')?Math.abs(n*100-Math.round(n*100))>1e-6:!Number.isInteger(n)))||value[0]>value[1])fail('범위 조건이 잘못되었습니다.');f[key]=value;}
      else if(key.endsWith('unknown')){if(typeof value!=='boolean')fail('미확인 포함 조건이 잘못되었습니다.');f[key]=value;}
      else if(['input','dInput'].includes(key))f[key]=text(value,key==='input'?(file?200000:MAX_URL):300);
      else if(key.endsWith('hdong'))f[key]=text(value,30);
      else {if(!Array.isArray(value)||value.length>25)fail('선택 조건이 너무 많습니다.');f[key]=[...new Set(value.map(v=>text(v,80)))].sort();}
    }
    if(Object.keys(f).length)out.f=f;
    if(input.sort!=null){if(!['default','hhldDesc','hhldAsc','useAprAsc','useAprDesc','yearDesc','yearAsc','gradeAsc','gradeDesc'].includes(input.sort))fail('정렬 조건이 잘못되었습니다.');if(input.sort!=='default')out.sort=input.sort;}
    if(input.page!=null){if(!Number.isInteger(input.page)||input.page<1||input.page>10000)fail('페이지가 잘못되었습니다.');if(input.page!==1)out.page=input.page;}
    if(input.pick!=null){if(!input.pick||typeof input.pick!=='object'||Array.isArray(input.pick))fail('선택 항목 형식 오류');const p={};for(const key of ['id','source','panel'])if(input.pick[key]!=null)p[key]=text(input.pick[key],200);if(Object.keys(input.pick).some(k=>!['id','source','panel'].includes(k)))fail('선택 항목 형식 오류');if(Object.keys(p).length)out.pick=p;}
    if(input.view!=null){const a=input.view;if(!Array.isArray(a)||a.length!==3||a.some(n=>typeof n!=='number'||!Number.isFinite(n))||a[0]<35.068||a[0]>35.185||a[1]<126.889||a[1]>127.008||a[2]<(tab==='figure'?13:0)||a[2]>19||!Number.isInteger(a[2]))fail('지도 위치·확대 수준이 지원 범위를 벗어났습니다.');out.view=[+a[0].toFixed(5),+a[1].toFixed(5),a[2]];}
    if(input.theme!=null){if(!['plain','age','purpose','floor','structure'].includes(input.theme))fail('지원하지 않는 색상 테마입니다.');if(input.theme!=='plain')out.theme=input.theme;}
    if(input.shape!=null){if(!['circle','square'].includes(input.shape))fail('지원하지 않는 배경 형태입니다.');if(input.shape!=='circle')out.shape=input.shape;}
    if(out.sort&&!(['housing','vacant'].includes(tab)))fail('이 화면에는 정렬 조건을 사용할 수 없습니다.');
    if(out.sort&&tab==='housing'&&!['hhldAsc','hhldDesc','useAprAsc','useAprDesc'].includes(out.sort))fail('공동주택 정렬 조건이 잘못되었습니다.');
    if(out.sort&&tab==='vacant'&&!['gradeAsc','gradeDesc','yearAsc','yearDesc'].includes(out.sort))fail('빈집 정렬 조건이 잘못되었습니다.');
    if(out.page&&!['cond','housing','demol','vacant'].includes(tab))fail('이 화면에는 페이지 조건을 사용할 수 없습니다.');
    if(out.pick&&!['detail','cond','housing','demol','general'].includes(tab))fail('이 화면에는 선택 항목을 사용할 수 없습니다.');
    if(out.pick?.source&&!['vacant','apt','cond'].includes(out.pick.source))fail('지도 선택 출처가 잘못되었습니다.');
    if(out.pick?.panel&&!['flr','park','wclf','jiji','hist','tmphdcr','lda','map'].includes(out.pick.panel))fail('상세 탭이 잘못되었습니다.');
    if(out.view&&menu!=='map'||(out.theme||out.shape)&&tab!=='figure')fail('이 화면에는 지도 설정을 사용할 수 없습니다.');
    if(Object.keys(input).some(k=>!['v','menu','tab','f','pick','page','sort','view','theme','shape'].includes(k)))fail('허용되지 않은 상태 필드입니다.');
    return out;
  }
  function encode(state,base){const s=validate(state,{file:true}),url=new URL(base);url.search='';url.hash='q='+encodeURIComponent(JSON.stringify(s));if(url.href.length>MAX_URL)fail(`링크는 ${MAX_URL.toLocaleString()}자까지입니다. 주소를 줄이거나 조회 조건 JSON 내보내기를 사용하세요.`);return url.href;}
  function parse(url){try{const u=new URL(url);if(!u.hash.startsWith('#q='))return {ok:true,state:null};if(url.length>MAX_URL)fail('공유 링크가 너무 깁니다. JSON 불러오기를 사용하세요.');return {ok:true,state:validate(JSON.parse(decodeURIComponent(u.hash.slice(3))))};}catch(e){return {ok:false,error:e.message||'검색 링크를 읽을 수 없습니다.'};}}
  function readRecent(storage){try{const rows=JSON.parse(storage.getItem('donggu.recent.v1')||'[]');if(!Array.isArray(rows))return [];return rows.slice(0,MAX_RECENT).flatMap(r=>{try{const state=validate(r.state);if(state.f?.input)return [];return [{state,at:text(r.at,40)}];}catch{return [];}});}catch{return [];}}
  function saveRecent(storage,rows){try{storage.setItem('donggu.recent.v1',JSON.stringify(rows.slice(0,MAX_RECENT)));return true;}catch{return false;}}
  const api={MAX_URL,MAX_FILE,MAX_RECENT,fields,ranges,validate,encode,parse,readRecent,saveRecent};root.SearchState=api;
})(globalThis);
