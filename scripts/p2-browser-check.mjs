// Reproducible browser measurements with controlled API latency; no live API scan.
// PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/p2-browser-check.mjs baseline
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const phase = process.argv[2] || 'after';
const baseUrl=process.env.BASE_URL || 'http://localhost:3000';
const root = new URL('../', import.meta.url);
const hj = JSON.parse(await fs.readFile(new URL('haengjeong.json',root)));
const kapt = JSON.parse(await fs.readFile(new URL('aptlist_donggu.json',root)));
const keys = Object.entries(hj.jibun2hdong).filter(([k,v])=>v==='계림2동').slice(0,4).map(([k])=>k);
const titles = keys.map((k,i)=>({bjdongCd:k.slice(0,5),bun:k.slice(5,9),ji:k.slice(9),mainAtchGbCdNm:'주건축물',bldNm:'측정 건물 '+i,mainPurpsCdNm:'업무시설',totArea:100,grndFlrCnt:2,useAprDay:'20221006'}));
const observed = [{dongNm:'',mainAtchGbCdNm:'부속건축물',strctCdNm:'흙벽돌조',heit:0},{dongNm:'',mainAtchGbCdNm:'주건축물',strctCdNm:'철근콘크리트구조',heit:15.3,grndFlrCnt:6},{dongNm:'주건축물제2동',mainAtchGbCdNm:'주건축물',strctCdNm:'일반철골구조',heit:15.7,grndFlrCnt:4}];
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:true});
const reports=[];
await fs.mkdir(new URL('docs/p2-evidence/',root),{recursive:true});
for(const scenario of (process.env.ONLY_SCENARIO?[process.env.ONLY_SCENARIO]:['detail','housing','condition','map'])){
  for(let trial=0;trial<3;trial++){
    const context=await browser.newContext({viewport:{width:1366,height:900}});
    const page=await context.newPage();
    let requests=0,active=0,max=0,lastApiCompleted=0;
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname.includes('tile')){await route.abort();return;}
      requests++;active++;max=Math.max(max,active);
      await new Promise(r=>setTimeout(r,80));
      let data={found:false,items:[],titles:[],totalCount:0};
      const p=url.searchParams;
      if(url.pathname.endsWith('/juso')) data={juso:[{admCd:'1221011800',bdMgtSn:'2911011800100310000010093',lnbrMnnm:'31',lnbrSlno:'0',mtYn:'0',roadAddrPart1:'전남광주통합특별시 동구 서남로 1',rn:'서남로',buldMnnm:'1',emdNm:'서석동'}]};
      if(url.pathname.endsWith('/building')){
        if(p.get('bun')==='0031'&&p.get('bjdongCd')==='11800')data={titles:observed,totalCount:3};
        else if(p.has('bun'))data={titles:[{...titles[0],bldNm:'측정 공동주택',useAprDay:'20221006'}],totalCount:1};
        else if(p.get('bjdongCd')===keys[0].slice(0,5))data={titles:titles.slice(p.get('pageNo')==='2'?2:0,p.get('pageNo')==='2'?4:2),totalCount:4};
      }
      if(url.pathname.endsWith('/aptid'))data={complexes:kapt.map(c=>({pnu:c.pnu,complexPk:c.kaptCode,complexNm:c.kaptName,adres:c.bass.kaptAddr,unitCnt:Number(c.bass.hoCnt||c.bass.kaptdaCnt),dongCnt:1,complexGbCd:'1',useaprDt:c.bass.kaptUsedate})),totalCount:kapt.length};
      if(url.pathname.endsWith('/vworld-bld'))data=p.get('op')==='lda'?{found:false,items:[]}:{found:true,properties:{hg:15.7,violt_bild:'N',last_updt_dt:'2026-10-05Z'}};
      if(url.pathname.endsWith('/vworld-parcel'))data={features:(p.get('pnus')||'').split(',').filter(Boolean).map(pnu=>({type:'Feature',properties:{pnu},geometry:{type:'Polygon',coordinates:[[[126.921,35.16],[126.9212,35.16],[126.9212,35.1602],[126.921,35.16]]]}}))};
      active--; await route.fulfill({json:data});lastApiCompleted=performance.now();
    });
    await page.goto(baseUrl);
    await page.evaluate(async()=>{await loadHaengjeong();await loadHousing();});
    if(scenario==='map-full')await page.evaluate(async()=>{switchTab('map');await initMapTab();document.querySelectorAll('#mapSourceGrid input').forEach(el=>el.checked=el.value==='cond');document.getElementById('map-hdong').value='계림2동';});
    for(const cache of ['cold','warm']){
      requests=active=max=lastApiCompleted=0;
      const started=performance.now();
      const timing=await page.evaluate(async scenario=>{
        const t=performance.now();let first=null;
        const target=scenario==='detail'?'dResult':scenario==='housing'?'hResultArea':scenario==='condition'?'cResultArea':'mapResultsWrap';
        document.getElementById(target).style.display='none';
        const observer=new MutationObserver(()=>{if(first===null&&document.getElementById(target).style.display!=='none')first=performance.now()-t;});
        observer.observe(document.getElementById(target),{attributes:true,childList:true,subtree:true});
        if(scenario==='detail'){switchBuildingSubtab('detail');document.getElementById('dInput').value='서남로 1';await runDetail();}
        if(scenario==='housing'){switchTab('housing');document.getElementById('h-hdong').value='계림2동';await runHousingSearch();}
        if(scenario==='condition'){switchBuildingSubtab('cond');document.getElementById('c-hdong').value='계림2동';await runConditionSearch();}
        if(scenario==='map'){
          // Measure the building-data path, not tiles/network-dependent Leaflet initialization.
          document.querySelectorAll('#mapSourceGrid input').forEach(el=>el.checked=el.value==='cond');
          M_LAYER.cond={clearLayers(){}};await runCondForMap('계림2동');renderMapResults();
        }
        if(scenario==='map-full')await runMapSearch();
        const jobEnd=performance.now()-t;
        await new Promise(r=>setTimeout(r,350));observer.disconnect();
        return {firstMs:Math.round(first??jobEnd),completeMs:Math.round(Math.max(first??0,jobEnd))};
      },scenario);
      reports.push({scenario,trial:trial+1,cache,...timing,completeMs:Math.max(timing.completeMs,lastApiCompleted?Math.round(lastApiCompleted-started):0),apiRequests:requests,maxConcurrency:max,elapsedMs:Math.round(performance.now()-started)});
    }
    await context.close();
  }
}
const layouts=[];
if(!process.env.ONLY_SCENARIO){
const page=await browser.newPage();await page.goto(baseUrl);
for(const width of [360,390,430,1366]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>{switchBuildingSubtab('cond');initFilters();});
  layouts.push(await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,menuWidth:document.querySelector('.tabs').scrollWidth,numberInputs:document.querySelectorAll('.dual input[type=number]').length})));
  await page.screenshot({path:new URL(`docs/p2-evidence/${phase}-${width}.png`,root).pathname,fullPage:true});
}
}
await fs.writeFile(new URL(`docs/p2-${phase}-measurements.json`,root),JSON.stringify({mode:'controlled browser; API latency 80ms; three cold contexts and three warm repetitions; map=data path, map-full=initialized Leaflet search including geometry/render (tiles excluded)',reports,layouts},null,2)+'\n');
console.log(JSON.stringify({phase,reports,layouts},null,2));
await browser.close();
