import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {toDxf} from '../src/toolkit/export';
import {referenceDrawing} from '../src/toolkit/samples';
const data=toDxf(referenceDrawing);
test('DXF artwork imports and nests directly without size changes',async({page})=>{
 await page.goto('/en/nesting');await page.getByLabel('Import vector file').setInputFiles({name:'reference.dxf',mimeType:'application/dxf',buffer:Buffer.from(data)});
 await expect(page.getByText('1 parts loaded')).toBeVisible();await expect(page.getByText('100.0 × 100.0 mm',{exact:true})).toBeVisible();
 await page.getByLabel('Quantity of each part').fill('1');await page.getByRole('button',{name:'Arrange parts',exact:true}).click();await expect(page.getByText('Layout ready',{exact:true})).toBeVisible();
});
test('unitless DXF requires choosing its units and retries the selected file',async({page})=>{
 await page.goto('/en/nesting');await page.getByLabel('Import vector file').setInputFiles({name:'unitless.dxf',mimeType:'application/dxf',buffer:Buffer.from(data.replace('$INSUNITS\n70\n4','$INSUNITS\n70\n0'))});
 await expect(page.locator('.error-note')).toContainText(/unit/i);await page.getByText('Units & import size',{exact:true}).click();await page.getByLabel('DXF units').selectOption('mm');
 await expect(page.getByText('1 parts loaded')).toBeVisible();await expect(page.locator('.error-note')).toHaveCount(0);
});
test('CDR invalid binary shows a useful error and cannot export old artwork',async({page})=>{
 await page.goto('/en/nesting');await page.getByLabel('Import vector file').setInputFiles({name:'bad.cdr',mimeType:'application/octet-stream',buffer:Buffer.from('invalid document')});
 await expect(page.locator('.error-note')).toContainText(/CDR/);await expect(page.getByRole('button',{name:'Export DXF',exact:true})).toBeDisabled();
});
test('cleanup says when a curved SVG is already ready to cut, and keeps its nodes',async({page})=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M10 50 C10 20 90 20 90 50 C90 80 10 80 10 50 Z"/></svg>';
 await page.goto('/en/vector-cleanup');await page.getByLabel('Import vector file').setInputFiles({name:'clean.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await page.getByRole('button',{name:'Apply cleanup',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('ready to cut');await expect(page.locator('.stats-row')).toContainText('2 → 2');
});
test('cleanup warns about open paths instead of calling the file ready',async({page})=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M10 10 L50 10 L50 50"/></svg>';
 await page.goto('/en/vector-cleanup');await page.getByLabel('Import vector file').setInputFiles({name:'open.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await page.getByRole('button',{name:'Apply cleanup',exact:true}).click();
 await expect(page.locator('.file-check')).toContainText('Open paths 1');await expect(page.locator('.tip-card.ready')).toHaveCount(0);
});
test('cleanup preview shows the nodes, before and after, and zooms in to them',async({page})=>{
 // A nearly straight edge of twenty cubics, then three corners.
 const wobble=Array.from({length:20},(_,i)=>`C${i*4+1.2} 10.2 ${i*4+2.8} 9.8 ${i*4+4} 10`).join(' ');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M0 10 ${wobble} L80 60 L0 60 Z"/></svg>`;
 await page.goto('/en/vector-cleanup');await page.getByLabel('Import vector file').setInputFiles({name:'wobble.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await page.getByRole('button',{name:'Apply cleanup',exact:true}).click();
 const caption=page.locator('.preview-bottom');
 await expect(caption).toContainText('3 nodes');await expect(page.locator('.node-marks')).toHaveCount(1);
 await page.getByRole('button',{name:'Original',exact:true}).click();await expect(caption).toContainText('22 nodes');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(page.locator('.vector-paper')).toHaveClass(/zoomed/);
 await page.getByRole('button',{name:'Show nodes',exact:true}).click();await expect(page.locator('.node-marks')).toHaveCount(0);
});
test('an engraved circle drawn on a plate stays on it through nesting and exports as engraving',async({page})=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="60" height="40" fill="none" stroke="red"/><circle cx="40" cy="30" r="8" fill="none" stroke="blue"/><path d="M80 80 L95 80" stroke="red"/></svg>';
 await page.goto('/en/nesting');await page.getByLabel('Import vector file').setInputFiles({name:'plate.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await expect(page.getByRole('status')).toContainText('1 lines lie on no part');
 await page.getByRole('button',{name:'Arrange parts',exact:true}).click();await expect(page.getByText('Layout ready',{exact:true})).toBeVisible();
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export SVG',exact:true}).click();
 const out=readFileSync(await (await pending).path(),'utf8');
 const blue=/<path d="([^"]+)"[^>]*stroke="#0000ff"/.exec(out)?.[1]??'',red=/<path d="([^"]+)"[^>]*stroke="#ff0000"/.exec(out)?.[1]??'';
 const nums=(d:string)=>(d.match(/-?\d+(\.\d+)?/g)||[]).map(Number);
 const xs=(d:string)=>nums(d).filter((_,i)=>i%2===0),ys=(d:string)=>nums(d).filter((_,i)=>i%2===1);
 expect(blue).not.toBe('');
 // The engraving (its first point; the rest are arcs) lies within the plate, whose path is all straight lines.
 const [bx,by]=nums(blue);
 expect(bx).toBeGreaterThan(Math.min(...xs(red)));expect(bx).toBeLessThan(Math.max(...xs(red)));
 expect(by).toBeGreaterThan(Math.min(...ys(red)));expect(by).toBeLessThan(Math.max(...ys(red)));
});
test('import errors read in Arabic on the Arabic site',async({page})=>{
 await page.goto('/ar/vector-cleanup');
 await page.getByLabel('استيراد ملف فيكتور').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M0 0 Q1"/></svg>')});
 await expect(page.locator('.error-note')).toHaveText('أمر مسار SVG غير صالح أو ناقص.');
});
test('long figures in stat tiles shrink to fit instead of being cut off, on a phone',async({page})=>{
 await page.setViewportSize({width:375,height:812});
 for(const url of ['/ar/box-maker','/en/box-maker']){
  await page.goto(url);await expect(page.locator('.stat strong').first()).toContainText('×');
  const cut=await page.locator('.stat strong').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth).map(e=>e.textContent));
  expect(cut).toEqual([]);
 }
});
test('a layer of 400 pieces in one path arranges in the browser',async({page})=>{
 const d=Array.from({length:400},(_,i)=>{const x=(i%20)*20,y=Math.floor(i/20)*20,w=4+(i*7)%11,h=4+(i*5)%9;return `M${x} ${y}h${w}v${h}h${-w}Z`;}).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="400mm" height="400mm" viewBox="0 0 400 400"><path d="${d}"/></svg>`;
 await page.goto('/en/nesting');await page.getByLabel('Import vector file').setInputFiles({name:'layer.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 await expect(page.getByText('400 pieces in this job',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Arrange parts',exact:true}).click();await expect(page.getByText('Layout ready',{exact:true})).toBeVisible({timeout:20000});
 await expect(page.locator('.stats-row')).toContainText('400 / 400');
 await expect(page.locator('.tip-card').last()).toContainText('bounding rectangle');
});
test('any-angle turning is offered with rotation and packs the job',async({page})=>{
 const d=Array.from({length:30},(_,i)=>{const a=(20+i*7)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=30+(i%6)*60,cy=30+Math.floor(i/6)*60;return 'M'+[[-20,-5],[20,-5],[20,5],[-20,5]].map(([x,y])=>`${(cx+x*c-y*s).toFixed(3)} ${(cy+x*s+y*c).toFixed(3)}`).join('L')+'Z';}).join('');
 await page.goto('/en/nesting');await page.getByLabel('Import vector file').setInputFiles({name:'bars.svg',mimeType:'image/svg+xml',buffer:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400mm" height="400mm" viewBox="0 0 400 400"><path d="${d}"/></svg>`)});
 await expect(page.getByText('Any angle',{exact:true})).toBeVisible();
 await page.getByText('Any angle',{exact:true}).click();
 await page.getByRole('button',{name:'Arrange parts',exact:true}).click();await expect(page.getByText('Layout ready',{exact:true})).toBeVisible({timeout:20000});
 await expect(page.locator('.stats-row')).toContainText('30 / 30');
 await page.getByText('Allow 90° rotations',{exact:true}).click();await expect(page.getByText('Any angle',{exact:true})).toHaveCount(0);
});
test('the makers of one finished object sit together under Ready-made, with Shakl and Naqsh next to them',async({page})=>{
 await page.goto('/ar/vector-cleanup');
 await expect(page.getByText('قوالب جاهزة',{exact:true}).first()).toBeVisible();
 await page.goto('/en/vector-cleanup');
 const section=page.locator('.nav-group').filter({hasText:'Ready-made'});
 // The group is one entry in the sidebar; its makers are picked on the page.
 await expect(section.getByRole('link',{name:'All ready-made templates'})).toBeVisible();
 for(const name of ['Polygon box','Gear maker','Ruler maker']) await expect(section.getByRole('link',{name,exact:true})).toHaveCount(0);
 await section.getByRole('link',{name:'All ready-made templates'}).click();
 await expect(page).toHaveURL(/\/en\/product-templates$/);
 // One product list holds the templates and every maker, grille patterns too.
 const picker=page.getByRole('group',{name:'Product'});
 for(const name of ['QR code stand','Napkin holder','Desk organizer']) await expect(picker.getByRole('button',{name,exact:true})).toBeVisible();
 for(const name of ['Polygon box','Tags & keychains','Trophy base','Gear maker','Jigsaw puzzle','Ruler maker','Grille patterns']) await expect(picker.getByRole('link',{name,exact:true})).toBeVisible();
 await expect(page.locator('.nav-group').filter({hasText:'Laser & CNC'}).getByRole('link',{name:'Grille patterns',exact:true})).toHaveCount(0);
 await expect(section.getByRole('link',{name:/Shakl/})).toHaveAttribute('href','https://shakl.omardeek.tech');
 await expect(section.getByRole('link',{name:/Naqsh/})).toHaveAttribute('href','https://naqsh.omardeek.tech');
 // Naqsh's SVG ornament also sits with the artwork tools.
 await expect(page.locator('.nav-group').filter({hasText:'Artwork'}).getByRole('link',{name:/Naqsh/})).toBeVisible();
 // The box maker stays with the working tools.
 await expect(page.locator('.nav-group').filter({hasText:'Laser & CNC'}).getByRole('link',{name:'Box maker',exact:true})).toBeVisible();
 await picker.getByRole('link',{name:'Gear maker',exact:true}).click();
 await expect(page.locator('.nav-group').filter({hasText:'Ready-made'}).getByRole('link',{name:'All ready-made templates'})).toHaveAttribute('aria-current','page');
 await expect(page.locator('.shakl-card').first()).toContainText('Looking for a ready 3D model?');
 // From a maker, a template in the list opens on the templates page.
 await page.getByRole('group',{name:'Product'}).getByRole('link',{name:'Napkin holder',exact:true}).click();
 await expect(page).toHaveURL(/\/en\/product-templates#napkin$/);
 await expect(page.getByRole('group',{name:'Product'}).getByRole('button',{name:'Napkin holder',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('group',{name:'Product'}).getByRole('link',{name:'Gear maker',exact:true}).click();
 await expect(page.locator('.shakl-card').nth(1)).toContainText('Need Arabic ornament as SVG?');
 await page.getByRole('link',{name:'Box maker',exact:true}).click();
 await expect(page.locator('.shakl-card')).toHaveCount(0);
});
test('the file check lists problems and zooms to each one',async({page})=>{
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="10" y="10" width="20" height="20" stroke="red" fill="none"/><rect x="20" y="20" width="20" height="20" stroke="red" fill="none"/><path d="M70 70 L80 70" stroke="red"/></svg>';
 await page.goto('/en/vector-cleanup');await page.getByLabel('Import vector file').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
 const check=page.locator('.file-check');
 await expect(check).toContainText('Cut lines crossing 2');await expect(check).toContainText('Open paths 1');
 await expect(page.locator('.issue-marks circle')).toHaveCount(3);
 await check.locator('li').filter({hasText:'Open paths'}).getByRole('button',{name:'Show me'}).click();
 // An eighth of the 100 mm artboard, centred on the open path's start at (70, 70).
 await expect(page.locator('.vector-paper')).toHaveAttribute('viewBox','63.75 63.75 12.5 12.5');
});
test('a nesting result is priced with its sheets and pieces',async({page})=>{
 await page.goto('/en/nesting');
 await page.getByLabel('Quantity of each part').fill('2');
 await page.getByRole('button',{name:'Arrange parts',exact:true}).click();await expect(page.getByText('Layout ready',{exact:true})).toBeVisible();
 const pieces=await page.locator('.stats-row .stat').first().locator('strong').innerText();
 await page.getByRole('button',{name:/^Price this job/}).click();
 await expect(page).toHaveURL(/job-quote/);
 const placed=pieces.split('/')[0].trim();
 await expect(page.locator('.from-nesting')).toContainText(`${placed} pieces`);
 await expect(page.getByLabel('Quantity',{exact:true})).toHaveValue(placed);
 await expect(page.getByRole('button',{name:'The whole order',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByLabel('Minimum price').fill('100000');
 await expect(page.getByTestId('quote-total')).toHaveText('100000.00');
});
