import { rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

// Next's type generator does not remove route declarations for deleted files.
// Clear only its ignored/reproducible type output before regenerating it so a
// deleted server route cannot keep breaking or misleading the static build.
const generatedTypes = resolve(process.cwd(), '.next', 'types');
if (basename(generatedTypes) !== 'types' || basename(dirname(generatedTypes)) !== '.next') {
  throw new Error('Refusing to remove an unexpected path.');
}
rmSync(generatedTypes, { recursive: true, force: true });
