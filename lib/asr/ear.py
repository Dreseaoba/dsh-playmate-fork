"""ear.py —— 陪玩的「耳朵」：常驻听麦，说完一句就把文字交给宿主。

两种模式：
  always  一直听：能量 VAD 判断"有人在说"，说完（静音 0.7 秒）就识别、发送
  ptt     按住说：宿主写一个控制文件（start/stop），stop 时识别刚录的那段

为什么不用全局热键：宿主沙箱里的进程读不到键盘（GetAsyncKeyState 恒为 0、
SetWindowsHookEx 直接失败、keyboard 库也收不到）——热键这条路在这里走不通。
所以 ptt 模式的"按住"由界面上的按钮驱动，控制文件是它的信号通道。

用法（由插件拉起，也可手动调试）：
  python ear.py --mode always --host http://127.0.0.1:3080
  python ear.py --mode ptt --ctl D:/path/ptt.ctl --host http://127.0.0.1:3080
"""
import argparse
import json
import os
import pathlib
import re
import sys
import time
import urllib.request
import wave

os.environ.setdefault("PYTHONUTF8", "1")
# 模型缓存/临时目录都用系统默认。要换位置请在外部设 MODELSCOPE_CACHE / TMPDIR，
# 不要写死机器相关的路径 —— 这个文件是要发出去的。


import numpy as np  # noqa: E402
import sounddevice as sd  # noqa: E402

SR = 16000
BLOCK = 0.1
TAG_RE = re.compile(r"<\|[^|]+\|>")

import tempfile

_LOG_DIR = pathlib.Path(tempfile.gettempdir()) / "dsh-playmate"
LOG_PATH = pathlib.Path(os.environ.get("PLAY_EAR_LOG", str(_LOG_DIR / "ear.log")))


def log(msg):
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")
    except Exception:
        pass


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))) + 1e-9)


