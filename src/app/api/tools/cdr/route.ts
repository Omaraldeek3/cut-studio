import { access, mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX_BYTES=10*1024*1024;
const executable=process.env.CDR_CONVERTER_PATH||path.join(process.cwd(),'.tools','cdr','bin','cdr2xhtml.exe');
const run=promisify(execFile);
const state=globalThis as typeof globalThis & {cutStudioCdrBusy?:boolean};
const response=(body:object,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const loopback=['localhost','127.0.0.1','[::1]'];
/** Loopback Host header on the server's port. Next reports request.url as localhost even when the page uses 127.0.0.1. */
function localHost(request:Request){
 const host=request.headers.get('host');if(!host)return null;
 let parsed:URL;try{parsed=new URL(`http://${host}`);}catch{return null;}
 return loopback.includes(parsed.hostname)&&parsed.port===new URL(request.url).port?host:null;
}
function localRequest(request:Request){
 const url=new URL(request.url),host=localHost(request);
 const forwardedHost=request.headers.get('x-forwarded-host'),forwardedFor=request.headers.get('x-forwarded-for');
 return loopback.includes(url.hostname)&&!!host&&(!forwardedHost||forwardedHost===host)&&(!forwardedFor||forwardedFor.split(',').every(ip=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip.trim())));
}
/** The browser's Origin must be this same loopback host, so other sites cannot trigger conversions. */
function sameOrigin(request:Request){const host=localHost(request),origin=request.headers.get('origin');return !!host&&(origin===`http://${host}`||origin===`https://${host}`);}
async function available(){try{await access(executable);return true;}catch{return false;}}
export async function GET(request:Request){return response({available:localRequest(request)&&await available(),maxBytes:MAX_BYTES,converter:'libcdr',localOnly:true});}
export async function POST(request:Request){
 if(!localRequest(request)||!sameOrigin(request)||request.headers.get('x-cutstudio-conversion')!=='cdr')return response({error:'CDR conversion is available only from the local Cut Studio page.'},403);
 if(request.headers.get('content-type')?.split(';')[0]!=='application/octet-stream')return response({error:'Send a CDR file as binary data.'},415);
 if(Number(request.headers.get('content-length'))>MAX_BYTES)return response({error:'CDR exceeds the 10 MB limit.'},413);
 if(state.cutStudioCdrBusy)return response({error:'Another CDR file is being converted. Try again shortly.'},409);
 state.cutStudioCdrBusy=true;
 let folder='',input='';
 try{
  if(!await available())return response({error:'The local CDR converter is unavailable. Run python scripts/setup-cdr-runtime.py on this computer.'},503);
  const reader=request.body?.getReader();if(!reader)return response({error:'The CDR file is empty.'},400);
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES){await reader.cancel();return response({error:'CDR exceeds the 10 MB limit.'},413);}chunks.push(value);}
  const bytes=Buffer.concat(chunks);
  const riff=bytes.subarray(0,4).toString('ascii')==='RIFF'&&/^CDR/i.test(bytes.subarray(8,11).toString('ascii'));
  const zip=bytes.length>4&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4;
  if(bytes.length<12||!riff&&!zip)return response({error:'This is not a supported CDR file. Choose the original .cdr document.'},400);
  folder=await mkdtemp(path.join(tmpdir(),'cut-studio-cdr-'));input=path.join(folder,'input.cdr');
  await writeFile(input,bytes);
  // Argument-array invocation: never execute a shell or user-controlled command.
  const {stdout}=await run(executable,[input],{windowsHide:true,timeout:30000,maxBuffer:64*1024*1024,cwd:folder,encoding:'utf8'});
  if(!/<(?:\w+:)?svg[\s>]/i.test(stdout))return response({error:'No vector pages were found. Save a compatible CDR version with text converted to curves.'},422);
  return response({xhtml:stdout});
 }catch(error){
  const failed=error as {killed?:boolean;code?:string};
  if(failed.killed||failed.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')return response({error:'CDR conversion exceeded its time or size limit. Simplify the document and try again.'},422);
  return response({error:'This CDR file could not be converted. It may be damaged or use an unsupported CDR version. Try Save As an older CDR version in CorelDRAW.'},422);
 }finally{
  // Remove only files created in this uniquely allocated directory. Never recurse.
  if(input)await unlink(input).catch(()=>{});
  if(folder)await rmdir(folder).catch(()=>{});
  state.cutStudioCdrBusy=false;
 }
}
