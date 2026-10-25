/* Official documentation checked 2026-10-25. Unknown provenance is never inferred. */
(function(root){
  const sources={
    vacant:'https://www.data.go.kr/data/15144631/fileData.do',
    census:'https://kosis.kr/civilComplaint/qnaDetail.do?boardIdx=24389',
    sgis:'https://sgis.mods.go.kr/developer/html/openApi/api/data.html',
    reb:'https://www.reb.or.kr/reb/cm/cntnts/cntntsView.do?mi=10333&cntntsId=1033&statId=S234820263',
    empty:'https://www.reb.or.kr/reb/cm/cntnts/cntntsView.do?mi=9872&cntntsId=1239',
    rone:'https://www.reb.or.kr/r-one/portal/stat/statMain.do'
  };
  const definitions={
    vacant_ratio:['조사 기준일에 사람이 살지 않는 주택의 비율. 신축·매매·임대·이사 등에 따른 일시적 미거주도 포함합니다.','인구주택총조사 미거주주택 / 전체주택 × 100','% · 보조 수 미거주주택: 호','연간 · 해당 연도 11월 1일 기준'],
    oldhouse_ratio:['건축 후 30년 이상 지난 주택의 비율. 건물의 안전등급을 뜻하지 않습니다.','전체주택 중 30년 이상 주택 (세부 산입기준은 통계표 주석 확인)','% · 보조 수 노후주택: 호','연간'],
    houses:['인구주택총조사에서 집계한 주택 수. 건축물대장의 동 수나 거주가구 수와 다릅니다.','인구주택총조사 주택','호','연간']
  };
  function metadata(kind,ind={},dataset={}){
    const base={name:ind.name||'거처 유형 구성',region:dataset.region||dataset.admNm||'동구',collected:dataset.generatedAt||'미확인',checkedAt:'2026-10-25',caution:'서로 다른 모집단·기준시점·단위를 직접 비교하거나 비율 계산에 혼합하지 마세요. 수집일은 조사일이 아닙니다. 공식 최신 자료 여부는 별도 확인이 필요합니다.'};
    if(kind==='kosis'){
      const def=definitions[ind.id]||['정의 확인 필요','대상 확인 필요',ind.unit||'확인 필요','확인 필요'];
      return {...base,description:def[0],population:def[1],unit:def[2],cycle:def[3],period:ind.series?.at(-1)?.year||'확인 필요',provider:'국가데이터처 · KOSIS e-지방지표',tableId:ind.tblId||'확인 필요',url:ind.tblId?`https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=${encodeURIComponent(ind.tblId)}`:sources.census,definitionUrl:ind.id==='vacant_ratio'?sources.census:null,sourceUpdated:ind.lstChnDe||'미확인'};
    }
    if(kind==='sgis')return {...base,description:'행정구역 내 거처 유형별 거주가구 수와 비율. 빈집 수나 주택 재고 수가 아닙니다.',population:'거처 종류별 거주가구 (아파트·단독·연립/다세대·오피스텔·기숙사/사회시설·기타)',unit:'가구 · %',cycle:'API 응답의 기준연도·갱신주기 확인 필요',period:dataset.summaryReferenceYear||'확인 필요 — 거처종류 요약 API의 연도 인자/응답 기준연도 미확인',provider:'국가데이터처 · SGIS',url:sources.sgis,sourceUpdated:'미확인'};
    const index=ind.unit==='지수',price=ind.unit==='천원',trade=ind.unit==='건',quarter=ind.cycle==='QY';
    return {...base,description:index?'기준시점 대비 가격 수준을 나타내는 지수. 원 단위 가격이 아닙니다.':price?(ind.id?.includes('median')?'표본 가격을 순서대로 놓았을 때 가운데 가격.':'표본 가격의 산술평균.'):(trade?'부동산거래현황 API의 거래 집계. 거래 종류·신고/발생 기준의 세부 주석은 원본표에서 확인하세요.':'아파트 표본의 매매가격 대비 전세가격 비율.'),population:trade?'원본 표의 주택/아파트/건축물 거래 집계 (서로 중첩 가능)':ind.id?.startsWith('housing_')?'전국주택가격동향조사 주택종합 표본':'전국주택가격동향조사 아파트 표본',unit:ind.unit||'확인 필요',period:ind.series?.at(-1)?.label||'확인 필요',cycle:quarter?'분기별 (원본 표 기준)':'월별 · 발표 시차 있음',provider:'한국부동산원 · R-ONE',url:ind.statblId?`${sources.rone}?statblId=${encodeURIComponent(ind.statblId)}`:sources.rone,definitionUrl:sources.reb,sourceUpdated:'미확인',indexBase:index?(ind.indexBase||'확인 필요 — 보관 API 자료의 기준시점 미수록. 공식 설명은 2026년 7월 월간 2026.6=100 개편을 안내하지만 이 보관 시계열에 적용됐는지는 미확인입니다.'):null,caution:base.caution+(price?' 평균·중위가격은 표본 구성 변경에 민감하여 지수 변동률과 다를 수 있습니다.':'')};
  }
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function details(kind,ind,dataset){
    const m=metadata(kind,ind,dataset);
    return `<details class="stat-meta"><summary>의미·단위·시점·출처</summary><dl>${[['지표',m.name],['쉬운 설명',m.description],['조사·집계 대상',m.population],['단위',m.unit],['지역',m.region],['자료 기준시점',m.period],['수집일',m.collected],['원본 갱신일',m.sourceUpdated],['갱신 주기',m.cycle],['지수 기준',m.indexBase],['제공기관',m.provider],['원본표 ID',m.tableId||ind?.statblId],['해석 주의',m.caution]].filter(([,v])=>v!=null).map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">원본 통계·자료</a>${m.definitionUrl?` · <a href="${esc(m.definitionUrl)}" target="_blank" rel="noopener noreferrer">공식 정의</a>`:''}</details>`;
  }
  function table(name,unit,rows){return `<details class="stat-values"><summary>${esc(name)} 수치표 · ${esc(unit)}</summary><div class="table-wrap"><table><caption>${esc(name)} — ${esc(unit)}</caption><thead><tr><th scope="col">자료 시점</th><th scope="col">값 (${esc(unit)})</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${esc(r.label||r.year||r.period)}</th><td>${r.value==null?'미확인':esc(Number(r.value).toLocaleString('ko-KR',{maximumFractionDigits:8}))}</td></tr>`).join('')}</tbody></table></div></details>`;}
  function comparison(){return `<details class="stat-meta vacant-explanation"><summary>빈집현황과 미거주주택 통계는 왜 다른가요?</summary><p>동구 빈집현황은 행정 제공자료의 원본 레코드(건)입니다. 개별 건물·호·필지 수로 확정하지 않습니다. 인구주택총조사의 미거주주택은 해당 연도 11월 1일 사람이 살지 않는 주택(호)으로 일시적인 미거주도 포함합니다.</p><p>법령상 빈집은 1년 이상 거주·사용하지 않는 주택을 대상으로 하며 제외 대상도 있습니다. 다만 이 동구 제공파일의 법정 조사 포함·제외기준 전체는 확인 필요입니다. 모집단·기준일·단위가 다르므로 두 값을 빼거나 같은 분모의 비율로 해석하지 마세요.</p><a href="${sources.vacant}" target="_blank" rel="noopener noreferrer">동구 제공파일</a> · <a href="${sources.census}" target="_blank" rel="noopener noreferrer">총조사 공식 정의</a> · <a href="${sources.empty}" target="_blank" rel="noopener noreferrer">빈집실태조사 정의</a></details>`;}
  function vacantDetails(records){const dates=[...new Set(records.map(r=>r.baseDate).filter(Boolean))].sort(),collected=[...new Set(records.map(r=>r.collectedAt).filter(Boolean))].sort();return comparison()+`<details class="stat-meta"><summary>행정 빈집자료의 단위·시점·출처</summary><dl><dt>단위·대상</dt><dd>동구 제공 빈집현황 원본 레코드(건). 건물·호·필지 수는 확정하지 않음</dd><dt>자료 기준일</dt><dd>${esc(dates.join(', ')||'미확인')}</dd><dt>수집일</dt><dd>${esc(collected.join(', ')||'미확인 — 기존 자료에 기록 없음')}</dd><dt>제공기관</dt><dd>동구 · 공공데이터포털</dd><dt>갱신 주기</dt><dd>제공파일 메타데이터 기준 연간. 실제 조사·발표 시차와 최신 제공 여부는 원본에서 확인</dd></dl><a href="${sources.vacant}" target="_blank" rel="noopener noreferrer">원본 자료와 제공 기준</a></details>`;}
  root.StatsMetadata={sources,metadata,details,table,comparison,vacantDetails};
})(globalThis);
