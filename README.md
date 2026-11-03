# dsh-playmate（陪玩）

给 DeepSeek Harness 用的陪玩插件：**看屏幕 / 听你说话 / 把回答念出来**。三个模块，全部开关式，默认全关。

仓库：<https://github.com/ZiFeng11/dsh-playmate> · 许可证 MIT · 当前版本 0.1.0

> **本插件不附带任何声音模型，也不附带任何参考音频。**
> 「念出来」默认不可用——想让它说话，请自己准备 3–10 秒参考音，用 GPT-SoVITS / IndexTTS 之类自己克隆，
> 然后把服务地址填进 `ttsUrl`。本插件不提供参考音，也不建议使用他人的声音。

---

## 项目定位

这是一个**个人作品**，不是商业产品：

- **不承诺长期维护**。DSH 升级后插件可能失效（宿主 API 变过好几次），失效请提 issue，不保证及时修
- **不接定制需求**，不加云端依赖，不收集任何数据
- 代码量不大（约 2,600 行），够用就好

## 它不做什么

| 不做 | 说明 |
|---|---|
| 不上传屏幕/录音 | 抓帧、识别全在本机；只有"把图交给当前会话"这一步会走 DSH 自己的模型请求 |
| 不留录像 | 抓帧写到临时目录，用完即删；不存放历史截图 |
| 不操作你的鼠标键盘 | 只看、只听、只说 |
| 不附带声音 | 没有任何模型权重与参考音频；「念出来」要你自己接 TTS |
| 不联网下载模型以外的东西 | 识别模型由 FunASR 下载到本地缓存，之后离线可用 |
| 不静默改配置 | 配置越界一律返回 400，不会悄悄改成边界值 |

---

## 三个模块

| 模块 | 干什么 | 依赖 | 默认 |
|---|---|---|---|
| **看**（see） | 抓屏 → 按变化挑帧 → 拼一张图给模型；或后台自动发现画面变化并主动送帧 | `ffmpeg` | 关 |
| **说**（talk） | 热键/常听 → 本地识别 → 文字注入会话 | `python` + 麦克风 + FunASR | 关 |
| **听**（hear） | 回答开头一段 → 你的 TTS 服务 → 念出来 | 你自己的 TTS 服务 | 关（未接线） |

> **「念出来」设计上就是外部服务。** 插件不内嵌、不托管、不下载任何 TTS 模型——
> 它只把文字 POST 到你填的地址。用什么引擎、用什么声音，完全由使用者自己决定。

三个模块互不依赖，可以只开一个。关着的模块不会抓屏、不会录音、不会出声。

### 花多少

- **看**：静止屏幕 1 帧 ≈ **233 token**；9 帧拼图 ≈ 2,100。自动模式下静止屏**不投递**，等于 0。
- **说**：本地识别，**0 token**，只花 CPU/显存（SenseVoiceSmall ≈ 1.1 GB）。
- **听**：本地合成，**0 token**，显存看你的 TTS（GPT-SoVITS ≈ 1.6 GB）。
- **真正贵的是"唤醒"**：自动看屏幕每投递一次就唤醒一轮对话（要重读上下文），所以有「多主动」三档。

---

## 安装

```bash
git clone https://github.com/ZiFeng11/dsh-playmate
```

1. 把仓库放进 DSH 的 profile：`<profile>/node_modules/dsh-playmate`
   （Windows 上用目录联接 `mklink /J` 更好：改代码立刻生效）
2. 在 `<profile>/cordis.patch.yml` 末尾加：

```yaml
- insert:
  - id: playmate
    name: dsh-playmate
    config: {}
```

3. 重启 DSH。设置左侧栏会多一项「陪玩」。

### 依赖

- **ffmpeg**：看屏幕必需。放 PATH 里，或在设置里填绝对路径。
- **python**：听我说话必需，且要能 `import numpy, sounddevice`（推荐用带 torch/funasr 的虚拟环境）。设置里填绝对路径最稳。
- **TTS**：念出来必需，自己准备；插件只认一个 HTTP 地址。

装完打开 `设置 → 陪玩 → 环境自检 → 检查环境`，四项全绿就可以用了。

---

## 配置

