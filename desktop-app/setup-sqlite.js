const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// better-sqlite3 v12.11.1 prebuilt binaries for Electron
// Electron 44 uses Node ABI 131, but prebuilt binaries for v126 or v131 work
const ELECTRON_VERSION = '44.2.0';

function get(url, cb) {
  const opts = new URL(url);
  const options = {
    hostname: opts.hostname,
    path: opts.pathname + opts.search,
    headers: { 'User-Agent': 'node' }
  };
  https.get(options, res => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      return get(res.headers.location, cb);
    }
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => cb(Buffer.concat(chunks), res.statusCode));
  }).on('error', e => { console.error('Request error:', e.message); process.exit(1); });
}

// Try multiple prebuilt binary URLs (Electron ABI versions)
const urls = [
  'https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-electron-v131-win32-x64.tar.gz',
  'https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-electron-v126-win32-x64.tar.gz',
  'https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-electron-v120-win32-x64.tar.gz',
];

const tarFile = path.join(__dirname, 'bs3-prebuilt.tar.gz');

function tryDownload(index) {
  if (index >= urls.length) {
    console.error('All prebuilt binary downloads failed.');
    console.error('Falling back to build-from-source...');

    // Fallback: try node-gyp rebuild
    try {
      const sqliteDir = path.join(__dirname, 'node_modules', 'better-sqlite3');
      if (fs.existsSync(sqliteDir)) {
        console.log('Attempting node-gyp rebuild...');
        execSync('npx node-gyp rebuild --release', {
          cwd: sqliteDir,
          stdio: 'inherit',
          env: { ...process.env, npm_config_build_from_source: 'true' }
        });
        console.log('Build from source succeeded!');
      }
    } catch (e) {
      console.error('Build from source also failed:', e.message);
      console.error('\nPlease install Visual Studio Build Tools or use a prebuilt binary.');
      process.exit(1);
    }
    return;
  }

  const tarUrl = urls[index];
  console.log(`Trying: ${tarUrl.split('/').pop()}...`);

  get(tarUrl, (data, status) => {
    if (status !== 200) {
      console.log(`  Failed (status ${status}), trying next...`);
      return tryDownload(index + 1);
    }
    fs.writeFileSync(tarFile, data);
    console.log(`  Downloaded ${data.length} bytes`);

    const extractDir = path.join(__dirname, 'bs3-extract');
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      execSync(`tar -xzf "${tarFile}" -C "${extractDir}"`, { stdio: 'pipe' });
      console.log('  Extracted successfully');

      // Find the .node file
      function findNode(dir) {
        for (const f of fs.readdirSync(dir)) {
          const full = path.join(dir, f);
          if (fs.statSync(full).isDirectory()) {
            const found = findNode(full);
            if (found) return found;
          } else if (f.endsWith('.node')) return full;
        }
      }
      const nodeFile = findNode(extractDir);
      if (!nodeFile) {
        console.error('  No .node file found in archive');
        return tryDownload(index + 1);
      }

      // Copy to node_modules/better-sqlite3/build/Release/
      const dest = path.join(__dirname, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
      if (!fs.existsSync(dest)) {
        // Try backend/node_modules as fallback
        const destAlt = path.join(__dirname, 'backend', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
        if (fs.existsSync(path.dirname(destAlt).replace(/build.*$/, ''))) {
          fs.mkdirSync(path.dirname(destAlt), { recursive: true });
          fs.copyFileSync(nodeFile, destAlt);
          console.log(`  Copied to: ${destAlt}`);
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(nodeFile, dest);
          console.log(`  Copied to: ${dest}`);
        }
      } else {
        fs.copyFileSync(nodeFile, dest);
        console.log(`  Copied to: ${dest}`);
      }

      // Cleanup
      try {
        fs.unlinkSync(tarFile);
        fs.rmSync(extractDir, { recursive: true });
      } catch (e) { /* ignore cleanup errors */ }

      console.log('\n✅ better-sqlite3 binary installed successfully for Electron!');
    } catch (e) {
      console.error('  Extract/copy failed:', e.message);
      return tryDownload(index + 1);
    }
  });
}

console.log('Installing better-sqlite3 prebuilt binary (no Visual Studio needed)...\n');
tryDownload(0);
