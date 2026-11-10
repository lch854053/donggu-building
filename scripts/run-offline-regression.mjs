// Execute an existing browser regression with local copies of its CDN dependencies.
// Install playwright, leaflet and leaflet.fullscreen without saving them first.
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const name=process.argv[2];
if(!['ui-stage1-browser','ui-stage2-browser','ui-stage3-browser','ui-stage3-regression','p3-browser-regression','p2-browser-check'].includes(name))throw Error('Unknown regression script');
const dir=fileURLToPath(new URL('.',import.meta.url)),source=await fs.readFile(new URL(`${name}.mjs`,import.meta.url),'utf8');
const setup=`
const originalNewContext=browser.newContext.bind(browser);
browser.newContext=async (...args)=>{
  const ctx=await originalNewContext(...args);
  await ctx.route('https://**/*',async route=>{
    const path=new URL(route.request().url()).pathname;
    const files={'/ajax/libs/leaflet/1.9.4/leaflet.js':'node_modules/leaflet/dist/leaflet.js','/ajax/libs/leaflet/1.9.4/leaflet.css':'node_modules/leaflet/dist/leaflet.css','/ajax/libs/leaflet.fullscreen/2.4.0/Control.FullScreen.min.js':'node_modules/leaflet.fullscreen/dist/Control.FullScreen.umd.js','/ajax/libs/leaflet.fullscreen/2.4.0/Control.FullScreen.min.css':'node_modules/leaflet.fullscreen/dist/Control.FullScreen.css','/ajax/libs/xlsx/0.18.5/xlsx.full.min.js':'node_modules/xlsx/dist/xlsx.full.min.js'};
    if(files[path])return route.fulfill({path:files[path]});
    return route.abort();
  });
  return ctx;
};`;
const code=`import {fileURLToPath} from 'node:url';\n`+source.replace(/new URL\(((?:`[^`]+`|'[^']+'),\s*(?:out|root))\)\.pathname/g,'fileURLToPath(new URL($1))').replace(/(const browser\s*=\s*await chromium\.launch\([^\n]+\);)/,'$1'+setup).replaceAll('docs/ui-stage3-browser-results.json','docs/search-ux-stage3-results.json').replaceAll('shared-record-map-${width}.png','search-ux-shared-record-map-${width}.png').replaceAll('checked-stats-${width}.png','search-ux-checked-stats-${width}.png');
const temporary=new URL(`.offline-${name}-${process.pid}.mjs`,import.meta.url);
await fs.writeFile(temporary,code);
try{
  const child=spawn(process.execPath,[fileURLToPath(temporary),...process.argv.slice(3)],{cwd:dir+'/..',stdio:'inherit',env:process.env});
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  if(exit)process.exitCode=exit;
}finally{await fs.rm(temporary,{force:true});}