配置存在 `$DSH_HOME/playmate.json`（默认 `~/.dsh/playmate.json`），设置页也能改。

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `see` | bool | `false` | 看屏幕总开关 |
| `seeMode` | `manual` \| `auto` | `manual` | 手动=模型需要时才看；自动=画面变化就送一帧 |
| `seeEvery` | 1–60 | `3` | 自动模式抓帧间隔（秒） |
| `seePace` | `quiet` \| `normal` \| `dense` | `quiet` | 多主动：3 分钟 / 1 分钟 / 15 秒 |
| `seeDiff` | 0.2–20 | `2` | 手动模式挑帧的变化阈值 |
| `seeAutoDiff` | 1–60 | `8` | 自动模式的变化阈值（档位会覆盖它） |
| `seeMinGapSec` | 3–120 | `15` | 两次投递最短间隔（档位会覆盖它） |
| `ffmpegPath` | string | `''` | 留空走 PATH |
| `workDir` | string | `''` | 抓帧临时目录；留空用系统临时目录 |
| `talk` | bool | `false` | 听我说话总开关 |
| `talkMode` | `ptt` \| `always` | `ptt` | 热键 / 一直听 |
| `pythonPath` | string | `''` | 跑识别引擎的 python（建议绝对路径） |
| `asrModel` | string | `iic/SenseVoiceSmall` | 识别模型，可换更大的 |
| `vadThreshold` | 0.002–0.2 | `0.012` | 一直听模式的灵敏度（自动校准会覆盖） |
| `silenceMs` | 200–3000 | `700` | 静音多久算一句说完 |
| `showPill` | `true` \| `false` | `false` | 录音时是否显示右下角小条（默认不显示） |
| `hear` | bool | `false` | 念出来总开关 |
| `ttsUrl` | string | `''` | 你的 TTS 服务，例如 `http://127.0.0.1:PORT/say`；留空=未接线 |
| `speakChars` | 10–600 | `80` | 念回答开头的多少字符 |
| `targetMode` | `auto` \| `fixed` | `auto` | 语音送进哪个会话：跟随最近活动 / 固定 |
| `targetSessionId` | string | `''` | `fixed` 时用的会话 id（设置页下拉里选） |

TTS 服务需要接受 `POST {text}`；如果你的服务另有 `/health`，环境自检会用它探活。

---

## 接口

