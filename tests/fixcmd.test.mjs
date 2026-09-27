import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBashStyleMultiLine, toCmdCompat } from '../dist-electron/fixcmd.js'

const grafana = [
  "curl -s -u 'admin:pass' 'http://127.0.0.1:1/api/datasources/2' \\",
  "  -H 'x-plugin-id: mysql' \\",
  "  --data-raw '{\"rawSql\":\"SELECT 1\"}'",
].join('\n')

test('检测：行尾续行符的多行 bash 命令', () => {
  assert.equal(isBashStyleMultiLine(grafana), true)
})

test('检测：单引号体内跨行的 JSON（无行尾续行符）', () => {
  const multi = "curl -s 'http://x/api' --data-raw '{\n  \"k\": \"v\"\n}'"
  assert.equal(isBashStyleMultiLine(multi), true)
})

test('检测：单行命令不误报', () => {
  assert.equal(isBashStyleMultiLine('curl "http://x/" -H "a: b"'), false)
})

test('检测：纯 CMD 多行（无 bash 特征）不误报', () => {
  const cmd = 'echo a\necho b'
  assert.equal(isBashStyleMultiLine(cmd), false)
})

test('转换：Grafana curl → CMD 兼容单行', () => {
  const { text, strayQuote } = toCmdCompat(grafana)
  assert.equal(text.includes('\n'), false)
  assert.equal(text.includes("'"), false)
  assert.equal(strayQuote, false)
  assert.ok(text.includes('--data-raw "{\\"rawSql\\":\\"SELECT 1\\"}"'))
})

test('转换：多行 JSON 单引号体折叠为合法单行', () => {
  const multi = "curl -s 'http://x/api' --data-raw '{\n  \"k\": \"v\"\n}'"
  const { text, strayQuote } = toCmdCompat(multi)
  assert.equal(text.includes('\n'), false)
  assert.equal(strayQuote, false)
  assert.ok(text.includes('{ \\"k\\": \\"v\\" }') || text.includes('{\\"k\\": \\"v\\"}') || text.includes('{ \\"k\\"'), text)
})

test('转换：奇数个单引号不强行配对并如实标记', () => {
  const { strayQuote } = toCmdCompat("echo it's ok 'http://x'")
  assert.equal(strayQuote, true)
})
