# 贡献指南

感谢你对 Tempo 的关注！

## 开发环境

- Node.js ≥ 20，Windows 10/11
- `npm install` 后 `npm run dev` 即可启动开发版

## 提交前

1. `npm run typecheck` 通过
2. `npm test` 全绿（域逻辑单测）
3. 涉及 UI 交互的改动请在深浅色两种主题下各过一遍
4. 新增纯函数逻辑请配套 `tests/*.test.mjs` 单测

## 约定

- 中文 UI，注释密度与现有代码一致
- 纯函数尽量放 `electron/` 下独立模块，渲染端直接复用做校验
- 不引入 UI 框架与大型依赖；提交信息一句话说清"做了什么"

## 报告问题

请附：Windows 版本、复现步骤、期望与实际行为、`%APPDATA%\tempo-tasks\tempo.json` 的结构（**脱敏后**，勿贴命令中的敏感信息）。
