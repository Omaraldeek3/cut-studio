import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
test('CDR page extraction keeps pages and curves, removes paint definitions, text and bitmaps',async({page})=>{
 await page.goto('about:blank');
 const source=readFileSync('src/toolkit/cdr-pages.ts','utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 await page.addScriptTag({content:`window.exports={}; ${code}; window.extractCdrPages=exports.extractCdrPages;`});
 const converted=await page.evaluate(()=>{
  const convert=(window as unknown as {extractCdrPages:(s:string)=>{svg:string;skippedText:number;skippedImages:number}[]}).extractCdrPages;
  return convert('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:s="http://www.w3.org/2000/svg"><body><s:svg width="100mm" height="50mm"><s:defs><s:linearGradient id="g"/></s:defs><s:text x="1" y="2"><s:tspan font-family="DecoType Naskh">نص</s:tspan></s:text><s:image width="5" height="5" xlink:href="data:image/png;base64,AA==" xmlns:xlink="http://www.w3.org/1999/xlink"/><s:path d="M0 0H10V10Z" style="fill: url(#g); stroke:none; stroke-dasharray: none; stroke-dashoffset: 0"/></s:svg><s:svg width="20mm" height="10mm"><s:circle r="5" style="stroke-dasharray: 2 3; stroke-dashoffset: 1; transform:scale(2)"/></s:svg></body></html>');
 });
 const pages=converted.map(p=>p.svg);
 expect(converted.map(p=>[p.skippedText,p.skippedImages])).toEqual([[1,1],[0,0]]);expect(pages[0]).not.toContain('text');expect(pages[0]).not.toContain('image');
 expect(pages).toHaveLength(2);expect(pages[0]).toContain('width="100mm"');expect(pages[0]).toContain('M0 0H10V10Z');expect(pages[0]).not.toContain('linearGradient');expect(pages[0]).not.toContain('url(');
 expect(pages[0]).not.toContain('stroke-dasharray');expect(pages[0]).not.toContain('stroke-dashoffset');
 expect(pages[1]).toContain('stroke-dasharray: 2 3');expect(pages[1]).toContain('stroke-dashoffset: 1');expect(pages[1]).toContain('transform:scale(2)');
});
