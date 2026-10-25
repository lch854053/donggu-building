import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../',import.meta.url),phase=process.argv[2]||'after',out=new URL('docs/ui-stage3-evidence/',root),base=process.env.BASE_URL||'http://localhost:3000';await fs.mkdir(out,{recursive:true});
const mapping=JSON.parse(await fs.readFile(new URL('haengjeong.json',root))),parcel=Object.keys(mapping.jibun2hdong).find(k=>mapping.jibun2hdong[k]==='계림2동'),fixture=JSON.parse(await fs.readFile(new URL('test/fixtures/ui-stage1-seonam-titles.json',root)));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:true}),reports=[];
for(const width of [360,390,430,1366]){
  const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,acceptDownloads:true});
  await ctx.route('**/api/**',async route=>{const u=new URL(route.request().url()),p=u.searchParams;let data={items:[],titles:[],complexes:[],totalCount:0,found:false};
    if(u.pathname.includes('tile')){await route.fulfill({status:204});return;}
    if(u.pathname.endsWith('/juso'))data={juso:[{admCd:'1221011800',bdMgtSn:'2911011800100310000010093',lnbrMnnm:'31',lnbrSlno:'0',mtYn:'0',roadAddrPart1:'전남광주통합특별시 동구 서남로 1',rn:'서남로',buldMnnm:'1'}]};
    if(u.pathname.endsWith('/building')&&[parcel.slice(0,5),'11800'].includes(p.get('bjdongCd')))data={titles:fixture.titles.map((t,i)=>({...t,bjdongCd:p.get('bjdongCd'),bun:p.get('bun')||parcel.slice(5,9),ji:p.get('ji')||parcel.slice(9),totArea:i===0?0:123.456789,grndFlrCnt:i+1,ugrndFlrCnt:0,useAprDay:'20221006'})),totalCount:3};
    if(u.pathname.endsWith('/archpms')&&p.get('op')==='getApDemolExtngMgmRgstInfo'&&p.get('bjdongCd')===parcel.slice(0,5))data={items:[{bun:parcel.slice(5,9),ji:parcel.slice(9),demolExtngGbCdNm:'멸실',demolExtngDay:'20191001',platPlc:'계림동 통제 항목',totArea:123.456789,mainPurpsCdNm:'업무시설'}],totalCount:1};
    await route.fulfill({json:data});
  });
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
  await page.evaluate(async()=>{switchBuildingSubtab('bulk');document.getElementById('input').value='서남로 1';await runLookup();});await page.screenshot({path:new URL(`${phase}-bulk-${width}.png`,out).pathname,fullPage:true});
  for(const tab of ['cond','housing','demol','vacant']){
    await page.evaluate(async tab=>{if(tab==='cond'){await loadHaengjeong();switchTab('building');switchBuildingSubtab('cond');document.getElementById('c-hdong').value='계림2동';await runConditionSearch();}else{switchTab(tab);if(tab==='housing'){await loadHousing();document.getElementById('h-hdong').value='계림2동';await runHousingSearch();}if(tab==='demol'){await loadHaengjeong();document.getElementById('m-hdong').value='계림2동';await runDemolSearch();}if(tab==='vacant')await runVacantSearch();}},tab);
    await page.waitForTimeout(700);await page.screenshot({path:new URL(`${phase}-${tab}-${width}.png`,out).pathname,fullPage:true});
    await page.evaluate(tab=>document.getElementById({cond:'cResultArea',housing:'hResultArea',demol:'mResultArea',vacant:'vResultArea'}[tab]).scrollIntoView({block:'start'}),tab);await page.screenshot({path:new URL(`${phase}-${tab}-results-${width}.png`,out).pathname});
  }
  await page.evaluate(async()=>{switchTab('building');switchBuildingSubtab('detail');document.getElementById('dInput').value='서남로 1';await runDetail();});await page.screenshot({path:new URL(`${phase}-detail-${width}.png`,out).pathname,fullPage:true});
  await page.evaluate(()=>document.getElementById('dResult').scrollIntoView({block:'start'}));await page.screenshot({path:new URL(`${phase}-detail-summary-${width}.png`,out).pathname});
  await page.evaluate(async()=>{switchTab('stats');await initStatsTab();});await page.screenshot({path:new URL(`${phase}-stats-${width}.png`,out).pathname,fullPage:true});
  await page.evaluate(()=>[...document.querySelectorAll('.reb-card')].find(el=>el.querySelector('.st-name')?.textContent==='아파트 매매가격')?.scrollIntoView({block:'start'}));await page.screenshot({path:new URL(`${phase}-price-${width}.png`,out).pathname});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);reports.push({width,mode:width<500?'Chromium mobile/touch emulation, not a physical phone':'Chromium desktop',errors});await ctx.close();
}
await fs.writeFile(new URL(`docs/ui-stage3-${phase}-layout.json`,root),JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2));await browser.close();
