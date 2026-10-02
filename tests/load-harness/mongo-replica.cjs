// Disposable, single-node local replica set — isolated clone of the same
// technique scripts/test-integration.cjs uses, written fresh here so this
// harness never requires/imports/touches that file. Never loads the
// project's real .env and never points at a real MONGODB_URL.
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');
const { MongoClient } = require('mongodb');

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

async function startDisposableReplicaSet(dbName = 'hisvex_load_test') {
  const dir = mkdtempSync(join(tmpdir(), 'hisvex-load-'));
  const port = await freePort();
  const replSetName = 'hisvex_load';
  const server = spawn(
    process.env.MONGOD_BINARY || 'mongod',
    ['--dbpath', dir, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', replSetName, '--nounixsocket', '--logpath', join(dir, 'mongo.log')],
    { stdio: 'ignore' },
  );
  let spawnError;
  server.on('error', (error) => { spawnError = error; });

  const bootstrap = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
  try {
    for (let i = 0; ; i++) {
      if (spawnError) throw spawnError;
      try {
        await bootstrap.connect();
        await bootstrap.db('admin').command({ ping: 1 });
        break;
      } catch (error) {
        if (i >= 50 || server.exitCode !== null) throw error;
        await delay(200);
      }
    }
    await bootstrap.db('admin').command({ replSetInitiate: { _id: replSetName, members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    for (let i = 0; ; i++) {
      if ((await bootstrap.db('admin').command({ hello: 1 })).isWritablePrimary) break;
      if (i > 80) throw new Error('Replica set not ready');
      await delay(200);
    }
  } finally {
    await bootstrap.close().catch(() => {});
  }

  const uri = `mongodb://127.0.0.1:${port}/${dbName}?replicaSet=${replSetName}`;
  return {
    uri,
    port,
    async stop() {
      if (server.exitCode === null) {
        server.kill('SIGTERM');
        await new Promise((resolve) => server.once('exit', resolve));
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { startDisposableReplicaSet };
