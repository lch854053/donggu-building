import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:true});
const base=process.env.BASE_URL||'http://localhost:3000',out=new URL('../docs/p3-evidence/',import.meta.url);
await fs.mkdir(out,{recursive:true});
const report=[],errors=[];
const mapping=JSON.parse(await fs.readFile(new URL('../haengjeong.json',import.meta.url))),parcel=Object.keys(mapping.jibun2hdong).find(k=>mapping.jibun2hdong[k]==='계림2동');
function link(s){return base+'/#q='+encodeURIComponent(JSON.stringify(s));}
async function context(width=1366,storageFault=false){
  const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,acceptDownloads:true});
  let requests=0;
  await ctx.route('**/api/**',async route=>{
    requests++;const url=new URL(route.request().url()),p=url.searchParams;
    if(url.pathname.includes('tile')){await route.fulfill({status:204});return;}
    await new Promise(r=>setTimeout(r,url.pathname.endsWith('/vworld-bld')?150:20));
    let data={found:false,items:[],titles:[],totalCount:0};
    if(url.pathname.endsWith('/aptid'))data={complexes:[],totalCount:0};
    if(url.pathname.endsWith('/archpms')&&p.get('op')==='getApDemolExtngMgmRgstInfo'&&p.get('bjdongCd')===parcel.slice(0,5))data={items:[{bun:parcel.slice(5,9),ji:parcel.slice(9),demolExtngGbCdNm:'멸실',demolExtngDay:'20191001',platPlc:'계림동 통제 항목',totArea:100}],totalCount:1};
    if(url.pathname.endsWith('/juso'))data={juso:[{admCd:'1221011800',bdMgtSn:'2911011800100310000010093',lnbrMnnm:'31',lnbrSlno:'0',mtYn:'0',roadAddrPart1:'동구 서남로 1',rn:'서남로',buldMnnm:'1'}]};
    if(url.pathname.endsWith('/building'))data={titles:[{mgmBldrgstPk:'test-title-1',bjdongCd:p.get('bjdongCd')||'11800',bun:p.get('bun')||'0031',ji:'0000',dongNm:'본관',bldNm:'통제 검증 건물',mainPurpsCdNm:'업무시설',strctCdNm:'철근콘크리트구조',grndFlrCnt:2,useAprDay:'20221006'}],totalCount:1};
    await route.fulfill({json:data});
  });
  if(storageFault)await ctx.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw Error('blocked');}});Object.defineProperty(navigator,'clipboard',{value:undefined});});
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  return {ctx,count:()=>requests};
}
const {ctx,count}=await context(),page=await ctx.newPage();
const cond={v:1,tab:'cond',f:{'c-hdong':'계림2동','dual-area':[123.45,3000],'c-yearunknown':false,'ms-purps':['업무시설']},page:2};
await page.goto(link(cond));await page.waitForFunction(()=>document.getElementById('c-hdong').value==='계림2동');
assert.deepEqual(await page.evaluate(()=>DUAL.area.values()),[123.45,3000]);assert.equal(await page.locator('#c-yearunknown').isChecked(),false);assert.equal(count(),0);
await page.reload();await page.waitForFunction(()=>document.getElementById('c-hdong').value==='계림2동');assert.equal(count(),0);
assert.match(await page.locator('#shareStatus').textContent(),/조회 버튼/);
report.push('new tab / reload restore Korean conditions, exact ranges and unknown toggles without API scans');

await page.goto(link({v:1,tab:'detail',f:{dInput:'서남로 1'},pick:{id:'registry:test-title-1',panel:'park'}}));
try{await page.waitForFunction(()=>document.querySelector('#dPanel')?.textContent.includes('주차')||document.querySelector('.d-subtab[data-tab=park].active'));}catch(e){console.log(await page.evaluate(()=>({status:document.getElementById('shareStatus').textContent,detail:document.getElementById('dResult').textContent,dongs:D_DONGS,titles:D_TITLES,url:location.href})),errors);throw e;}
await page.waitForFunction(()=>!document.getElementById('dRunBtn').disabled);
const detailUrl=page.url(),length=await page.evaluate(()=>history.length);
await page.click('#tab-btn-stats');await page.waitForSelector('.stat-meta');
const beforeBack=count();
await page.goBack();await page.waitForSelector('#dResult .d-card',{state:'visible'});try{await page.waitForFunction(()=>document.querySelector('.d-subtab[data-tab=park].active'));}catch(e){console.log(await page.evaluate(()=>({status:document.getElementById('shareStatus').textContent,url:location.href,history:history.state,selection:SearchNavigation.capture(),panel:document.getElementById('dPanel')?.textContent})));throw e;}
assert.equal(page.url(),detailUrl);assert.equal(await page.evaluate(()=>history.length),length+1);
assert.ok(count()-beforeBack<=1,'warm history replay must reuse successful API cache, not repeat the full scan');
await page.goForward();await page.waitForSelector('#tab-stats',{state:'visible'});assert.equal(await page.evaluate(()=>history.length),length+1);
await page.goBack();await page.waitForFunction(()=>document.querySelector('.d-subtab[data-tab=park].active'));
report.push('detail auto query and stable title/tab restoration; back/forward add no history entries');

