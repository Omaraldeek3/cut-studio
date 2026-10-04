import { test, expect } from '@playwright/test';
import { defaultQuote, quote, quoteMessage } from '../src/toolkit/quote';

const square = { width: 100, height: 100, shapes: [{ id: 's', name: 's', contours: [{ closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }] }] };

test('a quote adds material, machine time, labour, overhead and profit', () => {
  const q = quote(null, { ...defaultQuote, copies: 10, sheetPrice: 50, sheets: 2, minutes: 30, rate: 20, labour: 0, overhead: 0, profit: 10 });
  expect(q.material).toBe(100); expect(q.machine).toBeCloseTo(10); expect(q.total).toBeCloseTo(121); expect(q.perPiece).toBeCloseTo(12.1);
});
test('machine time comes from the artwork when there is one', () => {
  // 400 mm of cut at 10 mm/s, one pierce of 1 s, no travel: 41 s a copy, 2 copies.
  const q = quote(square, { ...defaultQuote, copies: 2, cutSpeed: 10, pierce: 1, travel: 0, rate: 3600 });
  expect(q.seconds).toBeCloseTo(82); expect(q.machine).toBeCloseTo(82);
});
test('overhead is on cost and profit on cost with overhead', () => {
  const q = quote(null, { ...defaultQuote, copies: 1, sheetPrice: 100, sheets: 1, minutes: 0, labour: 0, overhead: 10, profit: 50 });
  expect(q.cost).toBeCloseTo(110); expect(q.total).toBeCloseTo(165);
});
test('the customer message states quantity, piece price and total in both languages', () => {
  const q = quote(null, { ...defaultQuote, copies: 4, sheetPrice: 10, sheets: 1, minutes: 0, labour: 0, overhead: 0, profit: 0 });
  expect(quoteMessage(q, 'ILS', 'ميداليات', 'ar', '0:00')).toContain('سعر القطعة: 2.50 ILS');
  expect(quoteMessage(q, 'USD', '', 'en', '0:00')).toContain('Total: 10.00 USD');
});
test('impossible numbers are refused', () => {
  expect(() => quote(null, { ...defaultQuote, copies: 0 })).toThrow(/Quantity/);
  expect(() => quote(null, { ...defaultQuote, profit: -5 })).toThrow(/Profit/);
});
test('artwork holding the whole order is timed once, not once per piece', () => {
  const piece = quote(square, { ...defaultQuote, copies: 10, cutSpeed: 10, pierce: 1, travel: 0, rate: 3600 });
  const order = quote(square, { ...defaultQuote, copies: 10, artwork: 'order', cutSpeed: 10, pierce: 1, travel: 0, rate: 3600 });
  expect(piece.seconds).toBeCloseTo(410); expect(order.seconds).toBeCloseTo(41);
  expect(order.perPiece).toBeCloseTo(order.total / 10);
});
test('profit can be a margin of the selling price instead of a markup on cost', () => {
  const base = { ...defaultQuote, copies: 1, sheetPrice: 100, sheets: 1, minutes: 0, labour: 0, overhead: 0, profit: 30 };
  expect(quote(null, base).total).toBeCloseTo(130);
  const margin = quote(null, { ...base, profitMode: 'margin' });
  expect(margin.total).toBeCloseTo(142.857, 2); expect(margin.profit / margin.total).toBeCloseTo(0.3);
  expect(() => quote(null, { ...base, profitMode: 'margin', profit: 100 })).toThrow(/Profit must be between 0 and 95/);
});
