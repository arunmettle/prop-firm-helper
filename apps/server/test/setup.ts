// Captures everything written to stdout/stderr during the suite so the privacy test can grep it.
import { captured } from './logCapture.js';

const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  captured.push(String(chunk));
  return (origOut as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;
process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
  captured.push(String(chunk));
  return (origErr as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stderr.write;

// Vitest routes console.* through its own reporter, so capture those calls too.
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n');
    orig(...args);
  };
}