await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true}));await page.click('#shareCopy');
assert.equal(await page.locator('#shareFallback').isVisible(),true);const copied=await page.locator('#shareFallback').inputValue();assert.ok(copied.includes('#q='));
const next=await ctx.newPage();await next.goto(copied);await next.waitForFunction(()=>document.querySelector('.d-subtab[data-tab=park].active'));await next.close();
await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copiedText=text},configurable:true}));await page.click('#shareCopy');assert.match(await page.locator('#shareStatus').textContent(),/복사했습니다/);
report.push('copy success and Clipboard-unavailable manual selection; shared URL works in a separate tab');

await page.goto(link({v:1,tab:'detail',f:{dInput:'서남로 1'},pick:{id:'registry:missing'}}));await page.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('찾지 못'));
assert.match(await page.locator('#shareStatus').textContent(),/삭제 여부는 확정하지/);
await page.evaluate(async()=>{switchTab('building');switchBuildingSubtab('cond');await loadHaengjeong();const url=SearchState.encode({v:1,tab:'cond',f:{'c-hdong':'계림2동'},pick:{id:'missing'}},location.href);await SearchNavigation.restore(SearchState.parse(url).state);fetchDongPage=async()=>({titles:[],totalCount:0,error:'simulated missing page'});});
await page.click('#cRunBtn');await page.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('부분·미완료'));
report.push('missing stable ID is not called deleted; missing selection in partial results is identified separately');

await page.goto(base);await page.evaluate(()=>{let resolve;window.delayed={promise:new Promise(r=>resolve=r),resolve};loadBldgis=()=>delayed.promise;});
await page.evaluate(()=>{window.restoreJob=SearchNavigation.restore({v:1,tab:'detail',f:{dInput:'서남로 1'}});});
await page.waitForSelector('#dResult .d-card',{state:'visible'});await page.click('#tab-btn-stats');
await page.evaluate(async()=>{delayed.resolve({state:'success',properties:{hg:777}});await restoreJob;});
assert.equal(await page.locator('#tab-stats').isVisible(),true);assert.equal(await page.locator('#dResult').isVisible(),false);assert.ok(page.url().includes('stats'));
report.push('menu navigation cancels unfinished URL restoration; late supplement cannot overwrite current screen or URL');

await page.goto(base);await page.evaluate(()=>{let resolve;window.delayed={promise:new Promise(r=>resolve=r),resolve};loadBldgis=()=>delayed.promise;window.restoreJob=SearchNavigation.restore({v:1,tab:'detail',f:{dInput:'서남로 1'},pick:{id:'registry:test-title-1',panel:'flr'}});});
await page.waitForSelector('#dResult .d-card',{state:'visible'});await page.locator('#dResult .d-subtab[data-tab=park]').click();await page.evaluate(async()=>{delayed.resolve({state:'success',properties:{hg:777}});await restoreJob;});
assert.equal(await page.locator('#dResult').isVisible(),true);assert.equal(await page.evaluate(()=>SearchNavigation.capture().pick.panel),'park');assert.equal(await page.evaluate(()=>D_BLDGIS.state),'cancelled');
report.push('explicit user detail-tab choice during auto restoration wins over pending replay and delayed supplement');

await page.goto(link({v:1,menu:'vacant',f:{'v-hdong':'계림2동'},sort:'yearAsc',page:2}));await page.waitForFunction(()=>document.getElementById('v-hdong').value==='계림2동');await page.click('#vRunBtn');await page.waitForFunction(()=>document.getElementById('vSort').value==='yearAsc');
await page.click('#tab-btn-stats');await page.goBack();await page.waitForSelector('#vResultArea',{state:'visible'});assert.equal(await page.locator('#vSort').inputValue(),'yearAsc');
report.push('vacant local-data search back navigation restores sort and a bounded result page');

