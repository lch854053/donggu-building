// Run with a local static server and PLAYWRIGHT_MODULE / CHROMIUM_PATH as needed.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
try{
  for(const width of [360,390,430,1366]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/juso'){
        const q=url.searchParams.get('keyword');
        if(q.endsWith('오래된 주소'))await new Promise(r=>setTimeout(r,900));
        if(q.endsWith('오류 주소'))return route.fulfill({status:503,json:{error:'failure'}});
        return route.fulfill({json:{juso:[{admCd:'1221011800',roadAddrPart1:q.endsWith('오래된 주소')?'오래된 결과':'광주 동구 서남로 1'},{admCd:'2911011800',roadAddrPart1:'광주 동구 서남로 2'},{admCd:'1111011800',roadAddrPart1:'다른 지역'}]}});
      }
      if(url.pathname.startsWith('/api/'))return route.fulfill({json:{items:[],titles:[],juso:[],found:false}});
      if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
      return route.continue();
    });
    await page.goto(process.env.BASE_URL||'http://127.0.0.1:3000',{waitUntil:'domcontentloaded',timeout:30000});
    const input=page.locator('#dInput');await input.fill('서남로');
    await page.locator('#addressSuggestions [role=option]').first().waitFor();
    assert.equal(await page.locator('#addressSuggestions [role=option]').count(),2);
    await input.press('Enter');assert.equal(await input.inputValue(),'서남로');assert.match(await page.locator('#addressSuggestionStatus').textContent(),/선택/);
    await input.press('ArrowDown');await input.press('Enter');
    assert.equal(await input.inputValue(),'광주 동구 서남로 1');
    assert.equal(await input.getAttribute('aria-expanded'),'false');
    await input.fill('서남로');await page.locator('#addressSuggestions [role=option]').last().click();assert.equal(await input.inputValue(),'광주 동구 서남로 2');
    await input.fill('오래된 주소');await page.waitForTimeout(450);await input.fill('새로운 주소');await page.waitForTimeout(1100);
    assert.equal(await page.locator('#addressSuggestions [role=option]').first().textContent(),'광주 동구 서남로 1');
    await input.press('Escape');assert.equal(await input.getAttribute('aria-expanded'),'false');
    await input.fill('오류 주소');await page.waitForTimeout(700);assert.equal(await input.getAttribute('aria-expanded'),'false');
    assert.match(await page.locator('#addressSuggestionStatus').textContent(),/직접 입력/);
    await input.fill('서남로 1 108동');await page.locator('#addressSuggestions [role=option]').first().waitFor();await input.press('ArrowDown');await input.press('Enter');assert.equal(await input.inputValue(),'광주 동구 서남로 1 108동');
    await input.fill('');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`search-ux-${width}.png`});
    assert.deepEqual(errors,[]);console.log(`width ${width}: suggestion selection and layout passed`);
    await page.close();
  }
}finally{await browser.close();}
