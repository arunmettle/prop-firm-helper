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