class Ear:
    def __init__(self, mode, host, ctl, threshold, silence_ms, max_sec, model="iic/SenseVoiceSmall"):
        self.model_name = model
        self.mode = mode
        self.host = host.rstrip("/")
        self.ctl = pathlib.Path(ctl) if ctl else None
        self.threshold = threshold
        self.silence_blocks = max(1, int(silence_ms / 1000 / BLOCK))
        self.max_blocks = int(max_sec / BLOCK)
        self.model = None

    def load(self):
        from funasr import AutoModel

        # 优先用本地已下载的模型目录：写 repo id 会让它每次启动都去远端核对 20 个文件
        # （实测多花 27 秒，网络差的时候更久）。本地目录存在就直接用。
        # 用 repo id 让 funasr 走它自己的缓存解析（直接用本地目录会缺 configuration.json
        # 之类的东西，实测会报 "No module named 'funasr.models.decoder'"）。
        # 想强制换模型就用 PLAY_ASR_MODEL。
        target = self.model_name or os.environ.get("PLAY_ASR_MODEL", "") or "iic/SenseVoiceSmall"
        t0 = time.time()
        self.model = AutoModel(model=target, disable_update=True, device="cuda")
        log(f"模型来源：{target}")
        log(f"识别模型就绪（{time.time() - t0:.1f}s；模式={self.mode}；阈值={self.threshold}）")

    def asr(self, audio):
        import tempfile
        # 留一份最后一段录音，方便查"为什么只认出尾巴"
        try:
            keep = pathlib.Path(os.environ.get("PLAY_EAR_SAMPLE", str(_LOG_DIR / "last_ptt.wav")))
            keep.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(keep), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(SR)
                w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
            seg = 10
            per = max(1, len(audio) // seg)
            levels = [float(np.sqrt(np.mean(np.square(audio[i:i+per])))) for i in range(0, len(audio)-per+1, per)]
            log("分段电平: " + " ".join(f"{x:.3f}" for x in levels[:12]))
        except Exception as e:
            log(f"存样本失败：{e}")

        tmp = pathlib.Path(tempfile.gettempdir()) / f"ear-{int(time.time() * 1000)}.wav"
        with wave.open(str(tmp), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        t = time.time()
        try:
            r = self.model.generate(input=str(tmp), language="zh", use_itn=True)
            text = TAG_RE.sub("", (r[0]["text"] if r else "")).strip()
        finally:
            try:
                tmp.unlink()
            except Exception:
                pass
        log(f"识别 {time.time() - t:.2f}s -> {text!r}")
        return text

    def send(self, text):
        if not text:
            return
        body = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.host + "/api/playmate/heard", data=body,
                                     headers={"Content-Type": "application/json; charset=utf-8"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                log(f"发送 -> {r.read().decode('utf-8', 'ignore')[:120]}")
        except Exception as e:
            log(f"发送失败：{e}")

    @staticmethod
    def meaningful(text):
        """只有标点/空白的结果不算话（实测：一声杂音会被识别成 '。'）。"""
        return re.search(r"[0-9A-Za-z一-鿿]", text or "") is not None

    def transcribe_and_send(self, buf):
        if len(buf) * BLOCK < 0.45:
            log(f"太短（{len(buf) * BLOCK:.2f}s），丢掉")
            return
        audio = np.concatenate(buf) if buf else np.zeros(0)
        text = self.asr(audio)
        if not self.meaningful(text):
            log(f"没有实际内容（{text!r}），不发送")
            return
        self.send(text)

    # ---- 常驻听 ----
    def run_always(self):
        log("=== 开始常听（说完自动发送） ===")
        buf, speaking, quiet, voiced = [], False, 0, 0
        peak, last_report = 0.0, time.time()
        with sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=int(SR * BLOCK)) as stream:
            # 先量 1.5 秒环境底噪，自动定阈值。
            # 固定阈值在不同麦克风上差别太大 —— 这台机器上 0.012 高到听不见人说话。
            floor = []
            for _ in range(15):
                blk, _ = stream.read(int(SR * BLOCK))
                floor.append(rms(blk[:, 0]))
            # 用 20 分位而不是中位数：中位数容易被"校准那两秒正好在说话/有风扇"带高，
            # 阈值一高，人说话都过不去（实测踩过：底噪量成 0.0185 → 阈值 0.048，
            # 而说话峰值只有 0.0436，永远触发不了）。
            noise = float(np.percentile(floor, 20)) if floor else 0.0
            threshold = max(0.006, min(0.03, noise * 1.6))
            self.threshold = threshold
            log(f"底噪 {noise:.4f} → 自动阈值 {threshold:.4f}")

            while True:
                block, _ = stream.read(int(SR * BLOCK))
                mono = block[:, 0].copy()
                level = rms(mono)
                peak = max(peak, level)
                if time.time() - last_report > 10:
                    log(f"电平峰值 {peak:.4f}（阈值 {threshold:.4f}）")
                    peak, last_report = 0.0, time.time()

                loud = level >= threshold
                if not speaking:
                    # 连续两拍够响才算"开口"：单拍也可能是咔哒声
                    if loud:
                        voiced += 1
                        if voiced >= 2:
                            speaking, buf, quiet = True, [mono], 0
                            log(f"听到说话（{level:.3f}）")
                    else:
                        voiced = 0
                    continue
                # 已经在说话：攒帧，静音够了就收尾
                buf.append(mono)
                quiet = 0 if loud else quiet + 1
                if quiet >= self.silence_blocks or len(buf) >= self.max_blocks:
                    log(f"一句结束（{len(buf) * BLOCK:.1f}s）")
                    self.transcribe_and_send(buf)
                    speaking, buf, quiet, voiced = False, [], 0, 0

    # ---- 按住说 ----
    def run_ptt(self):
        """热键模式：**只在录音时打开麦克风**，说完立刻关掉。

        为什么要这样：常听模式可以一直占着麦克风，但热键模式绝大多数时间是闲着的，
        一直占着会让系统的"麦克风正在使用"图标一直亮、也让用户不放心。
        打开/关闭 InputStream 的代价约 100–300 毫秒，可以接受。
        """
        log(f"=== 热键模式：按一下开始，说完安静约 1 秒自动发送（空闲时不占麦克风） ===")
        last = ""
        while True:
            cmd = ""
            try:
                if self.ctl and self.ctl.exists():
                    cmd = self.ctl.read_text(encoding="utf-8").strip().lstrip("﻿").strip()
            except Exception:
                cmd = ""
            if cmd == last or not cmd.startswith("start"):
                time.sleep(0.05)
                continue
            last = cmd
            log("按下：打开麦克风开始录")
            buf, speech_seen, quiet = [], False, 0
            threshold = 0.02
            done = False
            try:
                with sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=int(SR * BLOCK)) as stream:
                    # 先量一小段底噪（0.5 秒）定门槛，再开始正式录
                    floor = []
                    for _ in range(5):
                        blk, _ = stream.read(int(SR * BLOCK))
                        floor.append(rms(blk[:, 0]))
                    noise = float(np.percentile(floor, 20)) if floor else 0.0
                    threshold = max(0.006, min(0.03, noise * 1.6))
                    log(f"底噪 {noise:.4f} → 讲话门槛 {threshold:.4f}")
                    while not done:
                        blk, _ = stream.read(int(SR * BLOCK))
                        mono = blk[:, 0].copy()
                        buf.append(mono)
                        level = rms(mono)
                        if level >= threshold * 1.4:
                            speech_seen = True
                            quiet = 0
                        elif speech_seen:
                            quiet += 1
                            if quiet >= int(1.0 / BLOCK):
                                done = True
                        # 手写 stop 也立刻收尾
                        try:
                            if self.ctl.exists() and self.ctl.read_text(encoding="utf-8").strip().lstrip("﻿").strip() == "stop":
                                done = True
                        except Exception:
                            pass
                        if len(buf) >= self.max_blocks:
                            done = True
                    # 收尾缓冲：别切掉最后一个字（必须在 with 里面，麦克风还没关）
                    for _ in range(3):
                        try:
                            tail, _ = stream.read(int(SR * BLOCK))
                            buf.append(tail[:, 0].copy())
                        except Exception:
                            break
            except Exception as e:
                log(f"录音出错：{e}")
                continue
            if not speech_seen:
                log("只录到底噪，没有讲话，丢掉")
                continue
            log(f"结束：{len(buf) * BLOCK:.1f}s，开始识别")
            self.transcribe_and_send(buf)


def claim_port(port=7872):
    """单实例：抢一个本地端口。抢不到说明已经有引擎在跑，本进程直接退出。
    插件可能被两个 profile 各加载一次（注册两遍），多个引擎同时开同一个麦克风，
    谁都收不全 —— 表现就是"一直听没反应"。"""
    import socket

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", port))
        sock.listen(1)
        return sock
    except OSError:
        log(f"端口 {port} 已被占用 —— 已有引擎在跑，本进程退出")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["always", "ptt"], default="always")
    ap.add_argument("--host", default="http://127.0.0.1:3080")
    ap.add_argument("--ctl", default="")
    ap.add_argument("--threshold", type=float, default=0.012)
    ap.add_argument("--silence-ms", type=int, default=700)
    ap.add_argument("--max-sec", type=float, default=15)
    ap.add_argument("--model", default=os.environ.get("PLAY_ASR_MODEL", "iic/SenseVoiceSmall"))
    a = ap.parse_args()
    holder = claim_port()
    if holder is None:
        return
    ear = Ear(a.mode, a.host, a.ctl, a.threshold, a.silence_ms, a.max_sec, a.model)
    log(f"启动 mode={a.mode} host={a.host} th={a.threshold}")
    ear.load()
    if a.mode == "ptt":
        ear.run_ptt()
    else:
        ear.run_always()


if __name__ == "__main__":
    main()
