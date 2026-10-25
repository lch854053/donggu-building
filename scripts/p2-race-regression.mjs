import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:true});
const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const checks=[];
async function setup(){
  await page.goto('http://localhost:3000');
  await page.evaluate(()=>{
    const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
    window.testState={hs:deferred(),title:deferred(),calls:[],failHs:false,failTitle:false};
    HJ_H=HJ={hdong2bjd:{'계림2동':['10900','11000'],'서남동':['11800']},jibun2hdong:{'1090000010000':'계림2동','1090000020000':'계림2동','1090000030000':'계림2동'}};
    const hhlds=[10,30,20];
    const catalog=hhlds.map((hhld,i)=>({pnu:`29110109001000${i+1}0000`,kaptCode:'K'+i,kaptName:'측정 아파트 '+i,
      bass:{kaptName:'측정 아파트 '+i,hoCnt:hhld,kaptDongCnt:1,kaptAddr:'계림동 '+(i+1),codeAptNm:'아파트'},dtl:{}}));
    const original=fetch;
    window.fetch=async(input,options)=>{
      const path=String(input),s=testState;
      if(path==='/aptlist_donggu.json')return s?.failKapt?new Response('{}',{status:503}):Response.json(catalog);
      if(path==='/aptlist_extra_donggu.json'||path==='/aptlist_odcloud_donggu.json')return Response.json([]);
      if(path.startsWith('/api/')){
        const url=new URL(path,location.origin),p=url.searchParams;s.calls.push({path:url.pathname,op:p.get('op'),bjd:p.get('bjdongCd'),bun:p.get('bun')});
        if(url.pathname==='/api/aptid')return Response.json({complexes:catalog.map((r,i)=>({pnu:r.pnu,complexNm:r.kaptName,complexGbCd:'1',unitCnt:hhlds[i],dongCnt:1})),totalCount:3});
        if(url.pathname==='/api/archpms'){
          if(p.get('bjdongCd')==='10900')await s.hs.promise;
          if(p.get('bjdongCd')==='11000'&&s.failHs)return new Response('{}',{status:403});
          if(p.get('bjdongCd')==='11000'&&s.addHs)return Response.json({items:[{hstpGbCdNm:'오피스텔',bjdongCd:'11000',bun:'0004',ji:'0000',silHoHhldCnt:5,bldNm:'새 보충 단지'}],totalCount:1});
          return Response.json({items:[],totalCount:0});
        }
        if(url.pathname==='/api/building'){
          await s.title.promise;
          if(p.get('bun')==='0002'&&s.failTitle)return new Response('{}',{status:403});
          return Response.json({titles:[{bldNm:'측정 건물',totArea:100,useAprDay:p.get('bun')==='0003'?'19900101':'20221006',mainAtchGbCdNm:'주건축물'}],totalCount:1});
        }
        return Response.json({items:[],totalCount:0});
      }
      return original(input,options);
    };
    initHousingFilters();fillHousingHdong();document.getElementById('h-hdong').value='계림2동';
    fetchHspmsComplex=async()=>null;
    switchTab('housing');
  });
}

await setup();
await page.fill('#h-dual-year-min','2020');await page.locator('#h-dual-year-min').press('Tab');
await page.locator('#h-yearunknown').uncheck();
await page.evaluate(()=>{window.job=runHousingSearch();});
await page.waitForFunction(()=>H_RESULTS_RAW.length===3 && document.getElementById('hResultArea').style.display==='block');
assert.match(await page.locator('#hHint').textContent(),/잠정/);
await page.selectOption('#hSort','hhldDesc');
await page.locator('#hResultBody [data-dtl=K1]').click();
await page.evaluate(()=>{XLSX.writeFile=wb=>window.exported=wb;exportHousingExcel();});
assert.match(await page.evaluate(()=>JSON.stringify(XLSX.utils.sheet_to_json(exported.Sheets['조회정보'],{header:1}))),/보강 중/);
await page.evaluate(()=>{testState.hs.resolve();testState.title.resolve();});await page.evaluate(()=>job);
assert.deepEqual(await page.evaluate(()=>HRESULTS.map(r=>r.hhld)),[30,10]);
assert.equal(await page.locator('#hs-hhld').textContent(),'40');
assert.equal(await page.locator('#hResultBody tr.h-detail-row').count(),1);
assert.equal(await page.locator('#hResultBody .h-name.active').getAttribute('data-dtl'),'K1');
assert.deepEqual(await page.evaluate(()=>[...new Set(testState.calls.filter(r=>r.op==='getApHsTpInfo').map(r=>r.bjd))].sort()),['10900','11000']);
checks.push('housing provisional export, final year filtering / sort / counts / selected detail preserved; selected legal-dong scope complete');

