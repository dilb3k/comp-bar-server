const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(file, mocks = {}, cache = new Map()) {
  file = path.resolve(file);
  if (!fs.existsSync(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const req = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('.')) return loadSource(path.resolve(path.dirname(file), name), mocks, cache);
    return require(name);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: req, console, Number, Math, Date, Map, Set, JSON, Error, Buffer, Uint8Array, __dirname: path.dirname(file) });
  return module.exports;
}
module.exports = { loadSource };
