import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findAnonymousRepositoryRuntimeReferences } from './desktop-runtime-independence.mjs';

describe('Desktop runtime repository independence', () => {
  it('accepts local assets and the reviewed Firebase/Google runtime origins', () => {
    const findings = findAnonymousRepositoryRuntimeReferences([
      {
        path: 'runtime.ts',
        text: [
          "const icon = './icon.png';",
          "const auth = 'https://identitytoolkit.googleapis.com';",
          "const api = 'https://europe-west1-life-tracker-12000.cloudfunctions.net';",
        ].join('\n'),
      },
    ]);

    assert.deepEqual(findings, []);
  });

  it('rejects Pages, raw/content, API, release, and hosted object URLs', () => {
    const samples = [
      'https://francescopuglia.github.io/life-tracker/app.js',
      'https://raw.githubusercontent.com/owner/repository/main/config.json',
      'https://github.com/owner/repository/releases/latest/download/app.exe',
      'https://github.com/owner/repository/archive/refs/heads/main.zip',
      'https://codeload.github.com/owner/repository/zip/refs/heads/main',
      'https://api.github.com/repos/owner/repository/releases/latest',
      'https://release-assets.githubusercontent.com/github-production-release-asset/file',
    ];

    const findings = findAnonymousRepositoryRuntimeReferences(
      samples.map((text, index) => ({ path: `sample-${index}.txt`, text })),
    );

    assert.equal(findings.length, samples.length);
    assert.deepEqual(findings.map((finding) => finding.line), [1, 1, 1, 1, 1, 1, 1]);
    assert.equal(findings.every((finding) => !('matchedText' in finding)), true);
  });

  it('reports only the path, line, and bounded rule label', () => {
    const [finding] = findAnonymousRepositoryRuntimeReferences([
      {
        path: 'src/runtime.ts',
        text: "const local = true;\nconst update = 'https://objects.githubusercontent.com/private-query';",
      },
    ]);

    assert.deepEqual(finding, {
      path: 'src/runtime.ts',
      line: 2,
      label: 'GitHub-hosted object URL',
    });
  });

  it('fails closed on malformed scanner input', () => {
    assert.throws(
      () => findAnonymousRepositoryRuntimeReferences([{ path: 'runtime.ts' }]),
      /string path and text fields/,
    );
  });
});
