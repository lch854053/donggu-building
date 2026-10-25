/* Display-only rules. Never use these strings for filtering, ordering or export values. */
(function(root){
  function number(value){if(value==null||typeof value==='boolean'||String(value).trim()===''||String(value).trim()==='-')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
  function scalar(value,kind='area'){
    if(value==='해당 없음')return value;
    const n=number(value),digits={area:2,ratio:1,index:2,count:0,floor:0,change:2}[kind]??2;
    if(n==null||(kind!=='change'&&n<0)||(['count','floor'].includes(kind)&&!Number.isSafeInteger(n)))return '미확인';
    return n.toLocaleString('ko-KR',{maximumFractionDigits:digits});
  }
  function price(value,unit){const n=number(value);if(n==null||n<0)return '미확인';if(!['원','천원'].includes(unit))return '단위 확인 필요';const won=n*(unit==='천원'?1000:1);if(!Number.isFinite(won))return '미확인';if(won<10000)return `${Number.isInteger(won)?'':'약 '}${Math.round(won).toLocaleString('ko-KR')}원`;const m=Math.round(won/10000),e=Math.floor(m/10000),rest=m%10000;return '약 '+(e?`${e.toLocaleString('ko-KR')}억`:'')+(rest?`${e?' ':''}${rest.toLocaleString('ko-KR')}만원`:e?'원':'0만원');}
  function date(value){const s=String(value??'').trim().replace(/[.\-]/g,'');if(!/^\d{4}(?:\d{2})?(?:\d{2})?$/.test(s)||Number(s.slice(0,4))<1800)return '미확인';const year=Number(s.slice(0,4));if(s.length===4)return `${year}년`;const month=Number(s.slice(4,6));if(month<1||month>12)return '미확인';if(s.length===6)return `${year}.${s.slice(4,6)}`;const day=Number(s.slice(6,8)),d=new Date(Date.UTC(year,month-1,day));return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?`${year}.${s.slice(4,6)}.${s.slice(6,8)}`:'미확인';}
  function age(value,now=new Date()){
    const label=date(value);if(label==='미확인')return {label,age:null,approximate:false};const s=String(value).replace(/[.\-]/g,''),y=Number(s.slice(0,4));let years=now.getFullYear()-y;
    if(s.length===8&&(now.getMonth()+1<Number(s.slice(4,6))||now.getMonth()+1===Number(s.slice(4,6))&&now.getDate()<Number(s.slice(6,8))))years--;
    return {label,age:years<0?null:years,approximate:s.length!==8};
  }
  function designation(t){const s=String(t?.mainAtchGbCdNm||'').trim();return s||({0:'주건축물',1:'부속건축물'}[String(t?.mainAtchGbCd??'')]||'주·부속 구분 미확인');}
  function state(value,{busy=false,count=null,cancelled=false}={}){
    if(cancelled||String(value).includes('취소'))return {key:'cancelled',label:'조회 취소 · 미완료',warning:'표시된 자료가 있더라도 요청한 범위를 모두 확인한 결과가 아닙니다.'};
    if(busy||/조회 중|보강 중/.test(String(value)))return {key:'loading',label:'조회 중 · 잠정 결과',warning:'보강·수집에 따라 결과와 집계가 달라질 수 있습니다.'};
    if(/전체 실패/.test(String(value)))return {key:'failed',label:'자료를 불러오지 못했습니다',warning:'정상 0건이 아닙니다. 조회 조건과 실패 내역을 확인하고 다시 시도하세요.'};
    if(/부분|실패|미완료/.test(String(value)))return {key:'partial',label:'일부 자료를 불러오지 못했습니다',warning:'현재 수신한 결과를 유지합니다. 전체 건수와 완전성을 보장할 수 없습니다.'};
    if(count===0||value==='정상 0건')return {key:'empty',label:'요청한 범위 조회 완료 · 조건 일치 0건',warning:'원본 자료의 미등록·갱신 시차가 있을 수 있습니다.'};
    return {key:'complete',label:'요청한 범위 조회 완료',warning:'원본 데이터의 정확성이나 개별 건물의 적법성을 보증하지 않습니다.'};
  }
  const columns={
    bulk:{body:'resultBody',root:'resultArea',base:17,basic:[0,1,4,5,9,12,13,15,16,17],required:[1,4,17]},
    cond:{body:'cResultBody',root:'cResultArea',base:13,basic:[0,3,4,5,6,8,9,10,12,13,14],required:[3,4,5,14]},
    housing:{body:'hResultBody',root:'hResultArea',base:13,basic:[0,1,2,4,6,10,11,13],required:[1,4,13]},
    demol:{body:'mResultBody',root:'mResultArea',base:9,basic:[0,2,3,4,5,7,9],required:[4,9]},
    vacant:{body:'vResultBody',root:'vResultArea',base:9,basic:[0,1,2,4,7,8,9],required:[2,9]}
  };
  root.ResultFormat={number,scalar,price,date,age,designation,state,columns};
})(globalThis);
