/* Filter presentation and semantic comparison, without DOM/API dependencies. */
(function(root){
  const configs={
    cond:{kind:'condition',run:'runConditionSearch',button:'cRunBtn',root:'tab-cond',result:'cResultArea',basic:['c-hdong','ms-purps']},
    housing:{kind:'housing',run:'runHousingSearch',button:'hRunBtn',root:'tab-housing',result:'hResultArea',basic:['h-hdong','h-ms-kind']},
    demol:{kind:'demol',run:'runDemolSearch',button:'mRunBtn',root:'tab-demol',result:'mResultArea',basic:['m-hdong','mdual-year']},
    vacant:{kind:'vacant',run:'runVacantSearch',button:'vRunBtn',root:'tab-vacant',result:'vResultArea',basic:['v-hdong','vms-grade']},
    general:{kind:'map',run:'runMapSearch',button:'mapRunBtn',root:'map-sub-general',result:'mapResultsWrap',basic:['mapSourceGrid','map-hdong']}
  };
  const labels={'c-hdong':'행정동','h-hdong':'행정동','m-hdong':'행정동','v-hdong':'행정동','map-hdong':'행정동','ms-purps':'용도','ms-strct':'구조','dual-flr':'지상층수','dual-uflr':'지하층수','dual-area':'연면적','dual-year':'사용승인 연도','c-yearunknown':'연도 미확인 포함','h-ms-kind':'주택 종류','h-dual-hhld':'세대수','h-dual-area':'연면적','h-dual-year':'사용승인 연도','h-yearunknown':'연도 미확인 포함','h-areaunknown':'면적 미확인 포함','mdual-year':'철거·멸실 연도','m-yearunknown':'날짜 미확인 포함','mms-gb':'철거·멸실 구분','vms-grade':'등급','v-dual-year':'건축년도','v-yearunknown':'연도 미확인 포함',mapSourceGrid:'표시할 자료','map-ms-vgrade':'빈집 등급','map-ms-hkind':'주택 종류','map-ms-purps':'용도','map-ms-strct':'구조'};
  const unlimited=new Set(['dual-flr','dual-uflr','dual-area','h-dual-hhld','h-dual-area','h-dual-year']);
  const sources={vacant:'빈집',apt:'공동주택',cond:'건축물'};
  const unknownFor={'dual-year':'c-yearunknown','h-dual-year':'h-yearunknown','h-dual-area':'h-areaunknown','mdual-year':'m-yearunknown','v-dual-year':'v-yearunknown'};
  const ordered=v=>Array.isArray(v)&&v.every(x=>typeof x==='string')?[...v].sort():v;
  const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
  function active(id,f){const source={'map-ms-vgrade':'vacant','map-ms-hkind':'apt','map-ms-purps':'cond','map-ms-strct':'cond'}[id];return !source||(f.mapSourceGrid||['vacant','apt']).includes(source);}
  function fingerprint(f){return JSON.stringify(Object.keys(f).sort().filter(id=>active(id,f)).map(id=>[id,Array.isArray(f[id])&&typeof f[id][0]==='string'?[...f[id]].sort():f[id]]));}
  function rangeText(id,v,bounds){
    const [min,max]=bounds,[a,b]=v,unit=id.includes('year')?'년':id.includes('area')?'㎡':id.includes('hhld')?'세대':'층',fmt=n=>id.includes('year')?String(n):Number(n).toLocaleString('ko-KR');
    if(a===min&&b===max)return '전체';
    if(b===max&&unlimited.has(id))return `${fmt(a)}${unit} 이상`;
    if(a===min)return `${fmt(b)}${unit} 이하`;
    return a===b?`${fmt(a)}${unit}`:`${fmt(a)}~${fmt(b)}${unit}`;
  }
  function valueText(id,v,defaults){
    if(id.endsWith('hdong'))return v==='__ALL__'?'동구 전체':v||'미선택';
    if(typeof v==='boolean')return v?'포함':'제외';
    if(Array.isArray(v)&&typeof v[0]==='number')return rangeText(id,v,defaults[id]);
    if(id==='mapSourceGrid')return v.length?v.map(k=>sources[k]||k).join('·'):'자료 미선택';
    return Array.isArray(v)?v.join('·')||'전체':String(v);
  }
  function groups(f,defaults){return Object.keys(f).filter(id=>active(id,f)&&!same(f[id],defaults[id])).map(id=>({id,label:labels[id]||id,text:`${typeof f[id]==='boolean'?(labels[id]||id).replace(/ 포함$/,''):labels[id]||id} ${valueText(id,f[id],defaults)}${unknownFor[id]&&f[unknownFor[id]]?' · 미확인 포함':''}`}));}
  function summary(f,defaults){const values=groups(f,defaults).map(g=>g.text);if(f.mapSourceGrid&&!values.some(t=>t.startsWith(labels.mapSourceGrid)))values.unshift('표시할 자료 '+valueText('mapSourceGrid',f.mapSourceGrid,defaults));return values.join(' · ')||'기본 조건 · 동구 전체';}
  function presets(tab,year,defaults){
    if(tab==='cond')return [{id:'residential',name:'공동주택',values:{'ms-purps':['공동주택']},note:'용도만 공동주택으로 설정'}, {id:'age30',name:'사용승인 30년 이상',values:{'dual-year':[defaults['dual-year'][0],year-30],'c-yearunknown':false},note:`올해(${year})−사용승인 연도 ≥ 30 · ${year-30}년 이하 · 미확인 제외. 날짜 경과·안전등급 아님`}];
    if(tab==='housing')return [{id:'apart',name:'아파트',values:{'h-ms-kind':['아파트']},note:'주택 종류만 아파트로 설정'}, {id:'large',name:'300세대 이상',values:{'h-dual-hhld':[300,defaults['h-dual-hhld'][1]]},note:'세대수 최소 300 · 상한 무제한'}];
    if(tab==='vacant')return [{id:'grade3',name:'3등급',values:{'vms-grade':['3등급']},note:'제공자료의 등급만 3등급으로 설정'}];
    if(tab==='demol')return [{id:'fiveyears',name:'최근 5개년',values:{'mdual-year':[year-4,year],'m-yearunknown':false},note:`올해 포함 ${year-4}~${year}년 · 날짜 미확인 제외`}];
    return [];
  }
  root.FilterModel={configs,labels,unlimited,active,fingerprint,rangeText,valueText,groups,summary,presets,same};
})(globalThis);
