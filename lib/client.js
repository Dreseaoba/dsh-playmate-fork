// DSH 陪玩 · 客户端半边（设置左侧栏一项「陪玩」）
window.__ModuleLoader__.load({
  id: 'dsh-playmate',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']
    const B = '/api/playmate'

    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json())
    const post = (p, body) =>
      fetch(B + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then((r) => r.json())

    const S = {
      wrap: { padding: '4px 2px', fontSize: 13, lineHeight: 1.7 },
      h: { fontWeight: 600, margin: '14px 0 6px' },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        border: '1px solid rgba(127,142,163,.25)',
        borderRadius: 10,
        marginBottom: 8,
      },
      meta: { flex: 1, minWidth: 0 },
      label: { fontSize: 14 },
      hint: { fontSize: 12, opacity: 0.65, marginTop: 2 },
      btn: {
        minWidth: 62,
        padding: '5px 12px',
        borderRadius: 999,
        border: '1px solid rgba(127,142,163,.45)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
      },
      btnOn: { background: '#1f6feb', borderColor: '#2f7ff5', color: '#fff' },
      dim: { fontSize: 12, opacity: 0.6 },
      input: {
        marginTop: 4,
        padding: '5px 8px',
        borderRadius: 8,
        border: '1px solid rgba(127,142,163,.45)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 13,
      },
      warn: { fontSize: 12, color: '#d97706', marginTop: 6, whiteSpace: 'pre-line' },
    }

    function Section() {
      const [state, setState] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [cfg, setCfg] = React.useState(null)
      const [fields, setFields] = React.useState(null)
      const [draft, setDraft] = React.useState({})
      const [cfgNote, setCfgNote] = React.useState('')
      const [diag, setDiag] = React.useState(null)
      const [diagBusy, setDiagBusy] = React.useState(false)

      const load = React.useCallback(() => {
        get('/status')
          .then((j) => {
            if (j && j.ok) setState(j)
            else setErr('读状态失败：' + JSON.stringify(j))
          })
          .catch((e) => setErr('读状态失败：' + String(e && e.message ? e.message : e)))
      }, [])

      const [agents, setAgents] = React.useState([])
      const loadAgents = React.useCallback(() => {
        get('/agents').then((j) => { if (j && j.ok) setAgents(j.agents || []) }).catch(() => {})
      }, [])

      const loadCfg = React.useCallback(() => {
        get('/config')
          .then((j) => {
            if (j && j.ok) {
              setCfg(j.config || {})
              setFields(j.fields || {})
              setDraft({})
            }
          })
          .catch(() => {})
      }, [])

      React.useEffect(() => {
        load()
        loadCfg()
        loadAgents()
      }, [load, loadCfg, loadAgents])

      const runDiag = () => {
        setDiagBusy(true)
        get('/diag')
          .then((j) => setDiag(j && j.ok ? j.checks || [] : []))
          .catch(() => setDiag([]))
          .finally(() => setDiagBusy(false))
      }

      const saveCfgKey = (key, value) => {
        post('/config', { [key]: value })
          .then((j) => {
            if (!j || !j.ok) setCfgNote('保存失败：' + JSON.stringify(j))
            else { setCfgNote('已切到：' + key + '=' + value); loadCfg() }
          })
          .catch((e) => setCfgNote('请求失败：' + String(e)))
      }

      const saveCfg = () => {
        if (Object.keys(draft).length === 0) {
          setCfgNote('没有改动')
          return
        }
        post('/config', draft)
          .then((j) => {
            if (!j || !j.ok) {
              setCfgNote('保存失败：' + (j && (j.error || '') ) + (j && j.min !== undefined ? `（范围 ${j.min}–${j.max}）` : ''))
            } else {
              setCfgNote('已保存：' + (j.changed || []).join(', '))
              loadCfg()
            }
          })
          .catch((e) => setCfgNote('请求失败：' + String(e)))
      }

      const ptt = (action) => {
        post('/ptt', { state: action })
          .then((j) => { if (!j || !j.ok) setErr('按住说话没通：' + JSON.stringify(j)) })
          .catch((e) => setErr('按住说话请求失败：' + String(e)))
      }

      const toggle = (key, on) => {
        setBusy(key)
        post('/toggle', { key, on })
          .then((j) => {
            if (!j || !j.ok) {
              setErr(
                (j && j.error === 'not-wired' ? '还没接线：' : '打开失败：') +
                  (j && j.hint ? j.hint : JSON.stringify(j)),
              )
            } else {
              setErr('')
            }
            load()
          })
          .catch((e) => setErr('请求失败：' + String(e)))
          .finally(() => setBusy(''))
      }

      if (!state) {
        return React.createElement('div', { style: S.wrap }, err || '读状态中…')
      }

      const mods = state.modules || {}
      const order = ['see', 'talk', 'hear']
      const rows = order
        .filter((k) => mods[k])
        .map((k) => {
          const m = mods[k]
          const on = m.on === true
          const disabled = busy !== '' || (m.ready === false && !on)
          return React.createElement(
            'div',
            { key: k, style: S.row },
            React.createElement(
              'div',
              { style: S.meta },
              React.createElement('div', { style: S.label }, m.label),
              m.ready === false ? React.createElement('div', { style: S.hint }, m.hint) : null,
            ),
            React.createElement(
              'button',
              {
                style: Object.assign({}, S.btn, on ? S.btnOn : null, disabled ? { opacity: 0.5 } : null),
                disabled,
                onClick: () => {
                  if (m.ready === false && !on) {
                    setErr('还没接线：' + m.hint)
                    return
                  }
                  toggle(k, !on)
                },
              },
              busy === k ? '…' : on ? '开' : '关',
            ),
          )
        })

      return React.createElement(
        'div',
        { style: S.wrap },
        React.createElement(
          'div',
          { style: S.dim },
          '三个开关默认全关。关着的模块不会抓屏、不会录音、不会出声。',
        ),
        React.createElement('div', { style: { marginTop: 10 } }, rows),
        err ? React.createElement('div', { style: S.warn }, err) : null,
        React.createElement(
          'div',
          { style: { marginTop: 10, padding: '10px 12px', border: '1px solid rgba(127,142,163,.25)', borderRadius: 10 } },
          React.createElement('div', { style: { fontSize: 13, marginBottom: 6 } }, '看屏幕的方式'),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 14, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement(
              'label',
              { style: { cursor: 'pointer' } },
              React.createElement('input', {
                type: 'radio',
                name: 'playmate-see-mode',
                checked: !cfg || cfg.seeMode !== 'auto',
                onChange: () => saveCfgKey('seeMode', 'manual'),
              }),
              ' 手动（需要时才看）',
            ),
            React.createElement(
              'label',
              { style: { cursor: 'pointer' } },
              React.createElement('input', {
                type: 'radio',
                name: 'playmate-see-mode',
                checked: cfg && cfg.seeMode === 'auto',
                onChange: () => saveCfgKey('seeMode', 'auto'),
              }),
              ' 自动（画面变了就送一帧过来）',
            ),
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 12, fontSize: 13, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 } },
            React.createElement('span', { style: S.dim }, '多主动：'),
            [['quiet', '安静（3 分钟）'], ['normal', '正常（1 分钟）'], ['dense', '热闹（15 秒）']].map(([k, label]) =>
              React.createElement(
                'label',
                { key: k, style: { cursor: 'pointer' } },
                React.createElement('input', {
                  type: 'radio',
                  name: 'playmate-see-pace',
                  checked: (cfg && cfg.seePace === k) || (!cfg && k === 'quiet'),
                  onChange: () => saveCfgKey('seePace', k),
                }),
                ' ' + label,
              ),
            ),
          ),
          React.createElement('div', { style: S.hint }, '自动模式下静止屏幕不消耗额度；画面有变化才送出一帧，并按档位限制主动频率'),
        ),
        React.createElement(
          'div',
          { style: { marginTop: 10, padding: '10px 12px', border: '1px solid rgba(127,142,163,.25)', borderRadius: 10 } },
          React.createElement('div', { style: { fontSize: 13, marginBottom: 6 } }, '语音送到哪个会话'),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 14, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement(
              'label',
              { style: { cursor: 'pointer' } },
              React.createElement('input', {
                type: 'radio',
                name: 'playmate-target-mode',
                checked: !cfg || cfg.targetMode !== 'fixed',
                onChange: () => saveCfgKey('targetMode', 'auto'),
              }),
              ' 跟随最近活动的会话',
            ),
            React.createElement(
              'label',
              { style: { cursor: 'pointer' } },
              React.createElement('input', {
                type: 'radio',
                name: 'playmate-target-mode',
                checked: cfg && cfg.targetMode === 'fixed',
                onChange: () => saveCfgKey('targetMode', 'fixed'),
              }),
              ' 固定（防串台）',
            ),
          ),
          React.createElement(
            'div',
            { style: { marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement(
              'select',
              {
                style: Object.assign({}, S.input, { minWidth: 260, maxWidth: '100%' }),
                value: (cfg && cfg.targetSessionId) || '',
                onChange: (e) => saveCfgKey('targetSessionId', e.target.value),
              },
              React.createElement('option', { value: '' }, '（未选择 —— 请挑一个会话）'),
              agents.map((a) =>
                React.createElement(
                  'option',
                  { key: a.id, value: a.id },
                  (a.title || a.id) + ' · ' + a.status,
                ),
              ),
            ),
            React.createElement('button', { style: S.btn, onClick: loadAgents }, '刷新列表'),
          ),
          React.createElement('div', { style: S.hint }, '固定之后，麦克风只喂这一个会话——开几个窗口都不会串'),
        ),
        React.createElement(
          'div',
          { style: { marginTop: 10, padding: '10px 12px', border: '1px solid rgba(127,142,163,.25)', borderRadius: 10 } },
          React.createElement('div', { style: { fontSize: 13, marginBottom: 6 } }, '识别方式'),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: 14, fontSize: 13, alignItems: 'center' } },
            React.createElement(
              'label',
              { style: { cursor: 'pointer' } },
              React.createElement('input', {
                type: 'radio',
                name: 'playmate-talk-mode',
                checked: (cfg && cfg.talkMode === 'ptt') || !cfg,
                onChange: () => saveCfgKey('talkMode', 'ptt'),
              }),
              ' 按住说话（松开才发）',
            ),
            React.createElement(
              'label',
              { style: { cursor: 'pointer' } },
              React.createElement('input', {
                type: 'radio',
                name: 'playmate-talk-mode',
                checked: cfg && cfg.talkMode === 'always',
                onChange: () => saveCfgKey('talkMode', 'always'),
              }),
              ' 一直听（说完自动发）',
            ),
          ),
          cfg && cfg.talkMode === 'ptt'
            ? React.createElement(
                'div',
                { style: { marginTop: 8 } },
                React.createElement('div', { style: { fontSize: 13 } }, '热键：Ctrl + Alt + V'),
                React.createElement(
                  'div',
                  { style: S.hint },
                  '按一下开始说话（麦克风这时才打开），说完停住约 1 秒自动发送，不用按第二次；想提前结束再按一次。',
                ),
              )
            : React.createElement('div', { style: S.hint }, '一直听：说完一句（静音约 0.7 秒）就自动发；吵的地方把灵敏度阈值调大'),
        ),
        cfg && fields
          ? React.createElement(
              'div',
              { style: { marginTop: 6 } },
              React.createElement('div', { style: S.h }, '详细配置'),
              Object.keys(fields).map((k) => {
                const f = fields[k]
                const val = draft[k] !== undefined ? draft[k] : cfg[k] === undefined ? '' : cfg[k]
                const inputProps = {
                  key: k,
                  value: val,
                  onChange: (e) => setDraft(Object.assign({}, draft, { [k]: f.kind === 'number' ? Number(e.target.value) : e.target.value })),
                  style: Object.assign({}, S.input, { width: f.kind === 'number' ? 90 : '100%', maxWidth: 320 }),
                }
                return React.createElement(
                  'div',
                  { key: k, style: { marginBottom: 8 } },
                  React.createElement('div', { style: { fontSize: 13 } }, f.label || k),
                  React.createElement('div', { style: S.hint }, f.hint || ''),
                  f.kind === 'number'
                    ? React.createElement('input', Object.assign({ type: 'number', min: f.min, max: f.max }, inputProps))
                    : React.createElement('input', Object.assign({ type: 'text', placeholder: '' }, inputProps)),
                )
              }),
              React.createElement(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 } },
                React.createElement('button', { style: S.btn, onClick: saveCfg }, '保存配置'),
                React.createElement('button', { style: S.btn, onClick: loadCfg }, '还原'),
                cfgNote ? React.createElement('span', { style: S.dim }, cfgNote) : null,
              ),
            )
          : null,
        React.createElement(
          'div',
          { style: { marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' } },
          React.createElement('button', { style: S.btn, onClick: load }, '刷新'),
          React.createElement(
            'a',
            { href: B + '/', target: '_blank', rel: 'noreferrer', style: { fontSize: 12, opacity: 0.75 } },
            '打开完整设置页',
          ),
        ),
        React.createElement(
          'div',
          { style: { marginTop: 10, padding: '10px 12px', border: '1px solid rgba(127,142,163,.25)', borderRadius: 10 } },
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            React.createElement('div', { style: { fontSize: 13 } }, '环境自检'),
            React.createElement(
              'button',
              { style: Object.assign({}, S.btn, diagBusy ? { opacity: 0.5 } : null), disabled: diagBusy, onClick: runDiag },
              diagBusy ? '检查中…' : '检查环境',
            ),
          ),
          React.createElement('div', { style: S.hint }, '检查 ffmpeg / python / TTS 服务 / 语音引擎是否就绪'),
          diag === null
            ? null
            : React.createElement(
                'div',
                { style: { marginTop: 8, fontSize: 13, lineHeight: 1.9 } },
                diag.length === 0
                  ? React.createElement('div', { style: S.warn }, '检查失败（看插件日志）')
                  : diag.map((c) =>
                      React.createElement(
                        'div',
                        { key: c.id },
                        (c.ok ? '✅ ' : '❌ ') + c.label + (c.detail ? ' —— ' + c.detail : ''),
                      ),
                    ),
              ),
        ),
        React.createElement(
          'div',
          { style: Object.assign({}, S.dim, { marginTop: 12 }) },
          '状态文件：' + (state.state && state.state.file ? state.state.file : '~/.dsh/playmate.json'),
        ),
        React.createElement(
          'div',
          { style: Object.assign({}, S.dim, { marginTop: 4 }) },
          '「念出来」不附带任何声音模型；想让它说话，要自己接一个 TTS（见 README）。',
        ),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          {
            name: 'settings.section',
            id: 'playmate',
            order: 58,
            label: () => '陪玩',
          },
          () => React.createElement(Section),
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
