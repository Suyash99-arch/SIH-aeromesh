const { spawn } = require('child_process');
const path = require('path');
const { killPort, waitForHttp } = require('./server_manager.cjs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const pythonPath = path.join(ROOT_DIR, '.venv311', 'Scripts', 'python.exe');

async function main() {
  await killPort(8000);

  console.log('[Test] Spawning backend on 127.0.0.1:8000...');
  const backendProc = spawn(pythonPath, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: ROOT_DIR,
    stdio: 'ignore'
  });

  try {
    await waitForHttp('http://127.0.0.1:8000/api/missions', 35000);
    console.log('[Test] Backend ready. Running test_pipeline_and_concurrency.py...');

    const testProc = spawn(pythonPath, [path.join(__dirname, 'test_pipeline_and_concurrency.py')], {
      cwd: ROOT_DIR,
      stdio: 'inherit'
    });

    await new Promise((resolve) => {
      testProc.on('close', resolve);
    });

  } finally {
    if (backendProc.pid) process.kill(backendProc.pid);
    await killPort(8000);
    console.log('[Test] Teardown complete.');
  }
}

main();
