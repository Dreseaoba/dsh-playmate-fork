/**
 * see-engine.mjs —— 「看」的引擎
 *
 * 三段，分开是为了"出问题能查"：
 *   1. 抓：ffmpeg 抓 seconds 秒、fps 帧率，缩到 800×450，逐帧落 png
 *   2. 判：每帧转 64×36 灰度，和上一帧算平均绝对差 → 变化分（屏幕不动就几乎为 0）
 *   3. 拼：按变化分挑最多 maxFrames 帧（保持时间顺序），拼成一张图
 *
 * **为什么不烧序号**：drawtext 依赖系统字体（fontconfig 在受沙箱限制的环境里常常没有
 * 可写缓存，直接画不出来）；发布版更不该依赖用户机器上恰好有某个字体。
 * 改成随图返回「第几格 = 第几秒、变化分多少」，模型按位置对就行。
 *
 * **为什么同时支持 ddagrab 和 gdigrab**：ddagrab 走桌面复制 API（GPU、最省 CPU），
 * 但它要求 D3D11 可用；在远程/受限会话里会直接报 `Function not implemented`。
 * 所以默认 auto：先试 ddagrab，失败立刻换 gdigrab。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

export const THUMB_W = 800
export const THUMB_H = 450
const GRAY_W = 64
const GRAY_H = 36
const DEFAULT_DIFF = 2.0

function run(cmd, argv, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { windowsHide: true, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] })
    const chunks = []
    let err = ''
    if (capture) p.stdout.on('data', (c) => chunks.push(c))
    p.stderr.on('data', (c) => (err += c.toString()))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(`${cmd} 退出码 ${code}: ${err.slice(-500)}`))
      else resolve(capture ? Buffer.concat(chunks) : null)
    })
  })
}

/** 读 PNG 头拿真实尺寸（IHDR 在 16..24 字节） */
export function pngSize(file) {
  const b = readFileSync(file)
  if (b.length < 24 || b.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

/** 按 DeepSeek 视觉口径估 token：42px 一格，rows×(cols+1)+2 */
export function estimateTokens(width, height) {
  const cell = 42
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  return rows * (cols + 1) + 2
}

async function grab(dir, { seconds, fps, ffmpeg, engine }) {
  const pattern = join(dir, 'f%03d.png')
  const base = [
    '-hide_banner', '-v', 'error', '-t', String(seconds),
    '-vf', `scale=${THUMB_W}:${THUMB_H}`, '-fps_mode', 'passthrough', '-y', pattern,
  ]
  if (engine !== 'gdigrab') {
    try {
      await run(ffmpeg, ['-f', 'lavfi', '-i', `ddagrab=0:framerate=${fps}`, ...base])
    } catch {
      for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true })
    }
  }
  let got = readdirSync(dir).filter((f) => f.endsWith('.png'))
  if (got.length > 0) return { files: got.sort(), engine: 'ddagrab' }
  if (engine === 'ddagrab') throw new Error('ddagrab 抓不到画面')
  await run(ffmpeg, ['-f', 'gdigrab', '-framerate', String(fps), '-i', 'desktop', ...base])
  got = readdirSync(dir).filter((f) => f.endsWith('.png'))
  return { files: got.sort(), engine: 'gdigrab' }
}

async function grayOf(ffmpeg, file) {
  return run(ffmpeg, [
    '-hide_banner', '-v', 'error', '-i', file,
    '-vf', `scale=${GRAY_W}:${GRAY_H},format=gray`, '-f', 'rawvideo', '-',
  ], { capture: true })
}

function meanAbsDiff(a, b) {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i])
  return n === 0 ? 0 : sum / n
}

async function tile(ffmpeg, files, cols, outFile) {
  const seqDir = join(dirname(outFile), '.seq')
  rmSync(seqDir, { recursive: true, force: true })
  mkdirSync(seqDir, { recursive: true })
  files.forEach((f, i) => copyFileSync(f, join(seqDir, `s${String(i + 1).padStart(3, '0')}.png`)))
  const rows = Math.max(1, Math.ceil(files.length / cols))
  try {
    await run(ffmpeg, [
      '-hide_banner', '-v', 'error', '-framerate', '1', '-i', join(seqDir, 's%03d.png'),
      '-vf', `tile=${cols}x${rows}:padding=6:margin=6`, '-frames:v', '1', '-y', outFile,
    ])
  } finally {
    rmSync(seqDir, { recursive: true, force: true })
  }
  return { rows, cols }
}

/**
 * 只抓**一帧**（自动看屏幕用）：最省的那条路。
 */
