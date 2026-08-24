import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const defaultNextCliEntry = require.resolve('next/dist/bin/next');

export function resolveNextCliInvocation(
  args,
  nodeExecutable = process.execPath,
  cliEntry = defaultNextCliEntry,
) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('Next.js arguments must be explicit strings.');
  }
  return { executable: nodeExecutable, args: [cliEntry, ...args] };
}
