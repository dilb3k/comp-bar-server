const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
test('literal false migration/public-register env flags stay false and malformed booleans fail closed',()=>{
 const env={PATH:process.env.PATH,NODE_ENV:'test',MONGODB_URL:'mongodb://127.0.0.1/unused',JWT_SECRET:'test_config_not_for_production',MIGRATION_ENABLED:'false',ALLOW_PUBLIC_REGISTER:'false'};
 const run=extra=>spawnSync(process.execPath,['-e','const {env}=require("./backend/dist/config/env");console.log(JSON.stringify([env.MIGRATION_ENABLED,env.ALLOW_PUBLIC_REGISTER]))'],{env:{...env,...extra},encoding:'utf8'});
 assert.deepEqual(JSON.parse(run({}).stdout),[false,false]);assert.deepEqual(JSON.parse(run({MIGRATION_ENABLED:'true'}).stdout),[true,false]);assert.notEqual(run({MIGRATION_ENABLED:'invalid'}).status,0);
});
test('OTP bot token is trimmed; an unset or blank optional token preserves the legacy fallback',()=>{
 const env={PATH:process.env.PATH,NODE_ENV:'test',MONGODB_URL:'mongodb://127.0.0.1/unused',JWT_SECRET:'test_config_not_for_production',BOT_TOKEN:'report-bot-test-token'};
 const run=extra=>spawnSync(process.execPath,['-e','const {env}=require("./backend/dist/config/env");console.log(JSON.stringify([env.OTP_TELEGRAM_BOT_TOKEN??null,env.BOT_TOKEN]))'],{env:{...env,...extra},encoding:'utf8'});
 for(const extra of [{},{OTP_TELEGRAM_BOT_TOKEN:''},{OTP_TELEGRAM_BOT_TOKEN:'  '}]){
  const result=run(extra);assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),[null,'report-bot-test-token']);
 }
 const result=run({OTP_TELEGRAM_BOT_TOKEN:'  interactive-bot-test-token  '});assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),['interactive-bot-test-token','report-bot-test-token']);
});