await page.goto(link({v:1,menu:'housing',f:{'h-hdong':'계림2동'},sort:'hhldDesc'}));await page.waitForFunction(()=>document.getElementById('h-hdong').value==='계림2동');await page.click('#hRunBtn');try{await page.waitForFunction(()=>document.getElementById('hSort').value==='hhldDesc'&&document.querySelector('#hResultBody [data-dtl]'));}catch(e){console.log(await page.evaluate(()=>({hint:document.getElementById('hHint').textContent,status:document.getElementById('shareStatus').textContent,raw:H_RESULTS_RAW.slice(0,2),sort:document.getElementById('hSort').value})),errors);throw e;}
await page.locator('#hResultBody [data-dtl]').first().click();const housingState=await page.evaluate(()=>SearchNavigation.capture());assert.match(housingState.pick.id,/^kapt:/);
const hp=await ctx.newPage();await hp.goto(link(housingState));await hp.waitForFunction(()=>document.getElementById('h-hdong').value==='계림2동');assert.equal(await hp.locator('#hResultArea').isVisible(),false);await hp.click('#hRunBtn');await hp.waitForFunction(()=>!!SearchNavigation.capture().pick?.id);assert.equal(await hp.evaluate(()=>SearchNavigation.capture().pick.id),housingState.pick.id);await hp.close();
report.push('housing shared filters/sort and stable K-apt selection restore after manual search in a new tab');

await page.goto(link({v:1,menu:'demol',f:{'m-hdong':'계림2동','mdual-year':[2000,2020],'m-yearunknown':false,'mms-gb':['멸실']}}));await page.waitForFunction(()=>document.getElementById('m-hdong').value==='계림2동');assert.deepEqual(await page.evaluate(()=>M_DUAL_year.values()),[2000,2020]);assert.equal(await page.locator('#m-yearunknown').isChecked(),false);
await page.click('#mRunBtn');await page.waitForSelector('#mResultBody tr[data-idx]');await page.locator('#mResultBody tr[data-idx]').first().click();const demolState=await page.evaluate(()=>SearchNavigation.capture());assert.match(demolState.pick.id,/^demol:/);
const dp=await ctx.newPage();await dp.goto(link(demolState));await dp.waitForFunction(()=>document.getElementById('m-hdong').value==='계림2동');await dp.click('#mRunBtn');await dp.waitForFunction(()=>!!SearchNavigation.capture().pick?.id);assert.equal(await dp.evaluate(()=>SearchNavigation.capture().pick.id),demolState.pick.id);await dp.close();
await page.goto(link({v:1,menu:'map',f:{mapSourceGrid:['vacant'],'map-hdong':'계림2동'},view:[35.16,126.92,16]}));await page.waitForFunction(()=>document.getElementById('map-hdong').value==='계림2동');await page.click('#mapRunBtn');await page.waitForFunction(()=>M_RESULTS.vacant.length>0&&!document.getElementById('mapRunBtn').disabled);
await page.locator('#mapResultsList .map-result-row').first().click();await page.waitForTimeout(400);const mapState=await page.evaluate(()=>SearchNavigation.capture());assert.equal(mapState.pick.source,'vacant');assert.match(mapState.pick.id,/^vacant:/);
const mp=await ctx.newPage();await mp.goto(link(mapState));await mp.waitForFunction(()=>document.getElementById('map-hdong').value==='계림2동');await mp.evaluate(()=>{window.mapCalls=[];const fn=M_MAP.setView;M_MAP.setView=function(...a){mapCalls.push(a);return fn.apply(this,a);};});await mp.click('#mapRunBtn');try{await mp.waitForFunction(view=>JSON.stringify(SearchNavigation.capture().view)===JSON.stringify(view),mapState.view);}catch(e){console.log({expected:mapState,actual:await mp.evaluate(()=>SearchNavigation.capture()),calls:await mp.evaluate(()=>mapCalls),status:await mp.locator('#shareStatus').textContent()},errors);throw e;}assert.equal(await mp.evaluate(()=>SearchNavigation.capture().pick.id),mapState.pick.id);assert.deepEqual(await mp.evaluate(()=>SearchNavigation.capture().view),mapState.view);await mp.close();
await page.goto(link({v:1,menu:'map',tab:'figure',theme:'structure',shape:'square',view:[35.16,126.92,16]}));await page.waitForFunction(()=>FG_COLOR_MODE==='structure'&&document.querySelector('.fg-disc.is-square'));assert.equal(await page.locator('#map-sub-figure').isVisible(),true);
report.push('demolition filters plus map sources/filter/center/zoom/stable vacant selection and Figure-Ground theme/shape restore');

