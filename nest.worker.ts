import { nest } from './geometry';
import type { NestOptions, Shape } from './types';
self.onmessage=(e:MessageEvent<{shapes:Shape[];options:NestOptions}>)=>{
  try{self.postMessage({result:nest(e.data.shapes,e.data.options)});}catch(error){self.postMessage({error:error instanceof Error?error.message:'Nesting failed.'});}
};
