// Generates samples/mt4-history-sample.csv: 80 XAUUSD positions with a realistic "tilt after losses" pattern.
// Includes Account/Name columns on purpose — the importer must drop them.
import { writeFileSync } from 'node:fs';

let s = 42;
const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) =>
  `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

const planNotes = [
  'London breakout retest, structure clean',
  'NY open liquidity sweep then reclaim',
  'Pullback to 4h demand, confirmation candle',
  'Asia range break with retest',
];
const tiltNotes = [
  'Need to make back the last loss',
  'Missed the move, jumping in before it runs',
  'Price is flying, getting in now',
  'Bored, small scalp',
  'Should have held last one, going bigger',
];

const rows = [
  [
    'Ticket',
    'Account',
    'Name',
    'Open Time',
    'Type',
    'Size',
    'Item',
    'Price',
    'S / L',
    'T / P',
    'Close Time',
    'Close Price',
    'Commission',
    'Profit',
    'Comment',
  ],
];
let day = Date.UTC(2026, 5, 1);
let ticket = 7001000;
let lossStreak = 0;
while (rows.length < 81) {
  const d = new Date(day);
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
    let t = day + (7 + Math.floor(rnd() * 3)) * 3600e3;
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n && rows.length < 81; i++) {
      const tilt = lossStreak >= 1 && rnd() < 0.55;
      const long = rnd() < 0.55;
      const entry = +(2300 + rnd() * 150).toFixed(2);
      const riskPts = 8 + Math.floor(rnd() * 6);
      const size = tilt ? 1.0 : 0.5;
      const stop = +(long ? entry - riskPts : entry + riskPts).toFixed(2);
      const target = +(long ? entry + riskPts * 2 : entry - riskPts * 2).toFixed(2);
      const p = rnd();
      let r;
      if (tilt) r = p < 0.3 ? 1.2 : p < 0.85 ? -1 : -0.4;
      else r = p < 0.45 ? 2 : p < 0.55 ? 0.6 : -1;
      const exit = +(entry + (long ? 1 : -1) * r * riskPts).toFixed(2);
      const close = t + (20 + Math.floor(rnd() * 90)) * 60e3;
      const profit = +((exit - entry) * (long ? 1 : -1) * size * 100).toFixed(2);
      const note = tilt
        ? tiltNotes[Math.floor(rnd() * tiltNotes.length)]
        : planNotes[Math.floor(rnd() * planNotes.length)];
      rows.push([
        ticket++,
        '51234567',
        'Jo Trader',
        fmt(new Date(t)),
        long ? 'buy' : 'sell',
        size.toFixed(2),
        'xauusd',
        entry,
        stop,
        target,
        fmt(new Date(close)),
        exit,
        '-3.50',
        profit,
        note,
      ]);
      lossStreak = profit < 0 ? lossStreak + 1 : 0;
      t = close + (tilt || profit < 0 ? 5 + Math.floor(rnd() * 20) : 45 + Math.floor(rnd() * 120)) * 60e3;
    }
  }
  day += 86400e3;
}
writeFileSync(
  new URL('../samples/mt4-history-sample.csv', import.meta.url),
  rows.map((r) => r.map((c) => (/[",]/.test(String(c)) ? `"${c}"` : c)).join(',')).join('\n') + '\n',
);
console.log('wrote', rows.length - 1, 'rows');
