import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const AUTOMATION_PORT = 9898;
const AUTOMATION_URL = `http://127.0.0.1:${AUTOMATION_PORT}`;
const APP_URL = 'http://localhost:5173';
const PING_ATTEMPTS = 25;
const PING_INTERVAL_MS = 200;
const SMOKE_TEXT_REGION = { height: 144, width: 576, x: 0, y: 0 };

export interface LaunchedProcess {
  stop(): Promise<void>;
}

export type LaunchedSimulator = LaunchedProcess;

export interface SimulatorLaunchOptions {
  args: string[];
  command: string;
}

export interface SimulatorVersions {
  sdkVersion: string;
  simulatorVersion: string;
}

export interface SimulatorHarnessDependencies {
  appReady(url: string): Promise<boolean>;
  launch(options: SimulatorLaunchOptions): Promise<LaunchedSimulator>;
  launchAppServer(): Promise<LaunchedProcess>;
  ping(url: string): Promise<boolean>;
  readDeviceInfo(url: string): Promise<unknown | undefined>;
  readScreenshot(url: string): Promise<Uint8Array>;
  resolveSimulator(): Promise<SimulatorLaunchOptions>;
  sleep(ms: number): Promise<void>;
  today(): string;
  versions(): Promise<SimulatorVersions>;
}

export interface SimulatorHarnessOptions {
  outputRoot: string;
}

export interface SimulatorHarnessResult {
  outputRoot: string;
  reason?: 'assertion-failed' | 'evidence-failed' | 'sim-unavailable';
  success: boolean;
}

export interface SimulatorHarnessMainOptions {
  dependencies?: SimulatorHarnessDependencies;
  outputRoot?: string;
  runHarness?: typeof runSimulatorHarness;
  setExitCode?: (code: number) => void;
  stderr?: (message: string) => void;
}

interface SimulatorManifest {
  bin?: Record<string, string> | string;
  version?: string;
}

interface PngHeader {
  bitDepth: number;
  colorType: number;
  height: number;
  interlace: number;
  width: number;
}

export async function resolvePinnedSimulator(
  root = process.cwd(),
): Promise<SimulatorLaunchOptions> {
  const glassesManifestPath = resolve(root, 'apps/glasses/package.json');
  const glassesManifest = JSON.parse(
    await readFile(glassesManifestPath, 'utf8'),
  ) as { devDependencies?: Record<string, string> };
  const pinnedVersion =
    glassesManifest.devDependencies?.['@evenrealities/evenhub-simulator'];
  if (!pinnedVersion) {
    throw new Error('The pinned Even Hub simulator dependency is missing.');
  }

  const requireFromGlasses = createRequire(glassesManifestPath);
  const simulatorManifestPath = requireFromGlasses.resolve(
    '@evenrealities/evenhub-simulator/package.json',
  );
  const simulatorManifest = JSON.parse(
    await readFile(simulatorManifestPath, 'utf8'),
  ) as SimulatorManifest;
  if (simulatorManifest.version !== pinnedVersion) {
    throw new Error('The installed Even Hub simulator does not match its pin.');
  }

  const bin = simulatorManifest.bin;
  const entry = typeof bin === 'string' ? bin : bin?.['evenhub-simulator'];
  if (!entry) {
    throw new Error(
      'The pinned Even Hub simulator has no executable entrypoint.',
    );
  }

  const entryPath = resolve(dirname(simulatorManifestPath), entry);
  await access(entryPath);
  return {
    command: process.execPath,
    args: [entryPath, APP_URL, '--automation-port', String(AUTOMATION_PORT)],
  };
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise<void>((resolveStop) => child.once('exit', resolveStop));
}

