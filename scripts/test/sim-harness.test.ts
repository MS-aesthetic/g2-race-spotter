import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  main,
  runSimulatorHarness,
  type SimulatorHarnessDependencies,
} from '../sim-harness';

const temporaryRoots: string[] = [];

async function outputRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'g2-sim-harness-'));
  temporaryRoots.push(root);
  return join(root, 'qa');
}

function reportPath(root: string): string {
  return join(root, '2026-09-03', 'sim', 'report.json');
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
  it('writes sim-unavailable to stderr and exits non-zero without a report when the launcher fails', async () => {
    const selectedOutputRoot = await outputRoot();
    const launch = vi.fn().mockRejectedValue(new Error('not installed'));
    const runHarness = vi.fn(runSimulatorHarness);
    const stderr = vi.fn();
    const setExitCode = vi.fn();

    const result = await main({
      dependencies: dependencies({
        launch,
        resolveSimulator: vi.fn().mockResolvedValue({
          command: 'evenhub-simulator',
          args: [],
        }),
      }),
      outputRoot: selectedOutputRoot,
      runHarness,
      setExitCode,
      stderr,
    });

    expect(launch).toHaveBeenCalledOnce();
    expect(result).toEqual({
      outputRoot: selectedOutputRoot,
      success: false,
      reason: 'sim-unavailable',
    });
    expect(runHarness).toHaveBeenCalledWith(expect.anything(), {
      outputRoot: selectedOutputRoot,
    });
    expect(stderr).toHaveBeenCalledWith('sim-unavailable');
    expect(setExitCode).toHaveBeenCalledWith(1);
    await expect(access(reportPath(selectedOutputRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('cleans up after ping failure and exits non-zero without a report at its selected output root', async () => {
    const selectedOutputRoot = await outputRoot();
    const stop = vi.fn().mockResolvedValue(undefined);
    const ping = vi.fn().mockResolvedValue(false);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const runHarness = vi.fn(runSimulatorHarness);
    const stderr = vi.fn();
    const setExitCode = vi.fn();

    const result = await main({
      dependencies: dependencies({
        launch: vi.fn().mockResolvedValue({ stop }),
        ping,
        resolveSimulator: vi.fn().mockResolvedValue({
          command: 'evenhub-simulator',
          args: [],
        }),
        sleep,
      }),
      outputRoot: selectedOutputRoot,
      runHarness,
      setExitCode,
      stderr,
    });

    expect(ping).toHaveBeenCalledWith('http://127.0.0.1:9898');
    expect(result).toEqual({
      outputRoot: selectedOutputRoot,
      success: false,
      reason: 'sim-unavailable',
    });
    expect(sleep).toHaveBeenCalledTimes(25);
    expect(stop).toHaveBeenCalledOnce();
    expect(stderr).toHaveBeenCalledWith('sim-unavailable');
    expect(setExitCode).toHaveBeenCalledWith(1);
    await expect(access(reportPath(selectedOutputRoot))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
