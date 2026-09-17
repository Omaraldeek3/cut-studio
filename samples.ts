import type { Drawing, Shape } from './types';
const poly=(id:string,points:number[][]):Shape=>({id,name:id,contours:[{closed:true,points:points.map(([x,y])=>({x,y}))}]});
export function sampleDrawing():Drawing{
  const tag=poly('Tag',[[10,10],[60,10],[75,25],[75,55],[10,55]]);
  tag.contours.push({closed:true,points:Array.from({length:24},(_,i)=>({x:61+4*Math.cos(i*Math.PI/12),y:25+4*Math.sin(i*Math.PI/12)}))});
  const bracket=poly('Bracket',[[100,10],[170,10],[170,28],[122,28],[122,77],[100,77]]);
  const disc=poly('Disc',Array.from({length:48},(_,i)=>[225+33*Math.cos(i*Math.PI/24),44+33*Math.sin(i*Math.PI/24)]));
  const hex=poly('Hexagon',Array.from({length:6},(_,i)=>[46+35*Math.cos(i*Math.PI/3),125+35*Math.sin(i*Math.PI/3)]));
  const stand=poly('Stand',[[100,100],[162,100],[162,115],[140,115],[140,154],[122,154],[122,115],[100,115]]);
  const plaque=poly('Plaque',[[196,103],[258,103],[268,113],[268,148],[258,158],[196,158],[186,148],[186,113]]);
  return {width:280,height:170,shapes:[tag,bracket,disc,hex,stand,plaque]};
}
export const referenceDrawing:Drawing={width:110,height:110,shapes:[poly('100 mm reference',[[5,5],[105,5],[105,105],[5,105]])]};