await setup();await page.evaluate(()=>{testState.failHs=true;testState.hs.resolve();testState.title.resolve();window.job=runHousingSearch();});await page.evaluate(()=>job);
assert.match(await page.locator('#query-status-housing').textContent(),/부분 조회/);
await page.evaluate(()=>{testState.failHs=false;});
await page.locator('#query-status-housing button').click();await page.waitForFunction(()=>QUERY_SESSIONS.get('housing').ledger.failed().length===0 && !QUERY_SESSIONS.get('housing').retrying);
assert.deepEqual(await page.evaluate(()=>testState.calls.filter(r=>r.op==='getApHsTpInfo').map(r=>r.bjd)),['10900','11000','11000']);
checks.push('housing partial page recovery retries only the failed range');

await setup();await page.evaluate(()=>{testState.failHs=true;testState.hs.resolve();testState.title.resolve();window.job=runHousingSearch();});await page.evaluate(()=>job);
const originalRows=await page.evaluate(()=>H_RESULTS_RAW.map(row=>row.pnu));
await page.evaluate(()=>{testState.failHs=false;testState.addHs=true;let resolve;testState.title={promise:new Promise(r=>resolve=r),resolve};});
await page.locator('#query-status-housing button').click();
await page.waitForFunction(()=>testState.calls.some(call=>call.path==='/api/building' && call.bun==='0004'));
await page.fill('#h-dual-year-min','2023');await page.locator('#h-dual-year-min').press('Tab');
await page.evaluate(()=>testState.title.resolve());await page.waitForFunction(()=>!QUERY_SESSIONS.get('housing').retrying);
assert.deepEqual(await page.evaluate(()=>H_RESULTS_RAW.map(row=>row.pnu)),originalRows);
assert.equal(await page.evaluate(()=>H_LAST_QUERY.ledger.failed().length),1);
assert.match(await page.locator('#query-status-housing').textContent(),/조건 변경 전/);
checks.push('filter change during asynchronous retry enrichment does not commit recovered rows or metadata');

await setup();await page.evaluate(()=>{testState.failKapt=true;testState.hs.resolve();testState.title.resolve();window.job=runHousingSearch();});await page.evaluate(()=>job);
assert.equal(await page.evaluate(()=>H_RESULTS_RAW.length),3);
assert.match(await page.locator('#hHint').textContent(),/K-apt 정적 목록.*불러오지 못함/);
assert.match(await page.evaluate(()=>H_PROGRESS_STATE),/부분 조회/);
checks.push('failed supplementary catalog preserves base rows and is not reported as complete or empty');

await setup();await page.evaluate(()=>{testState.failTitle=true;testState.hs.resolve();testState.title.resolve();window.job=runHousingSearch();});await page.evaluate(()=>job);
assert.equal(await page.evaluate(()=>H_LAST_QUERY.enrichmentFailures.length),1);
await page.evaluate(()=>testState.failTitle=false);
await page.locator('#hHint button').click();await page.waitForFunction(()=>H_LAST_QUERY.enrichmentFailures.length===0);
assert.deepEqual(await page.evaluate(()=>testState.calls.filter(r=>r.path==='/api/building').map(r=>r.bun).sort()),['0001','0002','0002','0003']);
checks.push('title supplement recovery retries only failed PNU, preserving successful rows');

