// Isolated, disposable local replica set. Never loads the project's .env.
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');
const { MongoClient } = require('mongodb');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function freePort() { const s = net.createServer(); await new Promise((resolve, reject) => { s.once('error', reject); s.listen(0, '127.0.0.1', resolve); }); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hisvex-test-'));
  const port = await freePort();
  const server = spawn(process.env.MONGOD_BINARY || 'mongod', ['--dbpath', dir, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'hisvex_test', '--nounixsocket', '--logpath', join(dir, 'mongo.log')], { stdio: 'ignore' });
  let spawnError;
  server.on('error', error => { spawnError = error; });
  const bootstrap = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
  try {
    for (let i = 0; ; i++) {
      if (spawnError) throw spawnError;
      try { await bootstrap.connect(); await bootstrap.db('admin').command({ ping: 1 }); break; }
      catch (error) { if (i >= 50 || server.exitCode !== null) throw error; await delay(200); }
    }
    await bootstrap.db('admin').command({ replSetInitiate: { _id: 'hisvex_test', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    for (let i = 0; ; i++) { if ((await bootstrap.db('admin').command({ hello: 1 })).isWritablePrimary) break; if (i > 80) throw Error('Replica set not ready'); await delay(200); }
    await bootstrap.close();
    const env = { PATH: process.env.PATH, NODE_ENV: 'test', TZ: 'UTC', MONGODB_URL: `mongodb://127.0.0.1:${port}/hisvex_integration?replicaSet=hisvex_test`, JWT_SECRET: 'local_test_secret_not_for_production', JWT_REFRESH_SECRET: 'local_refresh_secret_not_for_production' };
    const files = process.argv.slice(2);
    const defaults = [...require('node:fs').readdirSync('backend/dist/tests').filter(name => name.endsWith('.integration.test.js')).map(name => `backend/dist/tests/${name}`), 'scripts/http-concurrency.integration.test.cjs','scripts/procurement-http.integration.test.cjs','scripts/migration.integration.test.cjs','scripts/config.test.cjs'];
    const child = spawn(process.execPath, ['--test', ...(files.length ? files : defaults)], { stdio: 'inherit', env });
    process.exitCode = await new Promise(resolve => child.once('exit', (code) => resolve(code ?? 1)));
  } catch (error) {
    console.error(error.message);
    try { console.error(readFileSync(join(dir, 'mongo.log'), 'utf8').slice(-3500)); } catch {}
    process.exitCode = 1;
  } finally {
    await bootstrap.close().catch(() => {});
    if (server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
    rmSync(dir, { recursive: true, force: true });
  }
})();
