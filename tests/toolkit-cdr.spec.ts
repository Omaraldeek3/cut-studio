import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
const fixture='C:/Program Files/Corel/CorelDRAW Technical Suite/27/Draw/CustomMediaStrokes/Mosaic/spray_16.cdr';
const headers=(baseURL:string|undefined)=>({'content-type':'application/octet-stream','x-cutstudio-conversion':'cdr','origin':new URL(baseURL||'http://localhost:3000').origin});

test('CDR service reports availability without disclosing machine paths',async({request})=>{
 const response=await request.get('/api/tools/cdr');expect(response.ok()).toBe(true);const body=await response.json();expect(body.available).toBe(true);expect(body.maxBytes).toBe(10*1024*1024);expect(JSON.stringify(body)).not.toMatch(/C:\\|\.tools/);
});
test('CDR conversion rejects foreign origins and invalid binary files',async({request,baseURL})=>{
 expect((await request.post('/api/tools/cdr',{headers:{...headers(baseURL),origin:'https://example.com'},data:Buffer.from('not a CDR')})).status()).toBe(403);
 const invalid=await request.post('/api/tools/cdr',{headers:headers(baseURL),data:Buffer.from('not a CDR')});expect(invalid.status()).toBe(400);expect((await invalid.json()).error).toMatch(/CDR/);
});
test('real CDR vector file converts locally with physical page dimensions',async({request,page,baseURL})=>{
 test.skip(!existsSync(fixture),'Local CorelDRAW sample is not installed.');
 const response=await request.post('/api/tools/cdr',{headers:headers(baseURL),data:readFileSync(fixture)});expect(response.ok()).toBe(true);const {xhtml}=await response.json();
 expect(xhtml).toContain('svg:path');expect(xhtml).toContain('width="11.0000in"');
 await page.goto('/en/nesting');await page.getByLabel('Import vector file').setInputFiles(fixture);
 await expect(page.getByText(/\d+ parts loaded/)).toBeVisible({timeout:40000});await expect(page.getByText('spray_16.cdr')).toBeVisible();
 await expect(page.getByText('279.4 × 215.9 mm',{exact:true})).toBeVisible();
});
