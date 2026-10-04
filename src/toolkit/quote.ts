import type { Drawing } from './types';
import { jobEstimate } from './generators';

/* A job quote: what a job costs the workshop and what to charge for it.
   Machine time comes from the artwork's cut and engrave lengths when there
   is artwork, or from minutes typed in when there is not. */

export type QuoteOptions = {
  copies: number;
  /** Whether the artwork is one piece (timed once per piece) or the whole order (timed once). */
  artwork: 'piece' | 'order';
  /** Profit as a markup on cost, or as a margin: the share of the selling price that is profit. */
  profitMode: 'markup' | 'margin';
  /** Price of one sheet of material, and how many sheets the job uses. */
  sheetPrice: number; sheets: number;
  /** Machine settings used to time the artwork. */
  cutSpeed: number; engraveSpeed: number; pierce: number; travel: number;
  /** Machine time when there is no artwork, in minutes for the whole job. */
  minutes: number;
  /** What an hour on the machine costs. */
  rate: number;
  /** Labour and extras for the whole job (design, cleaning, packing). */
  labour: number;
  overhead: number; profit: number;
};

export const defaultQuote: QuoteOptions = {
  copies: 10, artwork: 'piece', profitMode: 'markup', sheetPrice: 45, sheets: 1, cutSpeed: 15, engraveSpeed: 120, pierce: 0.3, travel: 15,
  minutes: 20, rate: 30, labour: 20, overhead: 10, profit: 30,
};

function check(value: number, min: number, max: number, name: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
}

export function quote(d: Drawing | null, o: QuoteOptions) {
  check(o.copies, 1, 100000, 'Quantity'); check(o.sheetPrice, 0, 1e7, 'Sheet price'); check(o.sheets, 0, 10000, 'Sheets');
  check(o.minutes, 0, 1e6, 'Machine minutes'); check(o.rate, 0, 1e6, 'Machine rate'); check(o.labour, 0, 1e7, 'Labour');
  check(o.overhead, 0, 1000, 'Overhead'); check(o.profit, 0, o.profitMode === 'margin' ? 95 : 1000, 'Profit');
  const copies = Math.round(o.copies);
  const job = d ? jobEstimate(d, { cutSpeed: o.cutSpeed, engraveSpeed: o.engraveSpeed, pierce: o.pierce, travel: o.travel, copies: o.artwork === 'order' ? 1 : copies, rate: o.rate }) : null;
  const seconds = job ? job.seconds : o.minutes * 60;
  const material = o.sheetPrice * o.sheets;
  const machine = (seconds / 3600) * o.rate;
  const base = material + machine + o.labour;
  const overhead = (base * o.overhead) / 100;
  const cost = base + overhead;
  // A 30% markup adds 30% of the cost; a 30% margin leaves 30% of the price as profit.
  const total = o.profitMode === 'margin' ? cost / (1 - o.profit / 100) : cost * (1 + o.profit / 100);
  const profit = total - cost;
  return { copies, job, seconds, material, machine, labour: o.labour, overhead, cost, profit, total, perPiece: total / copies };
}

export type Quote = ReturnType<typeof quote>;

/** A short quote to send a customer, in Arabic or English. */
export function quoteMessage(q: Quote, currency: string, job: string, lang: 'ar' | 'en', time: string) {
  const money = (v: number) => v.toFixed(2);
  return lang === 'ar'
    ? [`عرض سعر${job ? `: ${job}` : ''}`, `الكمية: ${q.copies} قطعة`, `سعر القطعة: ${money(q.perPiece)} ${currency}`, `الإجمالي: ${money(q.total)} ${currency}`, `وقت التشغيل على الماكينة: ${time}`].join('\n')
    : [`Quote${job ? `: ${job}` : ''}`, `Quantity: ${q.copies} pieces`, `Price per piece: ${money(q.perPiece)} ${currency}`, `Total: ${money(q.total)} ${currency}`, `Machine time: ${time}`].join('\n');
}
