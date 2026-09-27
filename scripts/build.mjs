/** 构建：tsc 编译主进程 + vite 打包渲染端（不依赖 PATH 里的 .bin） */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as path from 'node:path'

const require = createRequire(import.meta.url)
const node = process.execPath

function run(label, script, args) {
  console.log(`> ${label} ${args.join(' ')}`)
  const r = spawnSync(node, [script, ...args], { stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const tsc = require.resolve('typescript/bin/tsc')
const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

run('tsc', tsc, ['-p', 'tsconfig.electron.json'])
run('vite', vite, ['build'])
console.log('[build] done')
