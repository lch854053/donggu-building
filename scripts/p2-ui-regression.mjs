// Run with external Playwright tooling (not a production dependency), see verification report.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=new URL('../',import.meta.url),tag=process.env.EVIDENCE_TAG||'p2',output=new URL(`docs/${tag}-evidence/`,root);
await fs.mkdir(output,{recursive:true});
const hj=JSON.parse(await fs.readFile(new URL('haengjeong.json',root)));
const key=Object.keys(hj.jibun2hdong).find(k=>hj.jibun2hdong[k]==='계림2동');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:true});
const results=[];
for(const width of [360,390,430,1366]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,deviceScaleFactor:1,acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),p=url.searchParams;
    if(url.pathname.includes('tile')){await route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});return;}
    await new Promise(r=>setTimeout(r,url.pathname.endsWith('/vworld-bld')?350:50));
    let data={found:false,items:[],titles:[],totalCount:0};
    if(url.pathname.endsWith('/juso'))data={juso:[{admCd:'1221011800',bdMgtSn:'2911011800100310000010093',lnbrMnnm:'31',lnbrSlno:'0',mtYn:'0',roadAddrPart1:'전남광주통합특별시 동구 서남로 1',rn:'서남로',buldMnnm:'1'}]};
    if(url.pathname.endsWith('/building'))data={titles:[{bjdongCd:p.get('bjdongCd')||key.slice(0,5),bun:p.get('bun')||key.slice(5,9),ji:p.get('ji')||key.slice(9),newPlatPlc:'전남광주통합특별시 동구 아주 긴 주소를 표시하는 서남로 1',bldNm:'회귀 테스트 건물 긴 이름',mainPurpsCdNm:'업무시설',strctCdNm:'철근콘크리트구조',grndFlrCnt:2,useAprDay:'20221006',heit:15.3}],totalCount:1};
    if(url.pathname.endsWith('/vworld-bld'))data=p.get('op')==='lda'?{found:true,items:[{bldNm:'건물',closed:false,dong:'1',ho:'101'}]}:{found:true,properties:{hg:15.7,violt_bild:'N',last_updt_dt:'2026-10-05Z'}};
    await route.fulfill({json:data});
  });
  await page.goto('http://localhost:3000');
  // Every top-level menu must be reachable by a real click, including off-screen scroll items.
  const tabs=page.locator('.tab');
  for(let i=0;i<await tabs.count();i++){
    await tabs.nth(i).click();
    assert.equal(await tabs.nth(i).getAttribute('aria-current'),'page');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow menu ${i} at ${width}`);
  }
  await page.evaluate(async()=>{switchTab('housing');await loadHousing();});
  await page.fill('#h-dual-hhld-min','154');await page.locator('#h-dual-hhld-min').press('Tab');
  await page.fill('#h-dual-hhld-max','999');await page.locator('#h-dual-hhld-max').press('Tab');
  assert.deepEqual(await page.evaluate(()=>H_DUAL.hhld.values()),[154,999]);
  await page.evaluate(async()=>{switchTab('building');switchBuildingSubtab('cond');await loadHaengjeong();});
  await page.selectOption('#c-hdong','계림2동');
  await page.fill('#dual-flr-min','9');await page.locator('#dual-flr-min').press('Tab');
  await page.fill('#dual-flr-max','2');await page.locator('#dual-flr-max').press('Tab');
  assert.deepEqual(await page.evaluate(()=>DUAL.flr.values()),[2,9]);
  await page.fill('#dual-flr-min','');await page.locator('#dual-flr-min').press('Tab');
  await page.fill('#dual-flr-max','999');await page.locator('#dual-flr-max').press('Tab');
  assert.deepEqual(await page.evaluate(()=>DUAL.flr.values()),[0,30]);assert.equal(await page.evaluate(()=>DUAL.flr.atCap()),true);
  assert.equal(await page.locator('#c-yearunknown').isChecked(),true);
  await page.fill('#dual-area-min','123.45');await page.locator('#dual-area-min').press('Tab');
  assert.equal(await page.evaluate(()=>DUAL.area.values()[0]),123.45);
  await page.locator('#dual-area-min').focus();assert.notEqual(await page.locator('#dual-area-min').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  await page.evaluate(()=>DUAL.area.reset());
  await page.click('#cRunBtn');await page.waitForFunction(()=>!document.getElementById('cRunBtn').disabled);
  await page.waitForSelector('#cResultBody tr[data-mobile-ready]');
  if(width<500){
    const toggle=page.locator('#cResultBody .mobile-row-toggle').first();await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await toggle.click();
  }
  await page.screenshot({path:new URL(`flow-results-${width}.png`,output).pathname,fullPage:true});
  const excelEvent=page.waitForEvent('download');await page.click('#cExportBtn');const excel=await excelEvent;
  assert.match(excel.suggestedFilename(),/\.xlsx$/);assert.equal(await excel.failure(),null);
  const conditionBook=XLSX.read(await fs.readFile(await excel.path()),{type:'buffer'});assert.ok(conditionBook.Sheets['조회정보']);
  // Basic detail is visible before delayed supplements, and supplement updates preserve the active tab.
  await page.evaluate(()=>switchBuildingSubtab('detail'));await page.fill('#dInput','서남로 1');await page.click('#dRunBtn');
  await page.waitForSelector('#dResult .d-card',{state:'visible'});
  await page.locator('.d-subtab[data-tab=park]').click();
  const selected=await page.locator('#dPanel').innerHTML();
  await page.waitForFunction(()=>D_BLDGIS?.state==='success' && D_LDA?.state==='success');
  assert.equal(await page.locator('#dPanel').innerHTML(),selected);
  assert.equal(await page.locator('.d-subtab.active').getAttribute('data-tab'),'park');
  assert.match(await page.locator('[data-gis-height]').textContent(),/필지 대표건물/);
  // Vacant list/map use the identical canonical record set and preserve source dates and unknown positions.
  await page.evaluate(async()=>{switchTab('vacant');await initVacantTab();document.getElementById('v-hdong').value='__ALL__';await runVacantSearch();});
  assert.equal(await page.evaluate(()=>V_RESULTS.length),648);
  await page.click('#vms-grade .ms-btn');await page.locator('#vms-grade input[value="3등급"]').check();await page.click('#vRunBtn');
  await page.selectOption('#vSort','yearAsc');
  assert.equal(await page.evaluate(()=>V_RESULTS.length),await page.evaluate(()=>V_DATA.filter(row=>row.grade==='3등급').length));
  assert.equal(await page.evaluate(()=>V_RESULTS.filter(row=>row.year!=null).every((row,i,a)=>i===0 || row.year>=a[i-1].year)),true);
  const vacantEvent=page.waitForEvent('download');await page.click('#vExportBtn');const vacantDownload=await vacantEvent;
  const vacantBook=XLSX.read(await fs.readFile(await vacantDownload.path()),{type:'buffer'}),vacantRows=XLSX.utils.sheet_to_json(vacantBook.Sheets['빈집현황']);
  assert.equal(vacantRows.length,await page.evaluate(()=>V_RESULTS.length));assert.ok(vacantRows[0]['레코드ID']);assert.equal(vacantRows[0]['기준일자'],'2025-07-16');
  await page.click('#vms-grade .ms-btn');await page.locator('#vms-grade input[value="3등급"]').uncheck();await page.click('#vRunBtn');
  await page.evaluate(async()=>{switchTab('map');await initMapTab();});
  await page.locator('#mapSourceGrid input[value=vacant]').check();
  for(const value of ['apt','cond'])await page.locator(`#mapSourceGrid input[value=${value}]`).uncheck();
  await page.selectOption('#map-hdong','__ALL__');await page.click('#mapRunBtn');
  await page.waitForFunction(()=>!document.getElementById('mapRunBtn').disabled);
  assert.deepEqual(await page.evaluate(()=>M_RESULTS.vacant.map(r=>r.recordId).sort()),await page.evaluate(()=>V_DATA.map(r=>r.recordId).sort()));
  assert.match(await page.locator('#mapVacantCoverage').textContent(),/위치 미확인 10건/);
  await page.locator('#mapResultsList .map-result-row').filter({hasText:'241-15'}).click();
  assert.match(await page.locator('#mapCard').textContent(),/2025-07-16/);
  assert.match(await page.locator('#mapCard').textContent(),/vacant:derived:/);
  await page.waitForTimeout(400); // Wait for the existing row entrance animation before evidence capture.
  const touch=await page.locator('.mc-close').boundingBox();assert.ok(touch.width>=44 && touch.height>=44);
  await page.locator('#mapCard').screenshot({path:new URL(`map-card-${width}.png`,output).pathname});
  await page.locator('.mc-close').click();assert.equal(await page.locator('#mapCard').isVisible(),false);
  await page.locator('#mapResultsList .map-result-row').filter({hasText:'322-9'}).first().click();
  assert.match(await page.locator('#mapCard').textContent(),/원본 레코드 2건/);
  assert.equal(await page.locator('#mapCard details').count(),2);
  await page.locator('#mapCard details summary').nth(1).click();
  await page.locator('.mc-close').click();
  await page.locator('#mapResultsList .map-result-row').filter({hasText:'위치 미확인'}).first().click();
  assert.match(await page.locator('#mapCard').textContent(),/위치 미확인/);await page.locator('.mc-close').click();
  if(width<500){
    assert.equal(await page.locator('#mapPanelToggle').getAttribute('aria-expanded'),'false');
    await page.locator('#mapPanelToggle').click();assert.equal(await page.locator('#mapPanelToggle').getAttribute('aria-expanded'),'true');
    await page.locator('#mapGestureToggle').click();assert.equal(await page.locator('#mapGestureToggle').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>M_MAP.dragging.enabled()),true);
    await page.locator('#mapGestureToggle').click();assert.equal(await page.evaluate(()=>M_MAP.dragging.enabled()),false);
    assert.equal(await page.locator('#mapView').evaluate(el=>getComputedStyle(el).touchAction),'pan-y');
    await page.locator('#mapView').scrollIntoViewIfNeeded();
    const beforeScroll=await page.evaluate(()=>scrollY),box=await page.locator('#mapView').boundingBox(),cdp=await context.newCDPSession(page);
    const x=Math.min(width-30,box.x+box.width/2),y=Math.max(50,Math.min(500,box.y+box.height/3));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let delta=30;delta<=150;delta+=30){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+delta}]});await page.waitForTimeout(25);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(200);
    assert.ok(await page.evaluate(()=>scrollY)<beforeScroll,'disabled map gestures must allow emulated vertical page scroll');await cdp.detach();
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`map overflow at ${width}`);
  // Existing Figure-Ground layers, legend, theme and both real image download paths.
  await page.evaluate(async()=>{switchMapSubtab('figure');await initFigureGroundMap();await loadFigureGroundViewport();});
  await page.locator('label[for=fgPurposeToggle]').click();await page.waitForFunction(()=>FG_COLOR_MODE==='purpose');
  await page.locator('label[for=fgAgeToggle]').click();await page.waitForFunction(()=>FG_COLOR_MODE==='age');
  for(const [id,extension] of [['fgPngBtn','png'],['fgJpgBtn','jpg']]){
    const event=page.waitForEvent('download');await page.click('#'+id);const download=await event;assert.ok(download.suggestedFilename().endsWith('.'+extension));assert.equal(await download.failure(),null);
    const bytes=await fs.readFile(await download.path());assert.ok(bytes.length>64);
    if(extension==='png')assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');else assert.equal(bytes.subarray(0,2).toString('hex'),'ffd8');
  }
  await page.screenshot({path:new URL(`figure-${width}.png`,output).pathname,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`figure overflow at ${width}`);
  assert.deepEqual(errors,[]);
  results.push({width,height:900,mode:width<500?'Chromium mobile emulation, touch; not physical phone':'Chromium desktop',checks:['all menus','exact numeric input / slider sync','result summary expansion','XLSX download','progressive detail / selected tab retained','vacant list/map IDs and date','map card close','mobile panel and gesture controls','Figure-Ground themes and PNG/JPG download','no document horizontal overflow'],errors});
  await context.close();
}
await fs.writeFile(new URL(`docs/${tag}-ui-results.json`,root),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));await browser.close();