全部只接受回环地址。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/playmate/` | 设置页（HTML） |
| GET | `/api/playmate/status` | 开关与模块就绪状态 |
| POST | `/api/playmate/toggle` | `{key:"see"\|"talk"\|"hear", on:bool}` |
| GET/POST | `/api/playmate/config` | 读写配置（越界返回 400，不静默改） |
| GET | `/api/playmate/agents` | 活着的会话（带可读名字） |
| GET | `/api/playmate/diag` | 环境自检 |
| GET | `/api/playmate/ear` | 语音引擎状态 |
| GET | `/api/playmate/watch` | 自动看屏幕状态（frames / delivered / lastScore） |
| POST | `/api/playmate/heard` | 识别引擎把文字交进来 |
| POST | `/api/playmate/ptt` | `{state:"start"\|"stop"}`（给浮窗/调试用） |

---

## 识别精度（重要，请先读）

默认识别模型是 **`iic/SenseVoiceSmall`**：

- **优点**：快（0.2–0.7 秒/句）、显存约 1.1 GB
- **缺点**：**长句里的同音字会错**。实测例子：「测试这次发完之后会不会再录下一段」→「测试这次发文湖北再录下一段」；单字人名尤其容易错

**这不是链路坏掉**：音频是完整的（日志里有分段电平），只是转文字这一步不完美。

### 想更准，三选一

| 方案 | 做法 | 代价 |
|---|---|---|
| **换 Paraformer-large**（推荐） | `asrModel` 改成 `iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`，首次会下载约 1 GB | 显存 +1 GB，速度 0.3 → 0.5 秒 |
| **加热词** | 取决于你换的模型是否支持热词偏置 | 几乎为零，只对特定词有效 |
| **换 Whisper large-v3** | 需另装 faster-whisper，中文不如 Paraformer | 显存 +2 GB，速度 1–3 秒 |

改完把「听我说话」关一下再打开，引擎才会按新模型重启。

### 为什么不做"定制纠错表"

有人会想把自己 AI 的名字写死成纠错。**不建议**——插件是给别人用的，别人的 AI 不叫那个名字。要做也只能做成配置项、默认关。

---

## 语音输入是怎么进来的

1. 热键 `Ctrl+Alt+V` 或「一直听」→ 录音（**只在录音时占用麦克风**）
2. 说完停住 → 安静约 1 秒 → 自动结束（不用按第二次）
3. 本地识别 → `POST /api/playmate/heard` → 注入指定/最近的会话
4. 会话里是一条普通用户消息（当前不带「这是语音」之类的标记）

想固定"语音只进某个会话"：`设置 → 语音送到哪个会话 → 固定（防串台）`。名字取自 DSH 侧边栏的会话标题。

> 为什么热键是「按一下开始」而不是「按住」：全局键盘钩子在某些受限环境里装不上（`SetWindowsHookEx` 直接失败）。
> 插件用 `RegisterHotKey`（系统级热键，不需要钩子），而它只通知"按下"、不通知"松开"，
> 所以设计成「按一下开始 / 说完自动停」。

---

## 看屏幕的两种方式

| 方式 | 触发 | 花多少 |
|---|---|---|
| **手动**（默认） | 模型觉得需要时自己调 `play_see` | 一张 233 token 起 |
| **自动** | 后台定时抓一帧，**画面变化够大**才把这一帧送进会话 | 只有变化时才花，静止 0 |

**多主动**（三档，默认安静）：

| 档位 | 最短间隔 | 变化门槛 | 适合 |
|---|---|---|---|
| 安静（默认） | 3 分钟 | 12 | 干活、看视频 |
| 正常 | 1 分钟 | 9 | 打游戏 |
| 热闹 | 15 秒 | 6 | 演示（很吵也很费） |

> 每次投递都会**唤醒一轮**对话，所以真正贵的是"叫醒"，不是那张图。

自动模式交付的是一条**用户消息**（带图 + 一句「画面有变化」），模型不需要自己调工具——
这样不会出现"它以为还得再看一眼"的死循环。

---

## 目录

```
index.js              插件入口：路由、配置、三个模块的挂载
lib/client.js         设置页（settings.section，手写 React，无构建步骤）
lib/see-engine.mjs    抓帧 / 灰度评分 / 拼图
lib/see-tool.mjs      play_see 工具契约（output.schema 有方言要求，见注释）
lib/watch.mjs         自动看屏幕：定时抓帧 + 变化判断 + 投递
lib/ear.mjs           语音引擎管理器（拉起/停止 ear.py、注入会话）
lib/asr/ear.py        录音 + 识别（sounddevice + FunASR）
lib/ptt-window.mjs    热键浮窗管理器
lib/ptt/ptt-window.ps1  热键窗口（RegisterHotKey + MOD_NOREPEAT）
lib/hear.mjs          念出来：清洗文本 + 交给 ttsUrl
lib/session-label.mjs 会话名（读 DSH 的 session_projcache）
smoke.mjs             离线冒烟（假 ctx，检查路由与开关）
test-see.mjs          看屏幕工具的离线测试（真抓屏）
tools/try-schema.mjs  用宿主自己的校验器验证工具 schema，免得改一版重启一次
```

---

## 已知问题

- 长句同音字（见「识别精度」）
- 受限环境下装不上键盘钩子 → 热键只能"按一下开始"
- 自动看屏幕依赖 `attachments` 服务；没在 inject 里声明会直接抛错（当前代码已声明）
- 同时开两个 profile 注册本插件会导致两个实例（两个看屏幕循环、两个语音引擎）——只注册一个 profile

## 开发笔记

- 工具的 `output.schema` 在这个宿主版本里有方言限制：`required` 只能出现在 object 上、value-schema DSL 里连顶层都不许写；`items.type` 没有 `json`。改完跑 `node tools/try-schema.mjs`。
- 宿主里没在 `inject` 声明过的服务，**读属性就会抛错**（`?.` 挡不住）。
- PowerShell 5.1 写文件默认带 BOM：控制文件必须用 `UTF8Encoding($false)`；脚本自身要带 BOM 才能正确读中文。

## License

MIT

## 常见问题

**「看屏幕」报错 ffmpeg 找不到**
装 ffmpeg 并加进 PATH，或在设置里把 `ffmpegPath` 填成绝对路径。装完点「环境自检」确认变成 ✅。

**「听我说话」引擎起不来**
多半是 python 不对：需要能 `import numpy, sounddevice` 的解释器（推荐带 torch/funasr 的虚拟环境）。
在设置里把 `pythonPath` 填成那个 python 的**绝对路径**，再点「环境自检」。

**麦克风图标一直亮**
「一直听」模式本来就长期占用麦克风（它要一直听）。切到「按住说话」模式后，只在录音那几秒占用。

**按热键没反应**
1) 浮窗进程可能没起来（看 `~/.dsh/playmate-ptt-window.log` 有没有 `注册 Ctrl+Alt+V => True`）
2) 热键被别的软件占了，改 `lib/ptt/ptt-window.ps1` 里的 `$Vk` / `$Mods` 重新注册

**自动看屏幕太吵 / 太费**
把「多主动」切到「安静」，或把 `seeMode` 改回 `manual`（只有模型需要时才看）。

**识别总错同音字**
见上面「识别精度」——换更大的模型。

## 反馈

提 issue 时请附上：

1. 系统版本 + DSH 版本
2. `设置 → 陪玩 → 环境自检` 的结果（截图或文字）
3. 插件日志：`<DSH_HOME>/playmate-plugin.log`、`<临时目录>/dsh-playmate/ear.log`