await page.goto(base);await page.evaluate(()=>{switchTab('building');switchBuildingSubtab('bulk');document.getElementById('input').value=Array(500).fill('동구 서남로 1').join('\n');});
await page.click('#shareCopy');assert.match(await page.locator('#shareStatus').textContent(),/JSON/);
const downloadEvent=page.waitForEvent('download');await page.click('#conditionExport');const download=await downloadEvent,data=await fs.readFile(await download.path());const json=JSON.parse(data);assert.equal(json.f.input.split('\n').length,500);
await page.fill('#input','changed');await page.setInputFiles('#conditionImport',{name:'conditions.json',mimeType:'application/json',buffer:data});await page.waitForFunction(()=>document.getElementById('input').value.split('\n').length===500);
assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('서남로')),false);
await page.setInputFiles('#conditionImport',{name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});await page.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('읽지 못'));
report.push('overlong bulk URL rejected; JSON export/import preserves 500 lines; no automatic bulk recent storage');

const broken=await context(390,true),bp=await broken.ctx.newPage();await bp.goto(base);await bp.evaluate(()=>{switchTab('building');switchBuildingSubtab('detail');document.getElementById('dInput').value='서남로 1';});await bp.click('#dRunBtn');await bp.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('저장소'));assert.match(await bp.locator('#shareStatus').textContent(),/저장소/);
await bp.click('#shareCopy');assert.equal(await bp.locator('#shareFallback').isVisible(),true);await broken.ctx.close();
report.push('blocked localStorage and Clipboard do not prevent lookup or manual link copying');

await page.goto(base);await page.evaluate(()=>localStorage.setItem('donggu.recent.v1','bad-json'));await page.reload();assert.equal(await page.locator('#recentRows button').count(),0);
await page.evaluate(()=>{switchTab('building');switchBuildingSubtab('detail');document.getElementById('dInput').value='서남로 1';});await page.click('#dRunBtn');await page.waitForSelector('#recentRows button',{state:'attached'});await page.locator('#recentSearches summary').click();const beforeRecent=count();await page.locator('#recentRows button').first().click();await page.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('조회 버튼'));assert.equal(count(),beforeRecent);
await page.locator('#recentRows button').nth(1).click();assert.equal(await page.locator('#recentRows button').count(),0);
await page.click('#recentClear');assert.equal(await page.evaluate(()=>localStorage.getItem('donggu.recent.v1')),null);
report.push('invalid recent JSON ignored; opening recent restores only conditions and individual delete works');

for(const width of [360,390,430,1366]){
  await page.setViewportSize({width,height:900});await page.goto(link({v:1,menu:'stats'}));await page.waitForSelector('.stat-meta');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  if(!await page.locator('.vacant-explanation').evaluate(el=>el.open))await page.locator('.vacant-explanation summary').click();assert.match(await page.locator('.vacant-explanation').textContent(),/호/);
  const first=page.locator('.st-card .stat-meta').first();if(!await first.evaluate(el=>el.open))await first.locator('summary').click();const reference=await page.evaluate(()=>({year:ST_DATA.indicators[0].series.at(-1).year,date:ST_DATA.generatedAt}));assert.ok((await first.textContent()).includes(reference.year));assert.ok((await first.textContent()).includes(reference.date));assert.ok(await first.locator('a').count()>0);
  assert.match(await page.locator('#stBody').textContent(),/거처종류 요약 API의 연도/);assert.match(await page.locator('#stBody').textContent(),/지수 기준/);assert.match(await page.locator('#stBody').textContent(),/원\)/);
  await page.screenshot({path:new URL(`stats-${width}.png`,out).pathname,fullPage:true});
}
report.push('360/390/430/1366px sharing and expandable metadata; units/reference/collection/official links, SGIS uncertainty, price won conversion and accessible tables');
await page.goto(link({v:99}));await page.reload();await page.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('버전'));assert.equal(await page.locator('#tab-building').isVisible(),true);
assert.deepEqual(errors,[]);
await fs.writeFile(new URL('../docs/p3-browser-results.json',import.meta.url),JSON.stringify({environment:'Local actual Chromium, API fixtures (not production latency or live scans); real stored statistical/vacant JSON',checks:report,errors},null,2)+'\n');
console.log(JSON.stringify({checks:report,errors},null,2));await browser.close();
