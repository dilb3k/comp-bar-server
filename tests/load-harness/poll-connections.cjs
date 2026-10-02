// Samples MongoDB's live connection count every second for the duration of
// the k6 run — the backend's own pool cap (maxPoolSize: 50, see
// backend/src/lib/mongoose.ts, not modified here) is the real ceiling under
// 1000 concurrent VUs; this is what actually shows whether that ceiling was
// saturated, which a pure HTTP-level view (k6's own metrics) cannot see.
const { MongoClient } = require('mongodb');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

async function main() {
  const uri = process.argv[2];
  if (!uri) throw new Error('Usage: node poll-connections.cjs <mongodb-uri>');
  const client = new MongoClient(uri);
  await client.connect();
  const samples = [];

  const interval = setInterval(async () => {
    try {
      const status = await client.db('admin').command({ serverStatus: 1 });
      samples.push({ t: Date.now(), current: status.connections.current, available: status.connections.available });
    } catch { /* transient — skip this tick */ }
  }, 1000);

  process.on('SIGTERM', async () => {
    clearInterval(interval);
    const peak = samples.reduce((max, s) => Math.max(max, s.current), 0);
    writeFileSync(join(__dirname, 'connections.json'), JSON.stringify({ samples, peakConnections: peak }, null, 2));
    await client.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('poll-connections failed:', error);
  process.exit(1);
});