export async function launchSimulator(
  options: SimulatorLaunchOptions,
): Promise<LaunchedSimulator> {
  const child = spawn(options.command, options.args, {
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', () => undefined);
  return { stop: () => stopChild(child) };
}

export async function launchAppServer(): Promise<LaunchedProcess> {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(command, ['run', 'dev:sim', '-w', 'apps/glasses'], {
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', () => undefined);
  return { stop: () => stopChild(child) };
}

async function responseOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

export async function pingSimulator(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/ping`);
    return response.ok && (await response.text()) === 'pong';
  } catch {
    return false;
  }
}

export async function readSimulatorDeviceInfo(
  url: string,
): Promise<unknown | undefined> {
  const response = await fetch(`${url}/api/console`);
  if (!response.ok) throw new Error('Could not read the simulator console.');
  const body = (await response.json()) as { entries?: unknown };
  if (!Array.isArray(body.entries)) return undefined;

  for (const entry of body.entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('message' in entry) ||
      typeof entry.message !== 'string'
    ) {
      continue;
    }
    const marker = 'g2rs.device-info ';
    const offset = entry.message.indexOf(marker);
    if (offset === -1) continue;
    return JSON.parse(entry.message.slice(offset + marker.length));
  }
  return undefined;
}

export async function readSimulatorScreenshot(
  url: string,
): Promise<Uint8Array> {
  const response = await fetch(`${url}/api/screenshot/glasses`);
  if (!response.ok)
    throw new Error('Could not capture the glasses screenshot.');
  return new Uint8Array(await response.arrayBuffer());
}

export async function readPinnedVersions(
  root = process.cwd(),
): Promise<SimulatorVersions> {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'apps/glasses/package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const sdkVersion = manifest.dependencies?.['@evenrealities/even_hub_sdk'];
  const simulatorVersion =
    manifest.devDependencies?.['@evenrealities/evenhub-simulator'];
  if (!sdkVersion || !simulatorVersion) {
    throw new Error('The SDK or simulator pin is missing.');
  }
  return { sdkVersion, simulatorVersion };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function pngHeader(bytes: Uint8Array): PngHeader {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) {
    throw new Error('Simulator screenshot is not a PNG.');
  }

  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      4,
    ).getUint32(0);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'IHDR') {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset + 8,
        length,
      );
      return {
        bitDepth: view.getUint8(8),
        colorType: view.getUint8(9),
        height: view.getUint32(4),
        interlace: view.getUint8(12),
        width: view.getUint32(0),
      };
    }
    offset += 12 + length;
  }
  throw new Error('Simulator screenshot has no PNG header.');
}

function rgbaPixels(bytes: Uint8Array): {
  height: number;
  pixels: Uint8Array;
  width: number;
} {
  const header = pngHeader(bytes);
  if (
    header.bitDepth !== 8 ||
    header.colorType !== 6 ||
    header.interlace !== 0
  ) {
    throw new Error('Simulator screenshot must be a non-interlaced RGBA PNG.');
  }

  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      4,
    ).getUint32(0);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'IDAT')
      idat.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const compressed = Buffer.concat(idat.map((chunk) => Buffer.from(chunk)));
  const source = new Uint8Array(inflateSync(compressed));
  const stride = header.width * 4;
  if (source.length !== (stride + 1) * header.height) {
    throw new Error('Simulator screenshot has an unexpected RGBA byte length.');
  }

  const pixels = new Uint8Array(stride * header.height);
  for (let row = 0; row < header.height; row += 1) {
    const filter = source[row * (stride + 1)];
    const sourceOffset = row * (stride + 1) + 1;
    const targetOffset = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const value = source[sourceOffset + index];
      const left = index >= 4 ? pixels[targetOffset + index - 4] : 0;
      const above = row > 0 ? pixels[targetOffset - stride + index] : 0;
      const upperLeft =
        row > 0 && index >= 4 ? pixels[targetOffset - stride + index - 4] : 0;
      if (filter === 0) pixels[targetOffset + index] = value;
      else if (filter === 1)
        pixels[targetOffset + index] = (value + left) & 255;
      else if (filter === 2)
        pixels[targetOffset + index] = (value + above) & 255;
      else if (filter === 3) {
        pixels[targetOffset + index] =
          (value + Math.floor((left + above) / 2)) & 255;
      } else if (filter === 4) {
        pixels[targetOffset + index] =
          (value + paeth(left, above, upperLeft)) & 255;
      } else {
        throw new Error(
          `Simulator screenshot uses unknown PNG filter ${filter}.`,
        );
      }
    }
  }
  return { height: header.height, pixels, width: header.width };
}

export function hasLitPixelsInSmokeTextRegion(screenshot: Uint8Array): boolean {
  const { height, pixels, width } = rgbaPixels(screenshot);
  const maxX = Math.min(width, SMOKE_TEXT_REGION.x + SMOKE_TEXT_REGION.width);
  const maxY = Math.min(height, SMOKE_TEXT_REGION.y + SMOKE_TEXT_REGION.height);
  for (let y = SMOKE_TEXT_REGION.y; y < maxY; y += 1) {
    for (let x = SMOKE_TEXT_REGION.x; x < maxX; x += 1) {
      const offset = (y * width + x) * 4;
      const brightness = Math.max(
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
      );
      if (pixels[offset + 3] > 0 && brightness > 32) return true;
    }
  }
  return false;
}

const defaultDependencies: SimulatorHarnessDependencies = {
  appReady: responseOk,
  launch: launchSimulator,
  launchAppServer,
  ping: pingSimulator,
  readDeviceInfo: readSimulatorDeviceInfo,
  readScreenshot: readSimulatorScreenshot,
  resolveSimulator: resolvePinnedSimulator,
  sleep,
  today,
  versions: readPinnedVersions,
};

async function waitFor(
  check: () => Promise<boolean>,
  dependencies: SimulatorHarnessDependencies,
): Promise<boolean> {
  for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
    if (await check()) return true;
    await dependencies.sleep(PING_INTERVAL_MS);
  }
  return false;
}

async function waitForDeviceInfo(
  dependencies: SimulatorHarnessDependencies,
): Promise<unknown | undefined> {
  for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
    const deviceInfo = await dependencies.readDeviceInfo(AUTOMATION_URL);
    if (deviceInfo !== undefined) return deviceInfo;
    await dependencies.sleep(PING_INTERVAL_MS);
  }
  return undefined;
}

async function waitForSmokeScreenshot(
  dependencies: SimulatorHarnessDependencies,
): Promise<{ screenshot: Uint8Array; textIsLit: boolean }> {
  let screenshot: Uint8Array | undefined;
  for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
    screenshot = await dependencies.readScreenshot(AUTOMATION_URL);
    if (hasLitPixelsInSmokeTextRegion(screenshot)) {
      return { screenshot, textIsLit: true };
    }
    if (attempt < PING_ATTEMPTS - 1) {
      await dependencies.sleep(PING_INTERVAL_MS);
    }
  }

  if (!screenshot) {
    throw new Error('The simulator did not return a glasses screenshot.');
  }
  return { screenshot, textIsLit: false };
}

async function writeSmokeReport(
  simRoot: string,
  screenshot: Uint8Array,
  deviceInfo: unknown,
  textIsLit: boolean,
  versions: SimulatorVersions,
): Promise<void> {
  const screenshotPath = resolve(simRoot, 'image', 'smoke-01.png');
  await mkdir(dirname(screenshotPath), { recursive: true });
  await writeFile(screenshotPath, screenshot);
  await writeFile(
    resolve(simRoot, 'report.json'),
    `${JSON.stringify(
      {
        assertions: [
          {
            detail:
              'The Hello, driver text region contains opaque pixels with RGB brightness greater than 32.',
            name: 'Hello, driver text region is lit',
            pass: textIsLit,
          },
        ],
        deviceInfo,
        evidenceClass: '[SIM]',
        generatedAt: new Date().toISOString(),
        mode: 'image',
        scenario: 'smoke',
        sdkVersion: versions.sdkVersion,
        simulatorCaveat:
          'Simulator evidence is functional only; it does not prove on-device image limits, LZ4, BLE pacing, or pixel-perfect rendering.',
        simulatorVersion: versions.simulatorVersion,
      },
      null,
      2,
    )}\n`,
  );
}

export async function runSimulatorHarness(
  dependencies: SimulatorHarnessDependencies = defaultDependencies,
  options: SimulatorHarnessOptions = {
    outputRoot: resolve(process.cwd(), 'qa'),
  },
): Promise<SimulatorHarnessResult> {
  let appServer: LaunchedProcess | undefined;
  let simulator: LaunchedSimulator | undefined;
  let deviceInfo: unknown;

  try {
    try {
      appServer = await dependencies.launchAppServer();
      if (
        !(await waitFor(() => dependencies.appReady(APP_URL), dependencies))
      ) {
        throw new Error(
          'The scaffold development server did not become ready.',
        );
      }

      simulator = await dependencies.launch(
        await dependencies.resolveSimulator(),
      );
      if (
        !(await waitFor(() => dependencies.ping(AUTOMATION_URL), dependencies))
      ) {
        throw new Error(
          'The simulator automation server did not become ready.',
        );
      }
    } catch {
      return {
        outputRoot: options.outputRoot,
        success: false,
        reason: 'sim-unavailable',
      };
    }

    try {
      deviceInfo = await waitForDeviceInfo(dependencies);
      if (deviceInfo === undefined) {
        throw new Error('The simulator did not report bridge.getDeviceInfo().');
      }
    } catch {
      return {
        outputRoot: options.outputRoot,
        success: false,
        reason: 'evidence-failed',
      };
    }

    try {
      const { screenshot, textIsLit } =
        await waitForSmokeScreenshot(dependencies);
      const versions = await dependencies.versions();
      const simRoot = resolve(options.outputRoot, dependencies.today(), 'sim');
      await writeSmokeReport(
        simRoot,
        screenshot,
        deviceInfo,
        textIsLit,
        versions,
      );
      return textIsLit
        ? { outputRoot: options.outputRoot, success: true }
        : {
            outputRoot: options.outputRoot,
            success: false,
            reason: 'assertion-failed',
          };
    } catch {
      return {
        outputRoot: options.outputRoot,
        success: false,
        reason: 'evidence-failed',
      };
    }
  } finally {
    await simulator?.stop();
    await appServer?.stop();
  }
}

export async function main(
  options: SimulatorHarnessMainOptions = {},
): Promise<SimulatorHarnessResult> {
  const result = await (options.runHarness ?? runSimulatorHarness)(
    options.dependencies,
    { outputRoot: options.outputRoot ?? resolve(process.cwd(), 'qa') },
  );
  if (!result.success) {
    (options.stderr ?? console.error)(result.reason ?? 'sim-unavailable');
    (
      options.setExitCode ??
      ((code) => {
        process.exitCode = code;
      })
    )(1);
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
