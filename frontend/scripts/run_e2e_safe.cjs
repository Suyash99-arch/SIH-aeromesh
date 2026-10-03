const { spawn } = require('child_process');
const path = require('path');
const { killPort, waitForHttp, killPidTree } = require('./server_manager.cjs');

/**
 * Runner that ensures backend server lifecycle is cleanly tied to test execution.
 * Guarantees that neither normal termination nor failure leaks a port 8000 process.
 */
async function runWithServer(testCommand, args = []) {
  const rootDir = path.resolve(__dirname, '../..');
  const pythonPath = path.join(rootDir, '.venv311', 'Scripts', 'python.exe');

  console.log('[run_e2e_safe] Step 1: Pre-clearing any stale processes on port 8000 and 5173...');
  killPort(8000);
  killPort(5173);

  console.log('[run_e2e_safe] Step 2: Spawning backend server...');
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

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    console.log('[run_e2e_safe] Cleanup hook triggered — terminating backend process tree...');
    if (backendProc.pid) {
      killPidTree(backendProc.pid);
    }
    killPort(8000);
    killPort(5173);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (err) => {
    console.error('[run_e2e_safe] Uncaught exception:', err);
    cleanup();
    process.exit(1);
  });

  try {
    console.log('[run_e2e_safe] Waiting for backend /api/missions endpoint...');
    await waitForHttp('http://127.0.0.1:8000/api/missions', 35000);
    console.log('[run_e2e_safe] ✓ Backend server ready on port 8000.');

    console.log(`[run_e2e_safe] Step 3: Executing test command: ${testCommand} ${args.join(' ')}`);
    const isWindows = process.platform === 'win32';
    const finalCmd = isWindows && (testCommand === 'npm' || testCommand === 'npx') ? `${testCommand}.cmd` : testCommand;

    const testProc = spawn(finalCmd, args, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      shell: false,
    });

    const exitCode = await new Promise((resolve) => {
      testProc.on('close', resolve);
      testProc.on('error', (err) => {
        console.error('[run_e2e_safe] Failed to spawn test process:', err);
        resolve(1);
      });
    });

    console.log(`[run_e2e_safe] Test command exited with code ${exitCode}.`);
    return exitCode;
  } catch (err) {
    console.error('[run_e2e_safe] Error during run:', err);
    return 1;
  } finally {
    cleanup();
  }
}

if (require.main === module) {
  const cmd = process.argv[2] || 'node';
  const args = process.argv.slice(3);
  const defaultArgs = process.argv.length <= 2 ? ['-e', "console.log('Default health check passed')"] : args;

  runWithServer(cmd, defaultArgs).then((code) => {
    process.exit(code);
  });
}

module.exports = { runWithServer };