export async function captureFrame(options = {}) {
  const opt = {
    ffmpeg: process.env.PLAY_FFMPEG || 'ffmpeg',
    engine: process.env.PLAY_ENGINE || 'auto',
    workDir: process.env.PLAY_WORK || '',
    ...options,
  }
  opt.ffmpeg = opt.ffmpeg || process.env.PLAY_FFMPEG || 'ffmpeg'
  opt.engine = opt.engine || process.env.PLAY_ENGINE || 'auto'
  opt.workDir = opt.workDir || process.env.PLAY_WORK || ''
  const base = opt.workDir || tmpdir()
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'play-frame-'))
  try {
    const { files, engine } = await grab(dir, { ...opt, seconds: 1, fps: 1 })
    if (files.length === 0) throw new Error('没抓到帧')
    const file = join(dir, files[files.length - 1])
    const size = pngSize(file)
    const gray = await grayOf(opt.ffmpeg, file)
    return {
      file,
      dir,
      width: size?.width ?? THUMB_W,
      height: size?.height ?? THUMB_H,
      tokens: size ? estimateTokens(size.width, size.height) : null,
      engine,
      gray,
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

/**
 * 抓一段屏幕并拼成一张图。
 */
export async function captureSheet(options = {}) {
  const opt = {
    seconds: 8, fps: 2, maxFrames: 9, cols: 3,
    ffmpeg: process.env.PLAY_FFMPEG || 'ffmpeg',
    engine: process.env.PLAY_ENGINE || 'auto',
    workDir: process.env.PLAY_WORK || '',
    outFile: '',
    diffThreshold: Number(process.env.PLAY_DIFF || DEFAULT_DIFF),
    ...options,
  }
  opt.ffmpeg = opt.ffmpeg || process.env.PLAY_FFMPEG || 'ffmpeg'
  opt.workDir = opt.workDir || process.env.PLAY_WORK || ''
  opt.engine = opt.engine || process.env.PLAY_ENGINE || 'auto'
  const t0 = Date.now()
  const base = opt.workDir || tmpdir()
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'play-see-'))
  const outFile = opt.outFile || join(base, `sheet-${Date.now()}.png`)
  try {
    const { files, engine } = await grab(dir, opt)
    if (files.length === 0) throw new Error('一帧都没抓到（屏幕源不可用）')
    const tGrab = Date.now() - t0

    const scores = []
    let prev = null
    for (const f of files) {
      const g = await grayOf(opt.ffmpeg, join(dir, f))
      scores.push({ file: join(dir, f), index: scores.length, score: prev === null ? Infinity : meanAbsDiff(g, prev) })
      prev = g
    }
    let chosen = scores.filter((s) => s.score === Infinity || s.score >= opt.diffThreshold)
    if (chosen.length > opt.maxFrames) {
      chosen = chosen.slice().sort((a, b) => b.score - a.score).slice(0, opt.maxFrames).sort((a, b) => a.index - b.index)
    }
    const picked = chosen.length > 0 ? chosen.map((c) => c.file) : [scores[0].file]

    const gridCols = Math.max(1, Math.min(opt.cols, picked.length))
    const { rows, cols } = await tile(opt.ffmpeg, picked, gridCols, outFile)
    const size = pngSize(outFile)
    const cells = picked.map((f, i) => {
      const s = scores.find((x) => x.file === f)
      return {
        cell: i + 1,
        row: Math.floor(i / gridCols) + 1,
        col: (i % gridCols) + 1,
        atSecond: Number((s.index / opt.fps).toFixed(2)),
        diff: Number.isFinite(s.score) ? Number(s.score.toFixed(2)) : null,
      }
    })
    return {
      file: outFile,
      bytes: readFileSync(outFile).length,
      width: size?.width ?? cols * (THUMB_W + 6),
      height: size?.height ?? rows * (THUMB_H + 6),
      tokens: size ? estimateTokens(size.width, size.height) : null,
      grabbed: files.length,
      picked: picked.length,
      grid: `${cols}x${rows}`,
      engine,
      grabMs: tGrab,
      ms: Date.now() - t0,
      cells,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---- CLI（调试用） ----
const cli = process.argv[1] && /see-engine\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))
if (cli) {
  const a = process.argv.slice(2)
  const opt = {}
  for (let i = 0; i < a.length; i += 2) {
    const k = a[i].replace(/^--/, '')
    const v = a[i + 1]
    if (['seconds', 'fps', 'maxFrames', 'cols'].includes(k)) opt[k] = Number(v)
    else if (k === 'out') opt.outFile = v
    else if (k === 'ffmpeg') opt.ffmpeg = v
  }
  captureSheet(opt)
    .then((r) => console.log(JSON.stringify(r, null, 1)))
    .catch((e) => {
      console.error('失败：', e.message)
      process.exit(1)
    })
}
