/**
 * watch.mjs —— 「自动看屏幕」：定时抓一帧，画面变化够大才把这一帧交给会话。
 *
 * 为什么不是"一直录视频"：token 才是成本。一帧 800×450 约 233 token，
 * 静止屏根本不该给；只有**变化分超过阈值**才值得让模型看一眼。
 *
 * 交付方式：作为一条用户消息注入（带图 + 一句说明）。这样模型看到的和
 * "用户把截图贴进来"是同一种东西，不需要模型自己调工具。
 *
 * 三条保险，避免吵人和烧钱：
 *   1. 最短间隔 `seeMinGapMs`（默认 15 秒）：再剧烈也不会一秒一张
 *   2. 变化分阈值（默认 8）：鼠标抖一下不算
 *   3. 上一张还没被消费就不叠加：永远只保留最新一张
 */
import { rmSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { captureFrame } from './see-engine.mjs'
import { pickAgent } from './ear.mjs'

const GRAY_SIZE = 64 * 36

/**
 * 三档"多主动"。档位覆盖两个数：多久才允许送一次、变化分门槛。
 * 为什么用档位而不是让用户填两个数字：填数字用户根本不知道 8 和 12 差多少，
 * 但"安静/正常/热闹"一说就懂。
 */
export const PACES = {
  quiet: { gapSec: 180, diff: 12, label: '安静' },
  normal: { gapSec: 60, diff: 9, label: '正常' },
  dense: { gapSec: 15, diff: 6, label: '热闹' },
}

function meanAbsDiff(a, b) {
  const n = Math.min(a.length, b.length, GRAY_SIZE)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i])
  return sum / n
}

/**
 * @param {object} opts { getState, log, attachments }
 */
export function createWatch({ getState, log = () => {}, attachments = null, host = null }) {
  let timer = null
  let running = false
  let lastGray = null
  let lastDeliveredAt = 0
  let frames = 0
  let delivered = 0
  let lastScore = 0
  let lastError = ''

  const clip = () => typeof timer?.unref === 'function' && timer.unref()

  async function tick() {
    if (!running) return
    const state = getState() ?? {}
    if (state.see !== true || state.seeMode !== 'auto') {
      stop('开关关着或已切手动')
      return
    }
    const everyMs = Math.max(1000, Math.min(60000, (Number(state.seeEvery) || 3) * 1000))
    const pace = PACES[String(state.seePace ?? '')] ?? PACES.quiet
    const threshold = Math.max(0.5, Math.min(60, Number(pace.diff) || 8))
    try {
      const frame = await captureFrame({
        ffmpeg: String(state.ffmpegPath ?? '').trim() || undefined,
        workDir: String(state.workDir ?? '').trim() || undefined,
      })
      frames += 1
      const score = lastGray === null ? Infinity : meanAbsDiff(frame.gray, lastGray)
      lastScore = Number.isFinite(score) ? Number(score.toFixed(2)) : 999
      lastGray = frame.gray
      const gapOk = Date.now() - lastDeliveredAt >= Math.max(3000, pace.gapSec * 1000)
      if (score >= threshold && gapOk) {
        await deliver(frame, lastScore, state)
        lastDeliveredAt = Date.now()
      }
      rmSync(frame.dir, { recursive: true, force: true })
    } catch (e) {
      lastError = String(e?.message ?? e)
      log(`[dsh-playmate/watch] 抓帧失败：${lastError}`)
    } finally {
      if (running) {
        timer = setTimeout(() => void tick(), everyMs)
        clip()
      }
    }
  }

  async function deliver(frame, score, state) {
    if (!attachments?.saveImage) {
      log('[dsh-playmate/watch] 宿主没有 attachments，交不上图')
      return
    }
    const png = readFileSync(frame.file)
    rmSync(frame.dir, { recursive: true, force: true })
    const ref = await attachments.saveImage.call(attachments, {
      data: png,
      mediaType: 'image/png',
      name: `playmate-watch-${Date.now()}.png`,
    })
    const agent = pickAgent(host, state.targetMode === 'fixed' ? String(state.targetSessionId ?? '') : '')
    if (!agent) {
      log('[dsh-playmate/watch] 找不到会话，图没送出去')
      return
    }
    const text = `【屏幕】画面有变化（变化分 ${score}）· ${frame.width}×${frame.height} · 约 ${frame.tokens} token。用户没有说话，这是自动采集到的一帧画面。`
    agent.followup({
      role: 'user',
      id: randomUUID(),
      content: [
        { type: 'image', attachment: ref },
        { type: 'text', text },
      ],
      source: { kind: 'user' },
    })
    delivered += 1
    log(`[dsh-playmate/watch] 送了一帧（score=${score}, 第 ${delivered} 张）`)
  }

  function start() {
    if (running) return { ok: true, already: true }
    running = true
    lastGray = null
    timer = setTimeout(() => void tick(), 1500)
    clip()
    log('[dsh-playmate/watch] 自动看屏幕已启动')
    return { ok: true }
  }

  function stop(reason = '') {
    if (!running && timer === null) return { ok: true, running: false }
    running = false
    if (timer !== null) clearTimeout(timer)
    timer = null
    log(`[dsh-playmate/watch] 已停${reason ? '（' + reason + '）' : ''}`)
    return { ok: true, running: false }
  }

  function status() {
    return { running, frames, delivered, lastScore, lastError, lastDeliveredAt }
  }

  return { start, stop, status }
}
