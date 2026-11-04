/**
 * 骨架冒烟测试：不开 DSH，用假 ctx 验证三个路由 + 开关逻辑。
 * 跑法：node smoke.mjs
 */
import { apply } from './index.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'playmate-'))
process.env.DSH_HOME = home

const routes = new Map()
const fakeHost = {
  effect(fn, label) {
    fn()
    return () => {}
  },
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => {}
    },
  },
}
apply({
  inject(deps, fn) {
    console.log('inject 要求:', deps.join(','))
    fn(fakeHost)
  },
})

function call(path, { method = 'GET', body } = {}) {
  const route = routes.get(path)
  if (!route) throw new Error('路由不存在: ' + path)
  return new Promise((resolve) => {
    const chunks = []
    const response = {
      writeHead(code, headers) {
        this.code = code
        this.headers = headers
      },
      end(buf) {
        chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)))
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try {
          json = JSON.parse(text)
        } catch {
          /* html */
        }
        resolve({ code: this.code, json, text, headers: this.headers })
      },
    }
    const payload = body === undefined ? '' : JSON.stringify(body)
    const request = {
      method,
      headers: { 'content-length': String(Buffer.byteLength(payload)) },
      socket: { remoteAddress: '127.0.0.1' },
      on(event, cb) {
        if (event === 'data' && payload) cb(Buffer.from(payload))
        if (event === 'end') cb()
      },
      destroy() {},
    }
    Promise.resolve(route.handler(request, response)).catch((e) =>
      resolve({ code: 500, json: { error: String(e) }, text: '' }),
    )
  })
}

const steps = []
const status0 = await call('/api/playmate/status')
steps.push(['初始状态（应全关）', status0.json.state.see === false && status0.json.state.talk === false])

const page = await call('/api/playmate/')
steps.push(['设置页能开', page.code === 200 && page.text.includes('陪玩') && page.text.includes('三个开关默认全关')])

const seeOn = await call('/api/playmate/toggle', { method: 'POST', body: { key: 'see', on: true } })
steps.push(['"看"引擎内置，可以直接打开', seeOn.code === 200 && seeOn.json.on === true])

const hearWired = await call('/api/playmate/toggle', { method: 'POST', body: { key: 'hear', on: true } })
steps.push(['"听"没配 ttsUrl 也拒绝（默认空）', hearWired.code === 409])

const ready = await call('/api/playmate/status')
steps.push(['"说"引擎内置，已就绪', ready.json.modules.talk.ready === true])

writeFileSync(join(home, 'playmate.json'), JSON.stringify({ ttsUrl: 'http://127.0.0.1:7864/say', asrUrl: 'http://127.0.0.1:7871/recognize' }), 'utf8')

// 注意：不在这里真的去 toggle「说」——那会拉起 python 引擎，测试里不该有副作用
const status1 = await call('/api/playmate/status')
steps.push(['状态读得回来', typeof status1.json.state.see === 'boolean'])
const hearOn = await call('/api/playmate/toggle', { method: 'POST', body: { key: 'hear', on: true } })
steps.push(['填了 ttsUrl 后"听"可以打开', hearOn.code === 200 && hearOn.json.on === true])

const badKey = await call('/api/playmate/toggle', { method: 'POST', body: { key: 'nope', on: true } })
steps.push(['未知开关被拒（400）', badKey.code === 400])

// ---- 详细配置 ----
const cfg0 = await call('/api/playmate/config')
steps.push(['配置能读，字段齐全', cfg0.code === 200 && cfg0.json.ok === true && !!cfg0.json.fields.seeFps])

const cfgSet = await call('/api/playmate/config', { method: 'POST', body: { seeMaxFrames: 6, seeDiff: 1.5, ttsUrl: 'http://127.0.0.1:7864/say' } })
steps.push(['配置能存（数字与字符串）', cfgSet.code === 200 && cfgSet.json.changed.length === 3])

const cfgBack = await call('/api/playmate/config')
steps.push(['存进去的值读得回来', cfgBack.json.config.seeMaxFrames === 6 && cfgBack.json.config.seeDiff === 1.5])

const bad = await call('/api/playmate/config', { method: 'POST', body: { seeFps: 99 } })
steps.push(['越界被拒（400 out-of-range）', bad.code === 400 && bad.json.error.startsWith('out-of-range')])

const unknown = await call('/api/playmate/config', { method: 'POST', body: { nope: 1 } })
steps.push(['未知字段被拒', unknown.code === 400])

let pass = 0
for (const [name, ok] of steps) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (ok) pass += 1
}
console.log(`\n${pass}/${steps.length} 通过；状态文件目录 ${home}`)
process.exit(pass === steps.length ? 0 : 1)
