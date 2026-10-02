// Orchestrates the whole isolated load test end to end:
//   1. disposable local Mongo replica set (never the real MONGODB_URL)
//   2. seed fixtures into it
//   3. build (read-only compile) + boot the backend against that replica
//      set on a disposable port
//   4. sample Mongo connection-pool usage while k6 runs
//   5. run the k6 scenario
//   6. DB-level correctness verification
//   7. tear everything down
//
// Never touches backend/src, app/, git state, or any existing config file.
const { spawn, execSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { startDisposableReplicaSet } = require('./mongo-replica.cjs');

const ROOT = path.join(__dirname, '..', '..');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const s = net.createServer();
  await new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(0, '127.0.0.1', resolve);
  });
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await delay(300);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  section('1/6 Starting disposable local Mongo replica set');
  const replica = await startDisposableReplicaSet();
  console.log('Replica set URI:', replica.uri);

  section('2/6 Seeding fixtures');
  execSync(`node ${JSON.stringify(path.join(__dirname, 'seed.cjs'))} ${JSON.stringify(replica.uri)}`, { stdio: 'inherit' });

  section('3/6 Building backend (tsc, read-only compile — no source files are modified)');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  section(`Starting backend server on disposable port ${port}, pointed at the disposable DB only`);
  const serverEnv = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    TZ: 'UTC',
    PORT: String(port),
    MONGODB_URL: replica.uri,
    JWT_SECRET: 'load_harness_local_secret_not_for_production_0000',
    JWT_REFRESH_SECRET: 'load_harness_local_refresh_secret_not_for_production_0000',
    ALLOW_PUBLIC_REGISTER: 'false',
    MIGRATION_ENABLED: 'false',
  };
  const serverProc = spawn('node', [path.join(ROOT, 'backend', 'dist', 'server.js')], { env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  let serverExited = false;
  serverProc.on('exit', (code) => { serverExited = true; console.log(`[server] exited with code ${code}`); });

  try {
    await waitForHttpOk(`${baseUrl}/api/health`, 20000);
    if (serverExited) throw new Error('Server exited before becoming healthy');

    section('4/6 Starting Mongo connection-pool sampler');
    const sampler = spawn('node', [path.join(__dirname, 'poll-connections.cjs'), replica.uri], { stdio: 'ignore' });
    await delay(500);

    section('5/6 Running k6 scenario (read + write + Bozorchi/Kassir contention + RBAC under load)');
    const k6ExitCode = await new Promise((resolve) => {
      const k6 = spawn('k6', ['run', '--env', `BASE_URL=${baseUrl}`, path.join(__dirname, 'scenario.js')], {
        cwd: __dirname,
        stdio: 'inherit',
      });
      k6.on('exit', (code) => resolve(code ?? 1));
      k6.on('error', (err) => { console.error('Failed to launch k6:', err.message); resolve(1); });
    });

    sampler.kill('SIGTERM');
    await delay(500);

    section('6/6 DB-level correctness verification');
    execSync(`node ${JSON.stringify(path.join(__dirname, 'verify.cjs'))} ${JSON.stringify(replica.uri)}`, { stdio: 'inherit' });

    const connectionsPath = path.join(__dirname, 'connections.json');
    if (fs.existsSync(connectionsPath)) {
      const { peakConnections } = JSON.parse(fs.readFileSync(connectionsPath, 'utf8'));
      console.log(`\nPeak MongoDB connections observed during run: ${peakConnections} (server pool cap is maxPoolSize=50, see backend/src/lib/mongoose.ts — not modified by this harness).`);
    }

    console.log(`\nk6 threshold result: ${k6ExitCode === 0 ? 'ALL THRESHOLDS PASSED' : 'ONE OR MORE THRESHOLDS FAILED (see k6 summary above)'}`);
    process.exitCode = k6ExitCode;
  } finally {
    section('Tearing down (server + disposable Mongo)');
    if (!serverExited) {
      serverProc.kill('SIGTERM');
      await new Promise((resolve) => serverProc.once('exit', resolve));
    }
    await replica.stop();
  }
}

main().catch((error) => {
  console.error('Load harness failed:', error);
  process.exitCode = 1;
});
