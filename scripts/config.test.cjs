const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
test('literal false migration/public-register env flags stay false and malformed booleans fail closed',()=>{
 const env={PATH:process.env.PATH,NODE_ENV:'test',MONGODB_URL:'mongodb://127.0.0.1/unused',JWT_SECRET:'test_config_not_for_production',MIGRATION_ENABLED:'false',ALLOW_PUBLIC_REGISTER:'false'};
 const run=extra=>spawnSync(process.execPath,['-e','const {env}=require("./backend/dist/config/env");console.log(JSON.stringify([env.MIGRATION_ENABLED,env.ALLOW_PUBLIC_REGISTER]))'],{env:{...env,...extra},encoding:'utf8'});
 assert.deepEqual(JSON.parse(run({}).stdout),[false,false]);assert.deepEqual(JSON.parse(run({MIGRATION_ENABLED:'true'}).stdout),[true,false]);assert.notEqual(run({MIGRATION_ENABLED:'invalid'}).status,0);
});
