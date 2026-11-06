const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
let disk = null
let writes = 0
function createLoader() {
  const cache = new Map()
  function load(relative) {
    const filename = path.resolve(root, relative)
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }; cache.set(filename, module)
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    new Function('require', 'module', 'exports', source)(name => {
      if (name === 'electron') return { app: { isPackaged: false, getPath: () => '/isolated-profile' } }
      if (name === 'node:fs') return {
        existsSync: () => disk !== null, mkdirSync() {}, readFileSync: () => disk,
        writeFileSync: (_file, value) => { disk = value; writes++ }
      }
      if (name === './paths') return { externalConfigFile: () => '/isolated-profile/config.json' }
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')))
      return require(name)
    }, module, module.exports)
    return module.exports
  }
  return load
}
let load = createLoader()
const { petRenderResolution } = load('src/shared/petRendering.ts')
for (const samples of [2, 4, 8]) {
  assert.equal(petRenderResolution(false, samples, 2, 420, 520), 1)
  assert.ok(Math.abs(petRenderResolution(true, samples, 1, 420, 520) ** 2 - samples) < 1e-10)
  assert.ok(Math.abs(petRenderResolution(true, samples, 2, 420, 520) ** 2 - 4 * samples) < 1e-10)
}
assert.equal(petRenderResolution(true, 8, 2, 800, 1000, 2048), 2.048)
const limited = petRenderResolution(true, 8, 3, 3000, 2000)
assert.ok(3000 * 2000 * limited ** 2 <= 16_000_001)
console.log('PASS sample multipliers, screen density and GPU/color-buffer limits')

let config = load('src/main/config.ts')
assert.equal(config.getConfig().pet.antialiasing, false)
assert.equal(config.getConfig().pet.antialiasingSamples, 2)
config.setConfig({ pet: { antialiasing: true, antialiasingSamples: 8 } })
load = createLoader(); config = load('src/main/config.ts')
assert.equal(config.getConfig().pet.antialiasing, true)
assert.equal(config.getConfig().pet.antialiasingSamples, 8)
config.setConfig({ pet: { antialiasing: false } })
assert.equal(config.getConfig().pet.antialiasingSamples, 8)
const before = writes
for (const invalid of [0, 1, 3, 16, '4', null]) {
  assert.throws(() => config.setConfig({ pet: { antialiasingSamples: invalid } }))
}
assert.throws(() => config.setConfig({ pet: { antialiasing: 'true' } }))
assert.equal(writes, before)
assert.equal(config.getConfig().pet.antialiasingSamples, 8)
disk = JSON.stringify({ pet: { antialiasing: 'invalid', antialiasingSamples: 64 }, controlApi: { token: 'fixture-config-token' } })
config = createLoader()('src/main/config.ts')
assert.equal(config.getConfig().pet.antialiasing, false)
assert.equal(config.getConfig().pet.antialiasingSamples, 2)
console.log('PASS old configuration defaults, restart persistence, toggle retention and invalid settings')
