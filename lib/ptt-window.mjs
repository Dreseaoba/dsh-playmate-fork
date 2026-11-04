/**
 * ptt-window.mjs —— 那个「按住说话」小浮窗的宿主半边。
 *
 * 为什么不用设置页里的按钮：游戏里根本按不到设置页。所以做成一个**永远置顶、
 * 可以拖**的小窗，按住说话、松开就发；它只往 /api/playmate/ptt 写 start/stop。
 *
 * 为什么要单独一个进程：PowerShell WinForms 的窗口必须有自己的消息循环，
 * 塞在宿主进程里会挡住事件循环。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'


/**
 * 杀掉所有 ptt-window.ps1 进程（包括不是本进程拉起的）。
 * 用 PowerShell 查命令行，避免误杀别的 powershell。
 */
function killStrayWindows(log = () => {}) {
  if (process.platform !== 'win32') return
  try {
    const ps = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'
    const cmd = "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -match 'ptt-window\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    spawnSync(ps, ['-NoProfile', '-Command', cmd], { windowsHide: true, timeout: 8000 })
    log('[dsh-playmate/ptt] 清理残留浮窗')
  } catch {
    /* 清不掉不影响主流程 */
  }
}

export function createPttWindow({ rootDir, log = () => {} }) {
  const script = join(rootDir, 'lib', 'ptt', 'ptt-window.ps1')
  /** 和引擎读的是同一个控制文件 */
  const ctl = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'playmate-ptt.ctl')
  let child = null

  const alive = () => child !== null && child.exitCode === null && child.killed === false

  function stop(reason = '手动') {
    // 除了自己拉的那个，也顺手清掉"野"浮窗（手动起的、上次没退干净的）。
    // 只停自己那个的话，切到「一直听」时窗口还挂在那儿（2026-11-04 的现象）。
    killStrayWindows(log)

    if (!alive()) {
      child = null
      return false
    }
    try {
      child.kill()
      log(`[dsh-playmate/ptt] 浮窗已关（${reason}）`)
    } catch {
      /* 已经没了 */
    }
    child = null
    return true
  }

  function start(base, showPill = false) {
    if (process.platform !== 'win32') return { ok: false, error: 'only-windows' }
    if (!existsSync(script)) return { ok: false, error: 'ptt-window.ps1 不在' }
    if (alive()) return { ok: true, already: true }
    const ps = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'
    try {
      child = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Ctl', ctl, '-Pill', showPill ? '1' : '0', '-Base', String(base || 'http://127.0.0.1:3080')], {
        cwd: rootDir,
        windowsHide: true,
        stdio: 'ignore',
        detached: false,
      })
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) }
    }
    child.on('exit', (code) => {
      log(`[dsh-playmate/ptt] 浮窗退出 code=${code}`)
      child = null
    })
    log(`[dsh-playmate/ptt] 浮窗已开（pid=${child?.pid ?? '?'}）`)
    return { ok: true, pid: child?.pid ?? null }
  }

  return { start, stop, alive }
}