await setup();await page.evaluate(()=>{window.oldJob=runHousingSearch();});await page.waitForFunction(()=>H_RESULTS_RAW.length===3);
await page.click('#cancel-housing');assert.match(await page.locator('#hHint').textContent(),/취소/);
await page.evaluate(async()=>{document.getElementById('h-hdong').value='서남동';await runHousingSearch();testState.hs.resolve();testState.title.resolve();await oldJob;});
assert.equal(await page.locator('#hResDong').textContent(),'서남동');assert.equal(await page.evaluate(()=>H_RESULTS_RAW.length),0);
checks.push('housing cancellation and subsequent search block old enrichment / cache-owner updates');

await setup();await page.evaluate(()=>{
  switchTab('building');switchBuildingSubtab('detail');document.getElementById('dInput').value='서남로 1';
  searchJuso=async()=>[];resolveByCandidates=async()=>({titles:[{bldNm:'기본 카드'}],usedParams:{sigunguCd:'29110',bjdongCd:'11800',bun:'0031',ji:'0000'}});
  loadBldgis=()=>testState.title.promise;loadLdaData=async()=>({state:'empty'});window.job=runDetail();
});await page.waitForSelector('#dResult .d-card',{state:'visible'});await page.click('#cancel-detail');
await page.evaluate(async()=>{testState.title.resolve({state:'success',properties:{hg:99}});await job;});
assert.equal(await page.evaluate(()=>D_BLDGIS.state),'cancelled');assert.doesNotMatch(await page.locator('#dResult').textContent(),/99 m/);
checks.push('detail cancellation retains base card and blocks late supplement slot writes');

await setup();await page.evaluate(async()=>{
  switchTab('building');switchBuildingSubtab('cond');await loadHaengjeong();document.getElementById('c-hdong').value='계림2동';
  HDONG2JIBUN={};BJD_PARCELS={};fetchDongPage=async(bjd,pg)=>bjd==='11000'?{titles:[],totalCount:0}:pg===1?{titles:[{bjdongCd:bjd,bun:'0001',ji:'0000',bldNm:'첫 결과'},{bjdongCd:bjd,bun:'0002',ji:'0000'}],totalCount:4}:testState.title.promise;
  window.job=runConditionSearch();
});await page.waitForFunction(()=>CRESULTS.length===2);await page.click('#cancel-condition');
await page.evaluate(async()=>{testState.title.resolve({titles:[{bldNm:'늦은 결과'}],totalCount:4});await job;});
assert.equal(await page.locator('#cResultArea').isVisible(),false);assert.match(await page.locator('#cHint').textContent(),/취소/);
checks.push('condition cancellation blocks late pages and provisional render timers');

await setup();await page.evaluate(()=>{
  M_LAYER.cond={clearLayers(){}};M_RESULTS.cond=[{bldNm:'이전 검색'}];document.getElementById('mapResultsWrap').style.display='';
  fetchDongPage=()=>testState.title.promise;window.job=runCondForMap('계림2동');
});assert.equal(await page.evaluate(()=>M_RESULTS.cond.length),0);assert.equal(await page.locator('#mapResultsWrap').isVisible(),false);
await page.evaluate(()=>cancelSearch('map'));
await page.evaluate(async()=>{testState.title.resolve({titles:[{bjdongCd:'10900',bun:'0001',ji:'0000',bldNm:'늦은 지도'}],totalCount:1});await job;});
assert.equal(await page.evaluate(()=>M_RESULTS.cond.length),0);assert.match(await page.locator('#mapHint').textContent(),/취소/);
checks.push('map new search hides old list immediately; cancelled data cannot repopulate it');
assert.deepEqual(errors,[]);
await fs.writeFile(new URL('../docs/p2-race-results.json',import.meta.url),JSON.stringify({environment:'Chromium desktop, controlled delayed/failing responses; no live API scan',checks,errors},null,2)+'\n');
console.log(JSON.stringify({checks,errors},null,2));await browser.close();
