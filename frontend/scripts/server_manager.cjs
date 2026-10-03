const { execSync, spawn } = require('child_process');
const http = require('http');

/**
 * Robust process & port manager for Windows / cross-platform.
 * Ensures orphaned python/uvicorn/node processes on port 8000 and 5173
 * are reliably terminated on exit, failure, or timeout.
 */

function getPidsListeningOnPort(port) {
  try {
    const stdout = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pids = new Set();
    for (const line of stdout.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0' && !isNaN(Number(pid))) {
        pids.add(Number(pid));
      }
    }
    return Array.from(pids);
  } catch {
    return [];
  }
}

function killPidTree(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {}
}

function killPort(port) {
  const pids = getPidsListeningOnPort(port);
  for (const pid of pids) {
    console.log(`[server_manager] Terminating process tree for PID ${pid} holding port ${port}...`);
    killPidTree(pid);
  }
}

function waitForHttp(url, timeoutMs = 40000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    let resolved = false;
    const check = () => {
      if (resolved) return;
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolved = true;
          resolve(true);
        } else {
          retry();
        }
      });
      req.on('error', () => {
        req.destroy();
        retry();
      });
      req.setTimeout(6000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (resolved) return;
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for ${url} after ${timeoutMs}ms`));
      } else {
        setTimeout(check, 600);
      }
    };

    check();
  });
}

function waitForPortFree(port, timeoutMs = 10000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const pids = getPidsListeningOnPort(port);
      if (pids.length === 0) {
        resolve(true);
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for port ${port} to free after ${timeoutMs}ms`));
      } else {
        setTimeout(check, 300);
      }
    };
    check();
  });
}

module.exports = {
  getPidsListeningOnPort,
  killPidTree,
  killPort,
  waitForHttp,
  waitForPortFree,
};
