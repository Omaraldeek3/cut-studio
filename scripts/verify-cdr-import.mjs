import {chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/verify-cdr-import.mjs <original.cdr>');
const digest=async()=>createHash('sha256').update(await readFile(file)).digest('hex');
const before=await digest();
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();
 await page.goto(process.env.TOOLKIT_URL||'http://localhost:3012/tools');
 const conversion=page.waitForResponse(response=>response.url().endsWith('/api/tools/cdr')&&response.request().method()==='POST');
 await page.getByLabel('Import vector file').setInputFiles(file);
 await conversion;
 const result=page.locator('.error-note').or(page.locator('.file-chip small').filter({hasText:/\d+ parts loaded/}));
 await result.waitFor({timeout:45000});
 const error=await page.locator('.error-note').allTextContents();
 console.log(JSON.stringify({imported:error.length===0,message:error[0]||await result.textContent(),originalUnchanged:before===await digest()}));
}finally{await browser.close();}
