import {test,expect} from '@playwright/test';
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
