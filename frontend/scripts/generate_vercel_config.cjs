const fs = require('fs');
const path = require('path');

function generateVercelConfig() {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl || !backendUrl.trim()) {
    console.error('================================================================');
    console.error('BUILD ERROR: BACKEND_URL environment variable is not defined.');
    console.error('Vercel deployments require BACKEND_URL to configure proxy rewrites.');
    console.error('Example: BACKEND_URL=https://sih-aeromesh.onrender.com');
    console.error('================================================================');
    process.exit(1);
  }

  const normalizedBackend = backendUrl.trim().replace(/\/+$/, '');
  if (!normalizedBackend.startsWith('http://') && !normalizedBackend.startsWith('https://')) {
    console.error(`BUILD ERROR: Invalid BACKEND_URL scheme: "${backendUrl}". Must start with http:// or https://`);
    process.exit(1);
  }

  const config = {
    rewrites: [
      {
        source: '/api/:path*',
        destination: `${normalizedBackend}/api/:path*`,
      },
      {
        source: '/((?!api/).*)',
        destination: '/index.html',
      },
    ],
  };

  const jsonContent = JSON.stringify(config, null, 2) + '\n';

  // Write to frontend/vercel.json and root vercel.json if applicable
  const scriptDir = __dirname;
  const frontendDir = path.resolve(scriptDir, '..');
  const rootDir = path.resolve(frontendDir, '..');

  const targets = [path.join(frontendDir, 'vercel.json')];
  if (fs.existsSync(path.join(rootDir, 'render.yaml')) || fs.existsSync(path.join(rootDir, 'backend'))) {
    targets.push(path.join(rootDir, 'vercel.json'));
  }

  for (const targetPath of targets) {
    fs.writeFileSync(targetPath, jsonContent, 'utf-8');
    console.log(`[Vercel Config] Generated rewrite config at: ${targetPath}`);
  }

  console.log(`[Vercel Config] Rewrites successfully configured -> ${normalizedBackend}/api/:path*`);
}

generateVercelConfig();
