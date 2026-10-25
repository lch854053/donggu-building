import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const phase=process.argv[2]||'after',root=new URL('../',import.meta.url),out=new URL('docs/ui-stage2-evidence/',root),base=process.env.BASE_URL||'http://localhost:3000';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:true});
const reports=[];
for(const width of [360,390,430,1366]){
  const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,acceptDownloads:true});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.fulfill({json:{items:[],titles:[],complexes:[],totalCount:0,found:false}}));
  await page.goto(base);
  for(const tab of ['cond','housing','demol','vacant','general']){
    await page.evaluate(async tab=>{if(tab==='cond'){switchTab('building');switchBuildingSubtab('cond');await loadHaengjeong();}else if(tab==='general'){switchTab('map');switchMapSubtab('general');await initMapTab();}else{switchTab(tab);if(tab==='housing')await loadHousing();if(tab==='demol')await loadHaengjeong();if(tab==='vacant')await initVacantTab();}},tab);
    if(phase==='after'){
      assert.equal(await page.locator(`#advanced-${tab}`).evaluate(el=>el.open),false);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    }
    await page.screenshot({path:new URL(`${phase}-${tab}-${width}.png`,out).pathname,fullPage:true});
  }
  reports.push({width,mode:width<500?'Chromium touch/mobile emulation, not physical phone':'Chromium desktop',errors});assert.deepEqual(errors,[]);await ctx.close();
}
await fs.writeFile(new URL(`docs/ui-stage2-${phase}-layout.json`,root),JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify(reports,null,2));await browser.close();
