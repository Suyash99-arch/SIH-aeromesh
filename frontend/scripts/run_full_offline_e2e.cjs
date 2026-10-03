const { spawn } = require('child_process');
const path = require('path');
const { killPort, waitForHttp, killPidTree } = require('./server_manager.cjs');

/**
 * Executes full e2e test with:
 * - Backend uvicorn (port 8000)
 * - Frontend Vite (port 5173)
 * - Strict offline + zero login test suite
 * - Guaranteed process tree termination on exit/failure
 */
async function runFullOfflineE2E() {
  const rootDir = path.resolve(__dirname, '../..');
  const frontendDir = path.resolve(__dirname, '..');
  const pythonPath = path.join(rootDir, '.venv311', 'Scripts', 'python.exe');

  console.log('\n[E2E] >>> Step 1: Pre-clearing ports 8000 and 5173...');
  killPort(8000);
  killPort(5173);

  console.log('[E2E] >>> Step 2: Spawning backend uvicorn on 127.0.0.1:8000...');
  const backendProc = spawn(pythonPath, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProc.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log('[uvicorn stdout]:', text);
  });
  backendProc.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log('[uvicorn stderr]:', text);
  });

  console.log('[E2E] >>> Step 3: Spawning frontend Vite server on 127.0.0.1:5173...');
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  const frontendProc = spawn(npmCmd, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
    cwd: frontendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
  });

  frontendProc.stdout.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log('[vite stdout]:', text);
  });
  frontendProc.stderr.on('data', (d) => {
    const text = d.toString().trim();
    if (text) console.log('[vite stderr]:', text);
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    console.log('[E2E] >>> Cleanup hook triggered: terminating all backend and frontend processes...');
    if (backendProc.pid) killPidTree(backendProc.pid);
    if (frontendProc.pid) killPidTree(frontendProc.pid);
    killPort(8000);
    killPort(5173);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (err) => {
    console.error('[E2E] Uncaught exception:', err);
    cleanup();
    process.exit(1);
  });

  try {
    console.log('[E2E] Waiting for backend to become ready (port 8000)...');
    await waitForHttp('http://127.0.0.1:8000/api/missions', 35000);
    console.log('[E2E] ✓ Backend is ready.');

    console.log('[E2E] Waiting for frontend Vite server (port 5173)...');
    await waitForHttp('http://127.0.0.1:5173', 25000);
    console.log('[E2E] ✓ Frontend is ready.');

    console.log('[E2E] >>> Step 4: Executing offline core flow test suite...');
    const testProc = spawn('node', [path.join(__dirname, 'test_offline_core_flow.cjs')], {
      cwd: frontendDir,
      stdio: 'inherit',
    });

    const exitCode = await new Promise((resolve) => {
      testProc.on('close', resolve);
      testProc.on('error', (err) => {
        console.error('[E2E] Error running test script:', err);
        resolve(1);
      });
    });

    console.log(`[E2E] Test run finished with exit code ${exitCode}.`);
    return exitCode;
  } catch (err) {
    console.error('[E2E] Run failed:', err);
    return 1;
  } finally {
    cleanup();
  }
}

if (require.main === module) {
  runFullOfflineE2E().then((code) => {
    process.exit(code);
  });
}

module.exports = { runFullOfflineE2E };
