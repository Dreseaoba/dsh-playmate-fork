/**
 * session-label.mjs —— 把「一串 uuid」变成人看得懂的名字。
 *
 * 会话文件是多帧 zstd 追加日志：第一帧只有 header（id/cwd/createdAt，**没有标题**），
 * 之后每帧是一批事件。所以要拿到"像标题的东西"，只能往后翻几帧，找第一条
 * 像人话的 user/message。
 *
 * 兜底用 header 里的 cwd + createdAt —— 那两个一定拿得到。
 */
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const cache = new Map()

/**
 * DSH 桌面端自己给会话起的名字（侧边栏显示的那个）存在 projcache 里：
 *   <DSH_HOME>/storages/session_projcache/sessions/<id>.json → record.rows.title.val
 * 优先用它 —— 用户在侧边栏看到的名字就是这个。
 */
function titleFromCache(id) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const file = join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  if (!existsSync(file)) return ''
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const t = parsed?.record?.rows?.title?.val
    return typeof t === 'string' ? t.trim() : ''
  } catch {
    return ''
  }
}

function sessionsRoot() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
}

/** 找到某个会话的日志文件（目录名是编码过的 cwd，直接按 id 扫） */
function findSessionFile(id) {
  const root = sessionsRoot()
  if (!existsSync(root)) return ''
  let dirs = []
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return ''
  }
  for (const d of dirs) {
    const candidate = join(root, d, id, 'session.v4.jsonl.zstd')
    if (existsSync(candidate)) return candidate
  }
  return ''
}

/** 把前 limit 字节按帧切开，逐帧解压，拼成文本 */
function decompressPrefix(file, limit = 768 * 1024) {
  const buf = readFileSync(file)
  const slice = buf.subarray(0, Math.min(buf.length, limit))
  const starts = []
  for (let i = 0; i + 4 <= slice.length; i += 1) {
    if (slice[i] === ZSTD_MAGIC[0] && slice[i + 1] === ZSTD_MAGIC[1] && slice[i + 2] === ZSTD_MAGIC[2] && slice[i + 3] === ZSTD_MAGIC[3]) {
      starts.push(i)
    }
  }
  let zstd = null
  try {
    zstd = createRequire(import.meta.url)('node:zlib')
  } catch {
    zstd = null
  }
  if (zstd === null || typeof zstd.zstdDecompressSync !== 'function') return ''
  const parts = []
  for (let k = 0; k < starts.length && k < 40; k += 1) {
    const from = starts[k]
    const to = k + 1 < starts.length ? starts[k + 1] : slice.length
    try {
      parts.push(zstd.zstdDecompressSync(slice.subarray(from, to)).toString('utf8'))
    } catch {
      /* 半截帧、坏帧都跳过 */
    }
    if (parts.join('').length > 240 * 1024) break
  }
  return parts.join('')
}

/** 系统噪音不算标题 */
function isNoise(t) {
  if (t.length < 4) return true
  if (/^(Current runtime context|The approval policy|<system-reminder>|<available_skills>)/i.test(t)) return true
  if (/changed by the user/i.test(t)) return true
  if (t.startsWith('{') || t.startsWith('[')) return true
  if (/^\(empty message\)?$/i.test(t)) return true
  if (t.startsWith('【核心身份】') || t.startsWith('You are ') || t.startsWith('你是')) return true
  return false
}

/** 第一条"像人话"的用户消息：短优先（长的多半是注入的提示词） */
function firstUserText(text) {
  let long = ''
  for (const line of text.split('\n')) {
    if (!line.includes('"user/message"')) continue
    let rec = null
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    const content = rec?.data?.content
    if (!Array.isArray(content)) continue
    const chunk = content.find((c) => c && c.type === 'text' && typeof c.text === 'string')
    if (!chunk) continue
    const t = String(chunk.text).trim()
    if (isNoise(t)) continue
    if (t.length <= 120) return t
    if (long === '') long = t.slice(0, 120)
  }
  return long
}

function headerOf(text) {
  const line = text.split('\n').find((l) => l.includes('"type":"session"'))
  if (!line) return null
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function stamp(ms) {
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * @returns {{label:string, detail:string}}
 */
export function sessionLabel(id) {
  if (cache.has(id)) return cache.get(id)
  const cached = titleFromCache(id)
  if (cached !== '') {
    const out = { label: cached, detail: cached }
    cache.set(id, out)
    return out
  }
  const file = findSessionFile(id)
  let label = ''
  let detail = ''
  if (file !== '') {
    const text = decompressPrefix(file)
    const head = headerOf(text)
    const first = firstUserText(text)
    const dir = head?.cwd ? basename(String(head.cwd)) : ''
    const when = stamp(head?.createdAt)
    if (first !== '') {
      label = first.replace(/\s+/g, ' ').slice(0, 22) + (first.length > 22 ? '…' : '')
      detail = [dir, when, first.replace(/\s+/g, ' ').slice(0, 90)].filter(Boolean).join(' · ')
    } else {
      label = [dir || '会话', when].filter(Boolean).join(' · ')
      detail = id.slice(0, 18) + '…'
    }
  }
  if (label === '') {
    label = '会话 ' + id.slice(8, 16)
    detail = id
  }
  const out = { label, detail }
  cache.set(id, out)
  return out
}

export function clearLabelCache() {
  cache.clear()
}
