const SVG='http://www.w3.org/2000/svg';
export const MAX_CDR_XHTML=64*1024*1024;
export type CdrPage={svg:string;skippedText:number;skippedImages:number};
const paint=new Set(['fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-miterlimit','opacity','color']);
function harmlessPaint(declaration:string){
 const separator=declaration.indexOf(':');
 if(separator<0)return false;
 const property=declaration.slice(0,separator).trim().toLowerCase(),value=declaration.slice(separator+1).trim().toLowerCase();
 return paint.has(property)||(property==='stroke-dasharray'&&value==='none')||(property==='stroke-dashoffset'&&/^[+-]?0(?:\.0+)?(?:px|pt|mm)?$/.test(value));
}
/** Reads the local converter's XHTML as inert XML, never as inserted HTML. */
export function extractCdrPages(xhtml:string):CdrPage[]{
 if(xhtml.length>MAX_CDR_XHTML)throw new Error('Converted CDR exceeds the output size limit.');
 const document=new DOMParser().parseFromString(xhtml,'application/xml');
 if(document.querySelector('parsererror'))throw new Error('The CDR converter returned an unreadable document.');
 const roots=Array.from(document.getElementsByTagNameNS(SVG,'svg'));
 if(!roots.length)throw new Error('No vector pages were found in this CDR file.');
 if(roots.length>100)throw new Error('Use a CDR file with at most 100 pages.');
 return roots.map(root=>{
  // Paint gradients do not change a laser's cutting centerline. Keep geometry,
  // transforms and unsupported effects intact so parseSvg can validate them.
  for(const defs of Array.from(root.getElementsByTagNameNS(SVG,'defs')))defs.remove();
  // libcdr emits live text as font references and bitmaps as embedded images.
  // Neither is cutting geometry, so they are removed and reported to the user
  // instead of rejecting the whole page.
  const text=Array.from(root.getElementsByTagNameNS(SVG,'text')),images=Array.from(root.getElementsByTagNameNS(SVG,'image'));
  for(const el of [...text,...images])el.remove();
  for(const el of [root,...Array.from(root.querySelectorAll('*'))]){
   for(const name of ['fill','stroke'])if(el.hasAttribute(name))el.removeAttribute(name);
   if(el.hasAttribute('style')){
    const remaining=(el.getAttribute('style')||'').split(';').filter(s=>s.trim()).filter(declaration=>!harmlessPaint(declaration));
    if(remaining.length)el.setAttribute('style',remaining.join(';'));else el.removeAttribute('style');
   }
  }
  return {svg:new XMLSerializer().serializeToString(root),skippedText:text.length,skippedImages:images.length};
 });
}
