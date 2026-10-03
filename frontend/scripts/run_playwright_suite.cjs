const { spawn, execSync } = require('child_process');
const path = require('path');
const { killPort, waitForHttp } = require('./server_manager.cjs');

const rootDir = path.resolve(__dirname, '../..');
const backendDir = path.join(rootDir, 'backend');
const frontendDir = path.join(rootDir, 'frontend');
const pythonExe = path.join(rootDir, '.venv311', 'Scripts', 'python.exe');

async function main() {
  console.log('=== [RUN PLAYWRIGHT SUITE] ===');
  killPort(8000);
  killPort(5173);

  let backendProc = null;
  let frontendProc = null;

  try {
    console.log('[1/4] Starting backend on port 8000...');
    backendProc = spawn(pythonExe, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    backendProc.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Error') || msg.includes('Exception')) {
        console.error('[backend err]', msg.trim());
      }
    });

    console.log('[2/4] Starting frontend dev server on port 5173...');
    frontendProc = spawn('cmd.exe', ['/c', 'npm run dev -- --host 127.0.0.1 --port 5173'], {
      cwd: frontendDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    console.log('[3/4] Waiting for backend and frontend HTTP readiness...');
    await waitForHttp('http://127.0.0.1:8000/api/missions', 40000);
    await waitForHttp('http://127.0.0.1:5173/', 40000);
    console.log('Both servers ready.');

    console.log('[4/4] Executing Playwright test suite (npx playwright test)...');
    try {
      const testOutput = execSync('npx playwright test --reporter=list', {
        cwd: frontendDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      console.log('PLAYWRIGHT OUTPUT:\n', testOutput);
    } catch (testErr) {
      console.error('PLAYWRIGHT FAILED OR REPORTED ISSUES:');
      if (testErr.stdout) console.log(testErr.stdout);
      if (testErr.stderr) console.error(testErr.stderr);
    }
  } finally {
    console.log('Cleaning up processes...');
    killPort(8000);
    killPort(5173);
    console.log('Clean shutdown complete.');
  }
}

main().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
