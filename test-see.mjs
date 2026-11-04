/**
 * 工具侧冒烟：不开 DSH，用假 tools/attachments 验证
 *   ① 开关关着时不抓屏、直接说"关着的"
 *   ② 开关打开时真抓一次屏，图交成附件，返回里有格子与时间
 * 跑法：node test-see.mjs
 */
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'playmate-see-'))
process.env.DSH_HOME = home
process.env.PLAY_FFMPEG = process.env.PLAY_FFMPEG || 'ffmpeg'
process.env.PLAY_WORK = process.env.PLAY_WORK || ''

const { apply } = await import('./index.js')

let registered = null
const saved = []
const fakeCtx = {
  inject(deps, fn) {
    // 真宿主会把注入进来的服务包成一个 host 传进来
    const host = {
      effect() {},
      get: (k) => fakeCtx.get(k),
    }
    for (const d of deps) host[d] = fakeCtx.get(d)
    fn(host)
  },
  effect() {},
  get(key) {
    if (key === 'tools') return { register: (spec) => { registered = spec; return () => {} } }
    if (key === 'attachments') return { saveImage: async (arg) => { saved.push(arg); return { id: 'att-1', mediaType: arg.mediaType, name: arg.name } } }
    return null
  },
  logger: { info() {}, warn() {}, error() {} },
}

apply(fakeCtx)
await new Promise((r) => setTimeout(r, 1500))

const steps = []
steps.push(['工具已注册', registered !== null && registered.name === 'play_see'])

// ① 关着
const off = await registered.execute({ seconds: 2, max_frames: 1 })
steps.push(['关着时不抓屏、说明原因', /关着/.test(off.text) && off.meta.ok === false])

// ② 打开
writeFileSync(join(home, 'playmate.json'), JSON.stringify({ see: true, seeDiff: 2 }), 'utf8')
const on = await registered.execute({ seconds: 3, max_frames: 1 })
steps.push(['打开后返回了图', Array.isArray(on.images) && on.images.length === 1])
steps.push(['返回里有格子与时间', /第 1 格.*第 .* 秒/.test(on.text)])
steps.push(['图交成了附件', saved.length === 1 && saved[0].mediaType === 'image/png'])
steps.push(['meta 里有 token 估算', typeof on.meta?.tokens === 'number' && on.meta.tokens > 0])

let pass = 0
for (const [name, ok] of steps) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (ok) pass += 1
}
console.log('\n返回文字预览：\n' + String(on.text).split('\n').slice(0, 4).join('\n'))
console.log(`\n${pass}/${steps.length} 通过 ｜ 工作目录 ${home}`)
process.exit(pass === steps.length ? 0 : 1)
