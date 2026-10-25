import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const phase=process.argv[2]||'after',root=new URL('../',import.meta.url),out=new URL('docs/ui-stage1-evidence/',root);
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:true});
const reports=[];
for(const width of [360,390,430,1366]){
  const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.fulfill({json:{items:[],titles:[],totalCount:0,found:false}}));
  await page.goto(process.env.BASE_URL||'http://localhost:3000');
  await page.screenshot({path:new URL(`${phase}-${width}.png`,out).pathname,fullPage:true});
  const metrics=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,tab:B_SUBTAB,searchTop:document.getElementById(B_SUBTAB==='detail'?'dInput':'input').getBoundingClientRect().top,toolsTop:document.querySelector('.share-tools').getBoundingClientRect().top}));
  if(phase==='after'){
    assert.equal(metrics.tab,'detail');assert.ok(metrics.searchTop<metrics.toolsTop);assert.ok(metrics.document<=width+1);assert.equal(await page.locator('#conditionImport').isVisible(),false);assert.equal(await page.locator('#cancel-detail').isVisible(),false);
    await page.locator('#conditionTools summary').focus();await page.locator('#conditionTools summary').press('Enter');await page.waitForFunction(()=>document.querySelector('#conditionTools summary').getAttribute('aria-expanded')==='true');
    assert.equal(await page.locator('#conditionImportButton').isVisible(),true);assert.equal(await page.locator('#conditionImport').isVisible(),false);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:new URL(`after-tools-${width}.png`,out).pathname,fullPage:true});await page.locator('#conditionTools summary').press('Enter');assert.equal(await page.locator('#conditionTools summary').evaluate(el=>el===document.activeElement),true);
  }
  reports.push({width,phase,mode:width<500?'Chromium touch/mobile emulation (not physical phone)':'Chromium desktop',metrics,errors});await ctx.close();
}
if(phase==='after'){
  const fixture=JSON.parse(await fs.readFile(new URL('test/fixtures/ui-stage1-seonam-titles.json',root))),ctx=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true}),page=await ctx.newPage(),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  let mode='normal';
  await page.route('**/api/**',async route=>{
    const u=new URL(route.request().url());
    await new Promise(r=>setTimeout(r,u.pathname.endsWith('/vworld-bld')?250:50));
    let data={items:[],titles:[],totalCount:0,found:false};
    if(u.pathname.endsWith('/juso'))data={juso:[{admCd:'1221011800',bdMgtSn:'2911011800100310000010093',lnbrMnnm:'31',lnbrSlno:'0',mtYn:'0',roadAddrPart1:'전남광주통합특별시 동구 서남로 1',rn:'서남로',buldMnnm:'1'}]};
    if(u.pathname.endsWith('/building'))data=mode==='empty'?{titles:[],totalCount:0}:{titles:fixture.titles,totalCount:3};
    if(mode==='failure'&&u.pathname.endsWith('/juso')){await route.fulfill({status:403,json:{error:'controlled failure'}});return;}
    await route.fulfill({json:data});
  });
  const base=process.env.BASE_URL||'http://localhost:3000',link=s=>base+'/#q='+encodeURIComponent(JSON.stringify(s));
  async function settled(){await page.waitForFunction(()=>!UI_QUERY_ACTIVITY.size);}
  function current(){return page.evaluate(()=>({menu:[...document.querySelectorAll('.tab.active')].map(x=>x.id),aria:[...document.querySelectorAll('.tab[aria-current=page]')].map(x=>x.id),sub:[...document.querySelectorAll('[data-sub].active')].map(x=>x.dataset.sub),subAria:[...document.querySelectorAll('[data-sub][aria-current=page]')].map(x=>x.dataset.sub),title:document.title}));}
  async function ensureCurrent(){const s=await current();assert.deepEqual(s.menu,s.aria);assert.deepEqual(s.sub,s.subAria);}
  async function openTools(){if(!await page.locator('#conditionTools').evaluate(el=>el.open))await page.locator('#conditionTools summary').click();}
  await page.goto(base);assert.equal(await page.evaluate(()=>B_SUBTAB),'detail');assert.match(await page.title(),/주소로 찾기/);await ensureCurrent();
  await page.goto(link({v:1,f:{input:'서남로 1\n충장로 1'}}));await page.waitForFunction(()=>B_SUBTAB==='bulk');assert.equal(await page.locator('#input').inputValue(),'서남로 1\n충장로 1');await page.reload();await page.waitForFunction(()=>B_SUBTAB==='bulk');await ensureCurrent();
  checks.push('first visit detail; omitted-tab v1 bulk links retain addresses across reload');
  await page.goto(link({v:1,tab:'detail',f:{dInput:'서남로 1'}}));await page.waitForSelector('#dDongCard',{state:'visible'});assert.equal(await page.evaluate(()=>D_SELECTED_TITLE.mgmBldrgstPk),1065124168);assert.equal(await page.locator('#cancel-detail').isVisible(),true);assert.match(await page.locator('#cancel-detail').textContent(),/보강정보/);await settled();assert.equal(await page.locator('#cancel-detail').isVisible(),false);
  await page.screenshot({path:new URL('main-selection-1366.png',out).pathname,fullPage:true});
  await page.locator('#dDong0').click();const auxLink=page.url();assert.equal(await page.evaluate(()=>D_SELECTED_TITLE.totArea),44.78);await page.screenshot({path:new URL('aux-selection-1366.png',out).pathname,fullPage:true});
  await page.click('#tab-btn-stats');await ensureCurrent();assert.equal(await page.locator('#conditionTools').isVisible(),false);
  await page.goBack();await page.waitForFunction(()=>D_SELECTED_TITLE?.totArea===44.78&&document.getElementById('dResult').style.display==='block');await settled();await ensureCurrent();assert.equal(page.url(),auxLink);
  await page.goForward();await page.waitForSelector('#tab-stats',{state:'visible'});await ensureCurrent();
  await page.goto(link({v:1,tab:'detail',f:{dInput:'서남로 1 2동'}}));await settled();await page.waitForFunction(()=>D_SELECTED_TITLE?.mgmBldrgstPk===1065124169);
  await page.goto(link({v:1,tab:'detail',f:{dInput:'서남로 1 2동'},pick:{id:'registry:1065124168'}}));await page.waitForFunction(()=>D_SELECTED_TITLE?.mgmBldrgstPk===1065124168&&document.getElementById('shareStatus').textContent.includes('선택 항목을 복원'));assert.equal(await page.evaluate(()=>D_SELECTED_TITLE.mgmBldrgstPk),1065124168);
  checks.push('real-response fixture selects main; explicit dong, shared pick and history-selected auxiliary override default; aria/title follow navigation');
  await page.goto(base);await page.reload();
  await page.evaluate(()=>{let resolve;window.testWait={promise:new Promise(r=>resolve=r),resolve};searchJuso=()=>testWait.promise;});await page.fill('#dInput','서남로 1');await page.click('#dRunBtn');assert.equal(await page.locator('#cancel-detail').isVisible(),true);await page.click('#cancel-detail');assert.equal(await page.locator('#cancel-detail').isVisible(),false);await page.evaluate(()=>testWait.resolve([]));await settled();assert.equal(await page.locator('#cancel-detail').isVisible(),false);
  await page.evaluate(()=>{searchJuso=async()=>{throw Error('controlled');};resolveByCandidates=async()=>({titles:[],error:'controlled failure',usedParams:null});});await page.click('#dRunBtn');await settled();assert.equal(await page.locator('#cancel-detail').isVisible(),false);assert.match(await page.locator('#dStatus').textContent(),/controlled failure/);
  await page.evaluate(()=>clearDetail());assert.equal(await page.locator('#cancel-detail').isVisible(),false);
  checks.push('cancel visible only during live search/supplements, hidden after completion/failure/cancel/reset');
  await page.evaluate(()=>{switchBuildingSubtab('bulk');let resolve;window.testWait={promise:new Promise(r=>resolve=r),resolve};searchJuso=()=>testWait.promise;document.getElementById('input').value='서남로 1';window.testJob=runLookup();});await page.waitForSelector('#cancel-bulk',{state:'visible'});await page.click('#cancel-bulk');await page.evaluate(async()=>{testWait.resolve([]);await testJob;});assert.equal(await page.locator('#cancel-bulk').isVisible(),false);
  await page.evaluate(async()=>{switchTab('demol');await loadHaengjeong();let resolve;window.testWait={promise:new Promise(r=>resolve=r),resolve};fetchDemolDong=()=>testWait.promise;document.getElementById('m-hdong').value='계림2동';window.testJob=runDemolSearch();});await page.waitForSelector('#cancel-demol',{state:'visible'});await page.click('#cancel-demol');await page.evaluate(async()=>{testWait.resolve({items:[],totalCount:0});await testJob;});assert.equal(await page.locator('#cancel-demol').isVisible(),false);
  await page.evaluate(()=>{let resolve;window.testWait={promise:new Promise(r=>resolve=r),resolve};loadVacantDataset=()=>testWait.promise;switchTab('vacant');window.testJob=runVacantSearch();});await page.waitForSelector('#cancel-vacant',{state:'visible'});await page.click('#cancel-vacant');await page.evaluate(async()=>{testWait.resolve({records:[],geometryState:'success'});await testJob;});assert.equal(await page.locator('#cancel-vacant').isVisible(),false);
  checks.push('bulk, demolition and vacant lifecycle cancellation buttons also hide after cancellation; housing/condition/map covered by P2 race suite');
  await page.goto(base);await page.reload();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}}));await page.click('#shareCopy');await page.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('복사했습니다'));await page.waitForTimeout(4200);assert.equal(await page.locator('#shareStatus').textContent(),'');
  await page.click('#shareCopy');await page.click('#tab-btn-vacant');assert.equal(await page.locator('#shareStatus').textContent(),'');
  await page.click('#shareCopy');await openTools();await page.setInputFiles('#conditionImport',{name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});await page.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('읽지 못'));await page.waitForTimeout(4200);assert.match(await page.locator('#shareStatus').textContent(),/읽지 못/);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));await page.click('#shareCopy');await page.waitForTimeout(4200);assert.equal(await page.locator('#shareFallback').isVisible(),true);assert.match(await page.locator('#shareStatus').textContent(),/직접 복사/);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>new Promise(r=>window.finishCopy=r)}});});await page.click('#shareCopy');await page.click('#tab-btn-stats');await page.evaluate(()=>finishCopy());await page.waitForTimeout(50);assert.equal(await page.locator('#shareStatus').textContent(),'');
  checks.push('copy success expires and clears on navigation; old timer cannot erase import failure/manual copy; late clipboard completion ignored');
  await page.evaluate(()=>localStorage.setItem('donggu.recent.v1',JSON.stringify([{state:{v:1,tab:'detail',f:{dInput:'서남로 1'}},at:'2026-10-25'},{state:{v:1,menu:'map',f:{'map-hdong':'계림2동',mapSourceGrid:['vacant']}},at:'2026-10-25'},{state:{v:1,menu:'vacant'},at:'2026-10-25'}])));await page.goto(base);await page.reload();
  await page.locator('#recentSearches summary').click();await page.waitForFunction(()=>document.querySelector('#recentSearches summary').getAttribute('aria-expanded')==='true');assert.match(await page.locator('#recentRows').textContent(),/서남로 1 · 건물 상세/);assert.match(await page.locator('#recentRows').textContent(),/계림2동 · 빈집 지도/);assert.match(await page.locator('#recentRows').textContent(),/동구 전체 · 빈집 조회/);assert.equal(await page.locator('#recentRows .recent-open').first().getAttribute('title'),await page.locator('#recentRows .recent-open').first().getAttribute('aria-label'));
  await page.locator('#recentRows .recent-open').first().click();await page.waitForFunction(()=>document.getElementById('shareStatus').textContent.includes('조회 버튼'));await page.waitForFunction(()=>document.activeElement.id==='dInput');await ensureCurrent();assert.equal(await page.locator('#dResult').isVisible(),false);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('donggu.recent.v1')).length),3);
  await openTools();assert.equal(await page.locator('#conditionImport').isVisible(),false);await page.locator('#conditionTools summary').focus();assert.equal(await page.locator('#conditionTools summary').evaluate(el=>el===document.activeElement),true);
  const download=page.waitForEvent('download');await page.click('#conditionExport');const saved=await download;assert.equal(JSON.parse(await fs.readFile(await saved.path())).f.dInput,'서남로 1');await page.setInputFiles('#conditionImport',await saved.path());await settled();
  checks.push('legacy recent storage has Korean source-aware labels and full accessible titles; restore is manual and preserves records; collapsed keyboard-accessible file controls still export/import');
  assert.deepEqual(errors,[]);await fs.writeFile(new URL('docs/ui-stage1-browser-results.json',root),JSON.stringify({mode:'Actual local Chromium, controlled API responses including selected fields captured from live Seonam-ro 1 response; not physical phones',checks,errors},null,2)+'\n');console.log(JSON.stringify({checks,errors},null,2));await ctx.close();
}
await fs.writeFile(new URL(`docs/ui-stage1-${phase}-layout.json`,root),JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2));await browser.close();
