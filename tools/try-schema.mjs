/**
 * 用宿主自己的校验器试 schema，省掉"改一版重启一次"的来回。
 * 跑法：node tools/try-schema.mjs
 */
const HOST = 'C:/Users/紫枫/AppData/Local/DSH Tauri/resources/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
const mod = await import('file:///' + HOST)
const { assertSupportedJsonSchema } = mod
console.log('可用导出里有 assertSupportedJsonSchema:', typeof assertSupportedJsonSchema === 'function')

const candidates = {
  A: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: { type: 'string' },
      images: { type: 'array', items: { type: 'object', additionalProperties: true } },
      meta: { type: 'object', additionalProperties: true },
    },
  },
  B: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string' },
      images: { type: 'array', items: { type: 'object' } },
      meta: { type: 'object' },
    },
  },
  C: {
    type: 'object',
    additionalProperties: true,
    properties: {
      text: { type: 'string' },
      images: { type: 'array', items: { type: 'object' } },
      meta: { type: 'object' },
    },
  },
}

for (const [name, schema] of Object.entries(candidates)) {
  try {
    assertSupportedJsonSchema(schema)
    console.log(`${name}: PASS`)
  } catch (e) {
    console.log(`${name}: FAIL ${e.message}`)
  }
}

// 顺便验一下参数表（value schema map 形态）
const params = {
  seconds: { type: 'number', description: 'x' },
  max_frames: { type: 'number', description: 'y' },
}
try {
  assertSupportedJsonSchema({ type: 'object', properties: params, additionalProperties: false })
  console.log('parameters: PASS（包成 object 后）')
} catch (e) {
  console.log('parameters: FAIL', e.message)
}
