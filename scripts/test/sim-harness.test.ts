import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runSimulatorHarness,
  type SimulatorHarnessDependencies,
} from '../sim-harness';

const temporaryRoots: string[] = [];

async function reportPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'g2-sim-harness-'));
  temporaryRoots.push(root);
  return join(root, 'qa', '2026-09-03', 'sim', 'report.json');
}

function dependencies(
  overrides: Partial<SimulatorHarnessDependencies>,
): SimulatorHarnessDependencies {
  return {
    launch: vi.fn(),
    ping: vi.fn(),
    resolveSimulator: vi.fn(),
    sleep: vi.fn(),
    ...overrides,
  } as SimulatorHarnessDependencies;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('sim-harness unavailable simulator handling', () => {
  it('returns sim-unavailable without a report when the launcher fails', async () => {
    const expectedReportPath = await reportPath();
    const launch = vi.fn().mockRejectedValue(new Error('not installed'));
    const result = await runSimulatorHarness(
      dependencies({
        launch,
        resolveSimulator: vi.fn().mockResolvedValue({
          command: 'evenhub-simulator',
          args: [],
        }),
      }),
    );

    expect(result).toEqual({ success: false, reason: 'sim-unavailable' });
    expect(launch).toHaveBeenCalledOnce();
    await expect(access(expectedReportPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('returns sim-unavailable and stops the simulator when automation ping fails', async () => {
    const expectedReportPath = await reportPath();
    const stop = vi.fn().mockResolvedValue(undefined);
    const ping = vi.fn().mockResolvedValue(false);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await runSimulatorHarness(
      dependencies({
        launch: vi.fn().mockResolvedValue({ stop }),
        ping,
        resolveSimulator: vi.fn().mockResolvedValue({
          command: 'evenhub-simulator',
          args: [],
        }),
        sleep,
      }),
    );

    expect(result).toEqual({ success: false, reason: 'sim-unavailable' });
    expect(ping).toHaveBeenCalledWith('http://127.0.0.1:9898');
    expect(sleep).toHaveBeenCalledTimes(25);
    expect(stop).toHaveBeenCalledOnce();
    await expect(access(expectedReportPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
