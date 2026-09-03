import { describe, expect, it } from 'vitest';

type ExecFileSync = (
  file: string,
  args: readonly string[],
  options: { cwd: URL; encoding: 'utf8' },
) => string;

const nodeProcess = (
  globalThis as typeof globalThis & {
    process: { execPath: string };
  }
).process;

const workspaceConsumer = new URL('../../../apps/spotter/', import.meta.url);
const compilerFixture = new URL('./fixtures/consumer/', import.meta.url);

const consumerProgram = `
  import {
    createInitialState,
    isSetLane,
    reduce,
  } from '@g2-race-spotter/protocol';

  if (!isSetLane({ t: 'lane', lane: 'top' })) {
    throw new Error('bare package guard import failed');
  }

  const next = reduce(
    createInitialState(),
    { t: 'lane', lane: 'top', role: 'spotter' },
    { now: 1, newId: () => 'unused' },
  );

  if (next.lane !== 'top' || next.seq !== 1 || next.updatedAt !== 1) {
    throw new Error('bare package reducer import failed');
  }
`;

describe('protocol package root', () => {
  it('works through a plain Node workspace-consumer bare import', async () => {
    // @ts-expect-error This workspace intentionally has no @types/node dependency.
    const { execFileSync } = (await import('node:child_process')) as {
      execFileSync: ExecFileSync;
    };

    expect(
      execFileSync(
        nodeProcess.execPath,
        ['--input-type=module', '--eval', consumerProgram],
        { cwd: workspaceConsumer, encoding: 'utf8' },
      ),
    ).toBe('');
  });

  it('compiles from a real consumer tsconfig that imports the package root', async () => {
    // @ts-expect-error This workspace intentionally has no @types/node dependency.
    const { execFileSync } = (await import('node:child_process')) as {
      execFileSync: ExecFileSync;
    };

    expect(
      execFileSync(
        nodeProcess.execPath,
        [
          '../../../../../node_modules/typescript/bin/tsc',
          '--pretty',
          'false',
          '--project',
          'tsconfig.json',
        ],
        { cwd: compilerFixture, encoding: 'utf8' },
      ),
    ).toBe('');
  });
});
