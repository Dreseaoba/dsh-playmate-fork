/**
 * see-tool.mjs —— 把「看」包成一个工具交给模型。
 *
 * 三个坑（都是踩出来的，别改回去）：
 *   1. `parameters` 是「参数名 → 值 schema」的映射，**不是**完整 JSON Schema。
 *      写成 `{type:'object',properties:{…}}` 会被宿主拒：
 *      `parameters.type must be a value schema object`。
 *   2. 图要作为**工具返回值**交上去（`attachments.saveImage`），不要往会话里推
 *      —— 推了模型会自己唤醒自己，停不下来。
 *   3. `saveImage` 必须 `.call(svc, …)`，它内部读 `this`。
 */
import { captureSheet } from './see-engine.mjs'

export const TOOL_NAME = 'play_see'
export const TOOL_TIMEOUT_MS = 300_000

const DESCRIPTION = [
  '读取用户当前的屏幕：抓最近几秒的画面，按变化幅度挑几帧，拼成一张图返回。',
  '',
  '适用场景：用户问"你能看到我的屏幕吗""这个怎么操作""我现在在做什么"，或陪玩时需要了解画面内容。',
  '画面静止时只返回一帧（约 230 token）；画面有变化才会返回多帧（每帧再加约 230）。',
  '',
  '看图约定：格子按从左到右、从上到下的顺序排列，返回的文字会标出"第几格 = 第几秒"。',
  '只需说明与问题相关的部分，不必复述屏幕上已有的文字。',
  '',
  '注意：本工具只取画面，不能录音，也不能操作鼠标键盘。',
].join('\n')

export function seeToolSpec() {
  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      seconds: {
        type: 'number',
        description: '往前抓多少秒的画面，默认 8。想看清一个操作过程可以给 10–15；只想知道此刻什么样给 2–3。',
      },
      max_frames: {
        type: 'number',
        description: '最多给几帧，默认 9（3×3 九宫格）。给 1 就只要此刻这一张，最省。',
      },
    },
    output: {
      // 宿主的 schema 方言（0.2.1-rc.2）：
      //   · `required` 只能出现在 object 上（写成属性里的 required:true 会被拒）
      //   · `items.type` 只能是 object/array/string/number/integer/boolean/null（没有 json）
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          images: { type: 'array', items: { type: 'object', additionalProperties: true } },
          meta: { type: 'object', additionalProperties: true },
        },
      },
      render(_args, value) {
        return [
          ...((value && value.images) || []).map((attachment) => ({ type: 'image', attachment })),
          { type: 'text', text: String((value && value.text) || '') },
        ]
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe() {
      return false   // 同一时刻只跑一个采集，两个一起跑会把帧交错
    },
  }
}

/** 把引擎结果写成可读文字（模型靠这段对齐格子与时间） */
export function describeSheet(sheet) {
  const span = sheet.picked <= 1
    ? `此刻的 1 个画面（第 ${sheet.cells[0]?.atSecond ?? 0} 秒）`
    : `最近 ${sheet.cells[0]?.atSecond ?? 0}–${sheet.cells[sheet.cells.length - 1]?.atSecond ?? 0} 秒的 ${sheet.picked} 个画面`
  const lines = sheet.cells.map((c) => `第 ${c.cell} 格（第 ${c.row} 行第 ${c.col} 列）= 第 ${c.atSecond} 秒${c.diff === null ? '' : `，变化分 ${c.diff}`}`)
  return [
    `${span} · ${sheet.width}×${sheet.height} · 约 ${sheet.tokens} token`,
    ...lines,
    `（抓了 ${sheet.grabbed} 帧，挑出 ${sheet.picked} 帧，源=${sheet.engine}，耗时 ${(sheet.ms / 1000).toFixed(1)} 秒）`,
  ].join('\n')
}

/**
 * 跑一次「看」，并把图交成附件。
 * @param {object} opts { ffmpeg, workDir, seconds, maxFrames }
 */
export async function runSee(ctx, svcAttachments, opts = {}) {
  const sheet = await captureSheet({
    seconds: Math.max(1, Math.min(20, Number(opts.seconds) || Number(opts.defaultSeconds) || 8)),
    fps: Math.max(1, Math.min(4, Number(opts.fps) || Number(opts.defaultFps) || 2)),
    maxFrames: Math.max(1, Math.min(9, Number(opts.maxFrames) || Number(opts.defaultMaxFrames) || 9)),
    cols: 3,
    ffmpeg: opts.ffmpeg || process.env.PLAY_FFMPEG || 'ffmpeg',
    workDir: opts.workDir || '',
    diffThreshold: Number(opts.diffThreshold) || 2,
  })
  const text = describeSheet(sheet)
  if (!svcAttachments?.saveImage) {
    return { text: `${text}\n\n（图已生成，但宿主没有 attachments 服务，无法提交：${sheet.file}）`, meta: { ok: false } }
  }
  const { readFileSync } = await import('node:fs')
  const ref = await svcAttachments.saveImage.call(svcAttachments, {
    data: readFileSync(sheet.file),
    mediaType: 'image/png',
    name: `playmate-see-${Date.now()}.png`,
  })
  return {
    images: [ref],
    text,
    meta: {
      ok: true,
      tokens: sheet.tokens,
      picked: sheet.picked,
      grabbed: sheet.grabbed,
      grid: sheet.grid,
      engine: sheet.engine,
      bytes: sheet.bytes,
      ms: sheet.ms,
    },
  }
}
