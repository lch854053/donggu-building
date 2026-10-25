/* Display labels only; persisted menu/tab keys remain unchanged. */
(function(root){
  const screens={detail:['주소로 찾기','주소 하나로 건물의 상세정보를 확인합니다.'],bulk:['여러 주소 한 번에','한 줄에 주소 하나씩 입력해 함께 조회합니다.'],cond:['조건으로 찾기','지역·용도·규모 등의 조건으로 건물을 찾습니다.'],housing:['공동주택 관리','지역과 조건으로 공동주택 단지를 조회합니다.'],demol:['철거·멸실 조회','지역과 기간으로 철거·멸실 이력을 조회합니다.'],vacant:['빈집 조회','행정 제공자료의 빈집 원본 레코드를 조회합니다.'],stats:['동구 통계','자료의 단위·기준시점·출처를 함께 확인합니다.'],general:['일반지도','선택한 자료를 지도에서 확인합니다.'],figure:['건물윤곽지도','건물 윤곽과 주제별 분포를 살펴봅니다.']};
  const filters={'ms-purps':'용도','ms-strct':'구조','dual-flr':'지상층','dual-uflr':'지하층','dual-area':'연면적','dual-year':'승인연도','h-ms-kind':'종류','h-dual-hhld':'세대수','h-dual-area':'연면적','h-dual-year':'승인연도','mms-gb':'구분','mdual-year':'완료연도','vms-grade':'등급','v-dual-year':'건축연도','map-ms-vgrade':'빈집 등급','map-ms-hkind':'주택 종류','map-ms-purps':'용도','map-ms-strct':'구조','c-yearunknown':'미확인 연도','h-areaunknown':'미확인 면적','h-yearunknown':'미확인 연도','m-yearunknown':'미확인 날짜','v-yearunknown':'미확인 연도'};
  const sortLabels={hhldAsc:'세대수↑',hhldDesc:'세대수↓',useAprAsc:'승인일↑',useAprDesc:'승인일↓',yearAsc:'연도↑',yearDesc:'연도↓',gradeAsc:'등급↑',gradeDesc:'등급↓'};
  function recent(s){
    const menu=s.menu||'building',tab=s.tab||(menu==='building'?'bulk':menu==='map'?'general':menu),f=s.f||{};
    let scope=Object.entries(f).find(([k])=>k.endsWith('hdong'))?.[1];scope=!scope||scope==='__ALL__'?'동구 전체':scope;
    let title;
    if(tab==='detail')title=`${f.dInput||'주소 미입력'} · 건물 상세`;
    else if(tab==='bulk')title='여러 주소 한 번에 · 저장 조건';
    else if(tab==='general'){const names=(f.mapSourceGrid||['vacant','apt']).map(k=>({vacant:'빈집',apt:'공동주택',cond:'건축물'}[k])).filter(Boolean);title=`${scope} · ${names.join('·')||'선택 자료 없음'} 지도`;}
    else title=`${scope} · ${{housing:'공동주택 조회',demol:'철거·멸실 조회',vacant:'빈집 조회',cond:'건축물 조건 조회',figure:'건물윤곽지도',stats:'동구 통계'}[tab]||'검색 조건'}`;
    const extra=[];for(const [key,v]of Object.entries(f)){const label=filters[key];if(!label)continue;const bounds=root.SearchState?.ranges[key],range=root.FilterModel&&bounds&&Array.isArray(v)&&typeof v[0]==='number'?root.FilterModel.rangeText(key,v,[bounds[0],key.includes('year')?new Date().getFullYear():bounds[1]]):null;extra.push(typeof v==='boolean'?`${label} ${v?'포함':'제외'}`:`${label} ${range||(Array.isArray(v)?v.join('~'):v)}`);}
    if(s.sort&&sortLabels[s.sort])extra.push(sortLabels[s.sort]);if(s.page)extra.push(`${s.page}페이지`);
    if(s.theme)extra.push({age:'연도 색상',purpose:'용도 색상',floor:'층수 색상',structure:'구조 색상'}[s.theme]||'기본 색상');if(s.shape==='square')extra.push('사각 배경');
    return title+(extra.length?' · '+extra.join(' / '):'');
  }
  root.UiLabels={screens,recent};
})(globalThis);
