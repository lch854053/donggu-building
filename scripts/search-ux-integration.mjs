// Controlled browser checks for the new result actions and existing bulk export.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=JSON.parse(await fs.readFile(new URL('../test/fixtures/ui-stage1-seonam-titles.json',import.meta.url)));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
const ctx=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true});
try{
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/juso')return route.fulfill({json:{juso:[{admCd:'1221011800',bdMgtSn:'2911011800100310000010093',lnbrMnnm:'31',lnbrSlno:'0',mtYn:'0',roadAddrPart1:'전남광주통합특별시 동구 서남로 1',rn:'서남로',buldMnnm:'1'}]}});
    if(url.pathname==='/api/building')return route.fulfill({json:{titles:fixture.titles,totalCount:fixture.titles.length}});
    if(url.pathname.startsWith('/api/'))return route.fulfill({json:{items:[],titles:[],found:false,totalCount:0}});
    if(url.hostname==='cdnjs.cloudflare.com'&&url.pathname.includes('/xlsx/'))return route.fulfill({path:'node_modules/xlsx/dist/xlsx.full.min.js'});
    if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();
    return route.continue();
  });
  await page.goto(process.env.BASE_URL||'http://127.0.0.1:3000',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copiedCore=text}}));
  await page.evaluate(async()=>{document.getElementById('dInput').value='서남로 1';await runDetail();});
  assert.equal(await page.locator('.copy-core').count(),1);
  await page.locator('.copy-core').click();
  let copied=await page.evaluate(()=>window.copiedCore);
  for(const field of ['건물명:','주소:','주용도:','사용승인:','연면적:','층수:','자료 출처:','조회 시각:'])assert.ok(copied.includes(field),field);
  assert.match(copied,/자료 출처: 건축물대장 표제부/);const fetchedAt=copied.split('조회 시각: ')[1];assert.notEqual(fetchedAt,'미확인');
  assert.equal(await page.locator('.result-detail-more .k').filter({hasText:'연면적'}).count(),0);
  assert.equal(await page.locator('.result-detail-more summary').filter({hasText:'건폐율·용적률'}).count(),1);
  await page.locator('#dDong0').click();await page.locator('.copy-core').click();
  assert.notEqual(await page.evaluate(()=>window.copiedCore),copied,'copy follows selected building');
  assert.equal((await page.evaluate(()=>window.copiedCore)).split('조회 시각: ')[1],fetchedAt,'changing the selected dong must not change the query time');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied');}}}));
  await page.locator('.copy-core').click();await page.locator('.copy-core').click();assert.equal(await page.locator('.copy-fallback').count(),1);assert.match(await page.locator('.copy-fallback').inputValue(),/자료 출처:/);
  await page.locator('.quick-links button').filter({hasText:'여러 주소 조회'}).click();
  await page.locator('#input').fill('서남로 1\n서남로 1');await page.locator('#runBtn').click();
  await page.waitForFunction(()=>B_RESULTS.length===2&&B_RESULTS.every(r=>!['pending','loading'].includes(r.status))&&!document.getElementById('runBtn').disabled);
  assert.equal(await page.locator('#resultBody tr:not(.sub-row)').count(),2);
  const download=page.waitForEvent('download');await page.locator('#exportBtn').click();assert.match((await download).suggestedFilename(),/\.xlsx$/i);
  assert.deepEqual(errors,[]);console.log('detail copy, dong selection, fallback, quick link, bulk lookup and XLSX download passed');
}finally{await ctx.close();await browser.close();}
