import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasLitPixelsInSmokeTextRegion,
  main,
  runSimulatorHarness,
  type SimulatorHarnessDependencies,
} from '../sim-harness';

const temporaryRoots: string[] = [];

function pngWithTextPixel(
  red = 0,
  green = 255,
  blue = 0,
  alpha = 255,
): Uint8Array {
  const width = 576;
  const height = 288;
  const pixels = Buffer.alloc(width * height * 4);
  const offset = (24 * width + 12) * 4;
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
  pixels[offset + 3] = alpha;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    pixels.copy(scanlines, row * (width * 4 + 1) + 1, row * width * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(scanlines)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function blankPng(): Uint8Array {
  const width = 576;
  const height = 288;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(scanlines)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

async function outputRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'g2-sim-smoke-'));
  temporaryRoots.push(root);
  return join(root, 'qa');
}

function dependencies(
  overrides: Partial<SimulatorHarnessDependencies>,
): SimulatorHarnessDependencies {
  return {
    appReady: vi.fn().mockResolvedValue(true),
    launch: vi.fn(),
    launchAppServer: vi.fn(),
    ping: vi.fn().mockResolvedValue(true),
    readDeviceInfo: vi.fn().mockResolvedValue({ model: 'g2', sn: 'simulator' }),
    readScreenshot: vi.fn().mockResolvedValue(pngWithTextPixel()),
    resolveSimulator: vi.fn().mockResolvedValue({
      args: ['http://localhost:5173', '--automation-port', '9898'],
      command: 'evenhub-simulator',
    }),
    sleep: vi.fn(),
    today: vi.fn().mockReturnValue('2026-09-03'),
    versions: vi.fn().mockResolvedValue({
      sdkVersion: '0.0.12',
      simulatorVersion: '0.9.5',
    }),
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

describe('sim-harness smoke success', () => {
  it('starts and stops the scaffold and simulator, then saves screenshot and bridge evidence', async () => {
    const selectedOutputRoot = await outputRoot();
    const appStop = vi.fn().mockResolvedValue(undefined);
    const simulatorStop = vi.fn().mockResolvedValue(undefined);
    const screenshot = pngWithTextPixel();
    const automation = dependencies({
      launch: vi.fn().mockResolvedValue({ stop: simulatorStop }),
      launchAppServer: vi.fn().mockResolvedValue({ stop: appStop }),
      readScreenshot: vi.fn().mockResolvedValue(screenshot),
    });

    const result = await runSimulatorHarness(automation, {
      outputRoot: selectedOutputRoot,
    });

    const simRoot = join(selectedOutputRoot, '2026-09-03', 'sim');
    expect(result).toEqual({ outputRoot: selectedOutputRoot, success: true });
    expect(automation.appReady).toHaveBeenCalledWith('http://localhost:5173');
    expect(automation.ping).toHaveBeenCalledWith('http://127.0.0.1:9898');
    expect(automation.readDeviceInfo).toHaveBeenCalledWith(
      'http://127.0.0.1:9898',
    );
    expect(automation.readScreenshot).toHaveBeenCalledWith(
      'http://127.0.0.1:9898',
    );
    expect(await readFile(join(simRoot, 'image', 'smoke-01.png'))).toEqual(
      Buffer.from(screenshot),
    );
    const report = await readFile(join(simRoot, 'report.json'), 'utf8');
    expect(report).toContain('"sdkVersion": "0.0.12"');
    expect(report).toContain('"simulatorVersion": "0.9.5"');
    expect(report).toContain('"Hello, driver text region is lit"');
    expect(simulatorStop).toHaveBeenCalledOnce();
    expect(appStop).toHaveBeenCalledOnce();
  });

  it('waits for rendered pixels even when device info arrives before page readiness', async () => {
    const selectedOutputRoot = await outputRoot();
    const appStop = vi.fn().mockResolvedValue(undefined);
    const simulatorStop = vi.fn().mockResolvedValue(undefined);
    const screenshot = vi
      .fn()
      .mockResolvedValueOnce(blankPng())
      .mockResolvedValueOnce(pngWithTextPixel());
    const automation = dependencies({
      launch: vi.fn().mockResolvedValue({ stop: simulatorStop }),
      launchAppServer: vi.fn().mockResolvedValue({ stop: appStop }),
      readDeviceInfo: vi.fn().mockResolvedValue({ model: 'g2', sn: 'early' }),
      readScreenshot: screenshot,
    });

    await expect(
      runSimulatorHarness(automation, { outputRoot: selectedOutputRoot }),
    ).resolves.toEqual({ outputRoot: selectedOutputRoot, success: true });

    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(automation.sleep).toHaveBeenCalledWith(200);
    expect(simulatorStop).toHaveBeenCalledOnce();
    expect(appStop).toHaveBeenCalledOnce();
  });

  it('records a blank screenshot as a failed assertion, not simulator unavailability', async () => {
    const selectedOutputRoot = await outputRoot();
    const appStop = vi.fn().mockResolvedValue(undefined);
    const simulatorStop = vi.fn().mockResolvedValue(undefined);
    const automation = dependencies({
      launch: vi.fn().mockResolvedValue({ stop: simulatorStop }),
      launchAppServer: vi.fn().mockResolvedValue({ stop: appStop }),
      readScreenshot: vi.fn().mockResolvedValue(blankPng()),
    });

    await expect(
      runSimulatorHarness(automation, { outputRoot: selectedOutputRoot }),
    ).resolves.toEqual({
      outputRoot: selectedOutputRoot,
      reason: 'assertion-failed',
      success: false,
    });

    const report = await readFile(
      join(selectedOutputRoot, '2026-09-03', 'sim', 'report.json'),
      'utf8',
    );
    expect(report).toContain('"pass": false');
    expect(automation.readScreenshot).toHaveBeenCalledTimes(25);
    expect(simulatorStop).toHaveBeenCalledOnce();
    expect(appStop).toHaveBeenCalledOnce();
  });
});

describe('sim-harness smoke evidence failures', () => {
  it('requires RGB brightness above 32 as well as an opaque pixel', () => {
    expect(hasLitPixelsInSmokeTextRegion(pngWithTextPixel(32, 0, 0))).toBe(
      false,
    );
    expect(hasLitPixelsInSmokeTextRegion(pngWithTextPixel(33, 0, 0))).toBe(
      true,
    );
    expect(hasLitPixelsInSmokeTextRegion(pngWithTextPixel(0, 255, 0, 0))).toBe(
      false,
    );
  });

  it('exits non-zero, cleans up, and writes no success evidence when device info is missing', async () => {
    const selectedOutputRoot = await outputRoot();
    const appStop = vi.fn().mockResolvedValue(undefined);
    const simulatorStop = vi.fn().mockResolvedValue(undefined);
    const stderr = vi.fn();
    const setExitCode = vi.fn();
    const automation = dependencies({
      launch: vi.fn().mockResolvedValue({ stop: simulatorStop }),
      launchAppServer: vi.fn().mockResolvedValue({ stop: appStop }),
      readDeviceInfo: vi.fn().mockResolvedValue(undefined),
    });

    const result = await main({
      dependencies: automation,
      outputRoot: selectedOutputRoot,
      setExitCode,
      stderr,
    });

    expect(result).toEqual({
      outputRoot: selectedOutputRoot,
      reason: 'evidence-failed',
      success: false,
    });
    expect(automation.ping).toHaveBeenCalledWith('http://127.0.0.1:9898');
    expect(automation.readDeviceInfo).toHaveBeenCalledTimes(25);
    expect(automation.readScreenshot).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith('evidence-failed');
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(simulatorStop).toHaveBeenCalledOnce();
    expect(appStop).toHaveBeenCalledOnce();
    await expect(
      readFile(join(selectedOutputRoot, '2026-09-03', 'sim', 'report.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exits non-zero, cleans up, and writes no success evidence when device info is rejected', async () => {
    const selectedOutputRoot = await outputRoot();
    const appStop = vi.fn().mockResolvedValue(undefined);
    const simulatorStop = vi.fn().mockResolvedValue(undefined);
    const stderr = vi.fn();
    const setExitCode = vi.fn();
    const automation = dependencies({
      launch: vi.fn().mockResolvedValue({ stop: simulatorStop }),
      launchAppServer: vi.fn().mockResolvedValue({ stop: appStop }),
      readDeviceInfo: vi.fn().mockRejectedValue(new Error('console failed')),
    });

    const result = await main({
      dependencies: automation,
      outputRoot: selectedOutputRoot,
      setExitCode,
      stderr,
    });

    expect(result).toEqual({
      outputRoot: selectedOutputRoot,
      reason: 'evidence-failed',
      success: false,
    });
    expect(automation.ping).toHaveBeenCalledWith('http://127.0.0.1:9898');
    expect(automation.readDeviceInfo).toHaveBeenCalledOnce();
    expect(automation.readScreenshot).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith('evidence-failed');
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(simulatorStop).toHaveBeenCalledOnce();
    expect(appStop).toHaveBeenCalledOnce();
    await expect(
      readFile(join(selectedOutputRoot, '2026-09-03', 'sim', 'report.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
