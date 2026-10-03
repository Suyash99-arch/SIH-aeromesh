/**
 * Stabilization Test Runner
 * Orchestrates port lifecycle verification, spawns servers, runs full stabilization sweep.
 */
const { spawn } = require('child_process');
const path = require('path');
const { killPort, waitForHttp, waitForPortFree } = require('./server_manager.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const FRONTEND_DIR = path.resolve(__dirname, '..');

let backendProc = null;
let frontendProc = null;

const pythonPath = path.join(ROOT_DIR, '.venv311', 'Scripts', 'python.exe');

async function spawnBackend() {
  console.log('[Runner] Spawning backend on 127.0.0.1:8000...');
  const proc = spawn(
    pythonPath,
    ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'],
    { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
  );

  proc.stdout.on('data', (d) => process.stdout.write(`[backend stdout]: ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[backend stderr]: ${d}`));
  return proc;
}

async function spawnFrontend() {
  console.log('[Runner] Spawning frontend Vite server on 127.0.0.1:5173...');
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  const proc = spawn(npmCmd, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
    cwd: FRONTEND_DIR,
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', (d) => process.stdout.write(`[vite stdout]: ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[vite stderr]: ${d}`));
  return proc;
}

async function cleanup() {
  console.log('[Runner] >>> Cleaning up all processes...');
  try {
    if (backendProc && !backendProc.killed) {
      process.kill(backendProc.pid);
    }
  } catch (e) {}
  try {
    if (frontendProc && !frontendProc.killed) {
      process.kill(frontendProc.pid);
    }
  } catch (e) {}
  await killPort(8000);
  await killPort(5173);
}

process.on('SIGINT', async () => { await cleanup(); process.exit(1); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(1); });

async function main() {
  try {
    console.log('\n================ STABILIZATION TEST RUNNER ================');
    // Step 1: Pre-clear ports
    await killPort(8000);
    await killPort(5173);

    // Step 2: Test Port Lifecycle (start, kill, restart backend without Errno 10048)
    console.log('\n>>> STAGE 1: Testing Port Lifecycle & Restart Guard (Start -> Stop -> Restart)...');
    backendProc = await spawnBackend();
    await waitForHttp('http://127.0.0.1:8000/api/missions', 20000);
    console.log('[Port Lifecycle] ✓ First start successful on port 8000.');

    console.log('[Port Lifecycle] Stopping backend process...');
    await killPort(8000);
    await waitForPortFree(8000, 10000);
    console.log('[Port Lifecycle] ✓ Port 8000 cleanly freed.');

    console.log('[Port Lifecycle] Restarting backend immediately on port 8000...');
    backendProc = await spawnBackend();
    await waitForHttp('http://127.0.0.1:8000/api/missions', 20000);
    console.log('[Port Lifecycle] ✓ Backend cleanly rebound to port 8000 with ZERO Errno 10048!');

    // Step 3: Start frontend
    console.log('\n>>> STAGE 2: Starting Frontend Vite Server...');
    frontendProc = await spawnFrontend();
    await waitForHttp('http://127.0.0.1:5173', 20000);
    console.log('[Runner] ✓ Frontend server is ready.');

    // Step 4: Run full app stabilization sweep in real Google Chrome
    console.log('\n>>> STAGE 3: Running Real Browser Full App Sweep...');
    const { runStabilizationSweep } = require('./full_app_stabilization_sweep.cjs');
    const sweepResult = await runStabilizationSweep();

    console.log('\n>>> STAGE 4: Finalizing Test Run...');
    if (sweepResult.success) {
      console.log('✓ FULL APP STABILIZATION PASS SUCCEEDED.');
      process.exitCode = 0;
    } else {
      console.error('✗ STABILIZATION SWEEP REPORTED FAILURES.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('[Runner Fatal Error]:', err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
