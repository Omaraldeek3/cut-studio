import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('nesting runs locally and exports a dimensioned DXF',async({page})=>{
  await page.goto('/en/nesting');
  await expect(page.getByRole('heading',{name:'Material nesting'})).toBeVisible();
  await page.getByRole('button',{name:'Arrange parts',exact:true}).click();
  await expect(page.getByText('Layout ready',{exact:true})).toBeVisible({timeout:30000});
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export DXF',exact:true}).click();const d=await pending;expect(d.suggestedFilename()).toMatch(/\.dxf$/);
  const content=await readFile((await d.path())!,'utf8');expect(content).toContain('$INSUNITS\n70\n4');expect(content.match(/\nPOLYLINE\n/g)?.length).toBe(7);expect(content.trim()).toMatch(/EOF$/);
  await page.getByLabel('Sheet width').fill('100');
  await expect(page.getByRole('button',{name:'Export DXF',exact:true})).toBeDisabled();
});
test('all workspaces expose working outputs and calculated values',async({page})=>{
  await page.goto('/en/nesting');
  await page.getByRole('link',{name:'Resize & repeat',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Resize & repeat'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Export SVG',exact:true})).toBeEnabled();
  await page.getByRole('link',{name:'Job quote',exact:true}).click();
  await page.getByText('Time it from the artwork',{exact:true}).click();
  await page.getByLabel('Quantity').fill('10');await page.getByLabel('Sheet price').fill('50');await page.getByLabel('Sheets used').fill('2');
  await page.getByLabel('Machine time for the whole job').fill('30');await page.getByLabel('Machine rate per hour').fill('20');
  await page.getByLabel('Labour and extras for the job').fill('0');await page.getByLabel('Overhead').fill('0');await page.getByLabel('Profit').fill('10');
  await expect(page.getByTestId('quote-total')).toHaveText('121.00');
  await expect(page.getByTestId('quote-each')).toHaveText('12.10 ILS');
  await page.getByRole('link',{name:'Fit test',exact:true}).click();await expect(page.getByRole('button',{name:'Export DXF',exact:true})).toBeEnabled();
  await page.getByRole('link',{name:'Vector cleanup',exact:true}).click();await page.getByRole('button',{name:'Apply cleanup',exact:true}).click();await expect(page.getByRole('button',{name:'Export SVG',exact:true})).toBeEnabled();
});
test('trace and engraving generate real downloads from sample pixels',async({page})=>{
  await page.goto('/en/nesting');await page.getByRole('link',{name:'Image to vector',exact:true}).click();
  await expect(page.getByText('Vector ready',{exact:true})).toBeVisible({timeout:30000});
  await page.getByLabel('Width').fill('100');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export SVG',exact:true}).click();const file=await pending;expect(file.suggestedFilename()).toMatch(/\.svg$/);
  const svg=await readFile((await file.path())!,'utf8');expect(svg).toContain('width="100mm"');expect(svg).toContain('<path');expect(svg).not.toContain('<image');expect(svg).toMatch(/C[\d.]+ [\d.]+/);
  await page.getByRole('radio',{name:/Outline/}).click();await expect(page.getByText('Vector ready',{exact:true})).toBeVisible({timeout:30000});
  const dxf=page.waitForEvent('download');await page.getByRole('button',{name:'DXF',exact:true}).click();expect((await dxf).suggestedFilename()).toMatch(/outline\.dxf$/);
  await page.getByRole('link',{name:'Engraving prep',exact:true}).click();await page.getByRole('button',{name:'Use a sample photo',exact:true}).click();
  await expect(page.getByText('Ready to engrave',{exact:true})).toBeVisible({timeout:30000});
  const bmp=page.waitForEvent('download');await page.getByRole('button',{name:'BMP',exact:true}).click();
  const bmpFile=await readFile((await (await bmp).path())!);expect(bmpFile.subarray(0,2).toString()).toBe('BM');expect(bmpFile.readInt32LE(38)).toBe(10000);
});
test('unsupported artwork gives an actionable error and cannot export stale layout',async({page})=>{
  await page.goto('/en/nesting');
  await page.getByLabel('Import vector file').setInputFiles({name:'text.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm"><text>Hello</text></svg>')});
  await expect(page.locator('.error-note[role="alert"]')).toContainText(/text|outline|curves/i);
  await expect(page.getByRole('button',{name:'Export DXF',exact:true})).toBeDisabled();
  await page.getByLabel('Import vector file').setInputFiles({name:'mixed.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect width="40" height="30"/><text>Hello</text></svg>')});
  await expect(page.getByText('1 parts loaded')).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Ignored 1 text object'})).toBeVisible();
  await page.getByRole('button',{name:'Arrange parts',exact:true}).click();
  await expect(page.getByText('Layout ready',{exact:true})).toBeVisible({timeout:30000});
});
test('a physical SVG uploads, nests and reexports at the requested scale',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/en/nesting');
  await page.getByLabel('Import vector file').setInputFiles({name:'reference.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="110mm" height="110mm" viewBox="0 0 110 110"><path d="M5 5H105V105H5Z"/></svg>')});
  await expect(page.getByText('1 parts loaded')).toBeVisible();await page.getByLabel('Quantity of each part').fill('1');
  await page.getByRole('button',{name:'Arrange parts',exact:true}).click();await expect(page.getByText('Layout ready',{exact:true})).toBeVisible();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export DXF',exact:true}).click();const text=await readFile((await(await pending).path())!,'utf8');
  const lines=text.trim().split('\n');const xs:number[]=[],ys:number[]=[];
  for(let i=0;i<lines.length;i+=2){if(lines[i]==='0'&&lines[i+1]==='VERTEX'){for(let j=i+2;lines[j]!=='0';j+=2){if(lines[j]==='10')xs.push(+lines[j+1]);if(lines[j]==='20')ys.push(+lines[j+1]);}}}
  expect(Math.max(...xs)-Math.min(...xs)).toBeCloseTo(100,4);expect(Math.max(...ys)-Math.min(...ys)).toBeCloseTo(100,4);expect(errors).toEqual([]);
});
test('all mobile Arabic workspaces fit the viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/en/nesting');await page.getByRole('link',{name:'العربية',exact:true}).click();
  for(const name of ['تحويل صورة إلى فيكتور','تنظيف الفيكتور','المقاس والتكرار','عرض السعر','اختبار التعشيق','تجهيز صور الحفر','صانع الصناديق']){
    // On a phone the tools are chosen from one list rather than the strip.
    const value=await page.locator('.tool-picker option').filter({hasText:name}).first().getAttribute('value');
    await page.getByLabel('الأداة').selectOption(value!);await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),name).toBe(true);
  }
});
test('Arabic and mobile layouts keep controls reachable without overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/en/nesting');
  await page.getByRole('link',{name:'العربية',exact:true}).click();
  await expect(page.getByRole('heading',{name:'ترتيب القطع'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('box maker builds every box type, dividers, labels and a 3D view, then nests',async({page})=>{
  test.setTimeout(90000);
  await page.goto('/en/nesting');await page.getByRole('link',{name:'Box maker',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Box maker'})).toBeVisible();
  await page.getByLabel('Dimensions are').selectOption('inside');await page.getByLabel(/^Width/).fill('100');await page.getByLabel('Material thickness').fill('4');
  await expect(page.getByText('108 × 88 × 68',{exact:true})).toBeVisible();
  const exportSvg=async()=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export SVG',exact:true}).click();const file=await pending;return {name:file.suggestedFilename(),svg:await readFile((await file.path())!,'utf8')};};
  const closed=await exportSvg();expect(closed.name).toBe('closed-box-108x88x68-4mm.svg');
  expect(closed.svg.match(/stroke="#ff0000"/g)?.length).toBe(6);expect(closed.svg.match(/stroke="#0000ff"/g)?.length).toBe(6);
  for(const [type,parts] of [['Open tray',5],['Lift-off lid',7],['Sliding lid',6],['Drawer',11]] as const){
    await page.getByRole('radio',{name:type,exact:true}).click();
    await expect(page.locator('.stat').filter({hasText:'Parts'}).locator('strong')).toHaveText(String(parts));
    await expect(page.locator('.parts-list tbody tr')).toHaveCount(parts);
    expect((await exportSvg()).svg.match(/stroke="#ff0000"/g)?.length,type).toBe(parts);
  }
  await page.getByRole('radio',{name:'Open tray',exact:true}).click();
  await page.getByLabel(/^Rows/).fill('1');await page.getByLabel(/^Columns/).fill('2');
  await expect(page.locator('.parts-list tbody tr')).toHaveCount(8);
  await page.getByRole('tab',{name:'3D view'}).click();
  const canvas=page.getByTestId('box-3d-canvas');await expect(canvas).toBeVisible({timeout:20000});
  expect(await canvas.evaluate(c=>{const el=c as HTMLCanvasElement;return el.width>0&&el.height>0;})).toBe(true);
  await page.getByLabel('Explode view').fill('0.6');
  await page.getByLabel(/^Height/).fill('5');await expect(page.locator('.error-note[role="alert"]')).toContainText(/too small/i);
  await expect(page.getByRole('button',{name:'Export SVG',exact:true})).toBeDisabled();
  await page.getByLabel(/^Height/).fill('60');
  await page.getByRole('button',{name:'Arrange on sheet',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Material nesting'})).toBeVisible();await expect(page.getByText('8 parts loaded')).toBeVisible();
  await page.getByLabel('Sheet width').fill('600');await page.getByLabel('Quantity of each part').fill('1');
  await page.getByRole('button',{name:'Arrange parts',exact:true}).click();
  await expect(page.getByText('Layout ready',{exact:true})).toBeVisible({timeout:30000});
});
test('box maker flat edges make glued panels without fingers and still nest',async({page})=>{
  await page.goto('/en/nesting');await page.getByRole('link',{name:'Box maker',exact:true}).click();
  const row=(name:string)=>page.locator('.parts-list tbody tr').filter({has:page.getByRole('cell',{name,exact:true})});
  await expect(row('Bottom').locator('td').nth(1)).toHaveText('120 × 80');
  await page.locator('label.toggle',{hasText:'Bottom edges'}).click();await expect(page.getByLabel('Bottom edges')).toBeChecked();
  await expect(row('Bottom').locator('td').nth(1)).toHaveText('114 × 74');
  await page.locator('label.toggle',{hasText:'Vertical corners'}).click();await page.locator('label.toggle',{hasText:'Top edges'}).click();
  await expect(row('Left').locator('td').nth(1)).toHaveText('74 × 60');
  await page.getByRole('radio',{name:'Open tray',exact:true}).click();
  await expect(page.getByLabel('Top edges')).toHaveCount(0);
  await expect(page.locator('.parts-list tbody tr')).toHaveCount(5);
  await page.getByRole('button',{name:'Arrange on sheet',exact:true}).click();
  await expect(page.getByText('5 parts loaded')).toBeVisible();
  await page.getByRole('button',{name:'Arrange parts',exact:true}).click();
  await expect(page.getByText('Layout ready',{exact:true})).toBeVisible({timeout:30000});
});
test('nesting places each part once by default and takes a quantity per part',async({page})=>{
  await page.goto('/en/nesting');
  await expect(page.getByLabel('Quantity of each part')).toHaveValue('1');
  await expect(page.getByText('6 pieces in this job')).toBeVisible();
  await page.getByLabel('Quantity of part 1').fill('0');await page.getByLabel('Quantity of part 3').fill('4');
  await expect(page.getByText('8 pieces in this job')).toBeVisible();
  await page.getByRole('button',{name:'Arrange parts',exact:true}).click();
  await expect(page.getByText('Layout ready',{exact:true})).toBeVisible({timeout:30000});
  await expect(page.locator('.stat').filter({hasText:'Pieces placed'})).toContainText('8 / 8');
  await page.getByLabel('Quantity of each part').fill('0');
  await expect(page.locator('.error-note')).toContainText('above 0');
  await expect(page.getByRole('button',{name:'Arrange parts',exact:true})).toBeDisabled();
});
