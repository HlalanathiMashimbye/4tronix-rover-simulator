#!/usr/bin/env node

const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const npmExecPath = process.env.npm_execpath;

// `hint` names the usual cause, printed when a service dies. Both Python
// services fail the same way after someone adds a dependency and everyone
// else's checkout is a `pip install` behind.
const PY_DEPS = 'If that was a ModuleNotFoundError, install the Python deps: .venv/bin/pip install -r yard/rover/requirements.txt -r yard/satellite/requirements.txt';

const services = [
  { name: 'control', label: 'Mission Control', port: 3000, script: 'dev:control', url: 'http://localhost:3000',
    hint: 'If that was a module error, run: npm install' },
  { name: 'satellite', label: 'Satellite UI', port: 3001, script: 'dev:satellite', url: 'http://localhost:3001',
    hint: PY_DEPS },
  { name: 'yard', label: 'Rover backend', port: 8523, script: 'dev:yard', url: 'http://localhost:8523',
    hint: PY_DEPS },
];

function run(script) {
  if (npmExecPath) {
    return spawn(process.execPath, [npmExecPath, 'run', script], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }

  if (isWindows) {
    return spawn('cmd', ['/d', '/s', '/c', `npm run ${script}`], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }

  return spawn('npm', ['run', script], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

function openBrowser(url) {
  const command = isWindows ? 'cmd' : isMac ? 'open' : 'xdg-open';
  const args = isWindows ? ['/c', 'start', '', url] : [url];

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });

    const finish = (ready) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForPorts(ports, children, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null || child.signalCode !== null)) {
      return false;
    }

    const statuses = await Promise.all(ports.map(async (port) => [port, await checkPort(port)]));
    if (statuses.every(([, ready]) => ready)) return true;

    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  return false;
}

function killChildren(children) {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Windows can reject a kill if the child already exited.
      }
    }
  }
}

let shuttingDown = false;

async function main() {
  console.log('[dev] starting full stack');

  const children = services.map((service) => {
    console.log(`[dev] ${service.label}: ${service.url}`);
    const child = run(service.script);
    child.on('error', (error) => {
      console.error(`[dev] failed to start ${service.name}: ${error.message}`);
      killChildren(children);
      process.exit(1);
    });
    return child;
  });

  // Report WHICH service died and why before taking the rest down.
  //
  // Previously any service exiting killed the others silently, so a missing
  // Python dependency in the rover looked like "npm run dev only starts
  // Mission Control, and never opens the browser". The cause was a
  // ModuleNotFoundError in a child process nobody saw.
  children.forEach((child, index) => {
    const service = services[index];

    child.on('exit', (code, signal) => {
      if (code === 0 && signal === null) return;
      // A service we killed on purpose because something else failed.
      if (signal === 'SIGTERM' && shuttingDown) return;

      shuttingDown = true;
      console.error('');
      console.error(`[dev] ${service.label} exited (${signal ?? `code ${code}`}).`);
      console.error(`[dev] Nothing else can be checked until it starts, so the rest are stopping too.`);
      if (service.hint) console.error(`[dev] ${service.hint}`);
      console.error('');

      killChildren(children);
      process.exit(code ?? (signal ? 1 : 0));
    });
  });

  const ready = await waitForPorts(services.map((service) => service.port), children);
  if (!ready) {
    // Name the ports still closed rather than reporting a bare timeout.
    const stillDown = [];
    for (const service of services) {
      if (!(await checkPort(service.port))) stillDown.push(`${service.label} (:${service.port})`);
    }
    console.error('');
    console.error(`[dev] gave up waiting for: ${stillDown.join(', ') || 'unknown'}`);
    console.error('[dev] scroll up for what that service printed as it started.');
    console.error('');
    shuttingDown = true;
    killChildren(children);
    process.exit(1);
  }

  if (process.stdin.isTTY && process.stdout.isTTY && process.env.CI !== 'true') {
    console.log('[dev] opening browser tabs');
    openBrowser('http://localhost:3000');
    openBrowser('http://localhost:3001');
  }

  process.on('SIGINT', () => {
    shuttingDown = true;
    killChildren(children);
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    shuttingDown = true;
    killChildren(children);
    process.exit(143);
  });
}

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  process.exit(1);
});
