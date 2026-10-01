import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STARTER_TEMPLATES } from '../dist-electron/templates.js'
import { validateTaskInput, previewNextRuns } from '../dist-electron/schedule.js'

test('快速开始模板：数据完整且全部通过 validateTaskInput 校验', () => {
  assert.ok(STARTER_TEMPLATES.length >= 3)
  const keys = new Set()
  for (const tpl of STARTER_TEMPLATES) {
    assert.ok(tpl.key !== '', '模板 key 非空')
    keys.add(tpl.key)
    assert.ok(tpl.title !== '' && tpl.desc !== '')
    const v = validateTaskInput(tpl.input)
    assert.equal(v.ok, true, `${tpl.key}: ${v.ok ? '' : v.error}`)
    if (v.ok) {
      assert.ok(v.value.name.length <= 60)
      assert.ok(v.value.command !== '')
    }
  }
  // key 唯一（渲染端用作 key 与 testid）
  assert.equal(keys.size, STARTER_TEMPLATES.length)
})

test('快速开始模板：每个计划都能预览出下一次执行时间', () => {
  const now = Date.now()
  for (const tpl of STARTER_TEMPLATES) {
    const next = previewNextRuns(tpl.input.schedule, now, 1)
    assert.equal(next.length, 1, `${tpl.key} 应有下一次执行时间`)
    assert.ok(next[0] > now)
  }
})

test('快速开始模板：覆盖多种执行方式与计划类型（新手引导价值）', () => {
  const runTypes = new Set(STARTER_TEMPLATES.map((t) => t.input.runType))
  const kinds = new Set(STARTER_TEMPLATES.map((t) => t.input.schedule.kind))
  assert.ok(runTypes.size >= 2, '至少覆盖 2 种执行方式')
  assert.ok(kinds.size >= 3, '至少覆盖 3 种计划类型')
})
