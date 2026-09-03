import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const AUTOMATION_PORT = 9898;
const AUTOMATION_URL = `http://127.0.0.1:${AUTOMATION_PORT}`;
const APP_URL = 'http://localhost:5173';
const PING_ATTEMPTS = 25;
const PING_INTERVAL_MS = 200;

export interface LaunchedSimulator {
  stop(): Promise<void>;
}

export interface SimulatorLaunchOptions {
  args: string[];
  command: string;
}

export interface SimulatorHarnessDependencies {
  launch(options: SimulatorLaunchOptions): Promise<LaunchedSimulator>;
  ping(url: string): Promise<boolean>;
  resolveSimulator(): Promise<SimulatorLaunchOptions>;
  sleep(ms: number): Promise<void>;
}

export interface SimulatorHarnessResult {
  reason?: 'sim-unavailable';
  success: boolean;
}

interface SimulatorManifest {
  bin?: Record<string, string> | string;
  version?: string;
}

export async function resolvePinnedSimulator(
  root = process.cwd(),
): Promise<SimulatorLaunchOptions> {
  const glassesManifestPath = resolve(root, 'apps/glasses/package.json');
  const glassesManifest = JSON.parse(
    await readFile(glassesManifestPath, 'utf8'),
  ) as {
    devDependencies?: Record<string, string>;
  };
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

export async function launchSimulator(
  options: SimulatorLaunchOptions,
): Promise<LaunchedSimulator> {
  const child = spawn(options.command, options.args, {
    stdio: 'inherit',
    windowsHide: true,
  });

  child.once('error', () => undefined);

  return {
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;

      child.kill();
      await new Promise<void>((resolveStop) => child.once('exit', resolveStop));
    },
  };
}

export async function pingSimulator(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/ping`);
    return response.ok && (await response.text()) === 'pong';
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

const defaultDependencies: SimulatorHarnessDependencies = {
  launch: launchSimulator,
  ping: pingSimulator,
  resolveSimulator: resolvePinnedSimulator,
  sleep,
};

export async function runSimulatorHarness(
  dependencies: SimulatorHarnessDependencies = defaultDependencies,
): Promise<SimulatorHarnessResult> {
  let simulator: LaunchedSimulator | undefined;

  try {
    simulator = await dependencies.launch(
      await dependencies.resolveSimulator(),
    );

    for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
      if (await dependencies.ping(AUTOMATION_URL)) {
        return { success: true };
      }
      await dependencies.sleep(PING_INTERVAL_MS);
    }
  } catch {
    return { success: false, reason: 'sim-unavailable' };
  } finally {
    await simulator?.stop();
  }

  return { success: false, reason: 'sim-unavailable' };
}

export async function main(): Promise<void> {
  const result = await runSimulatorHarness();
  if (!result.success) {
    console.error(result.reason);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
