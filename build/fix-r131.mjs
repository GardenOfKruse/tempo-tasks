import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const cred = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n', encoding: 'utf-8' })
const token = cred.split('\n').find((l) => l.startsWith('password='))?.slice(9)
const body = `## Tempo v0.13.1

第七轮代码审查（全项目终扫）收尾修复：

- 删除任务同步删除落盘日志目录（与清空历史一致，避免孤儿目录累积）
- 系统通知点击改用恢复最小化窗口的正确路径（与托盘/second-instance 一致）

### 下载

| 文件 | 适合 |
|---|---|
| **Tempo-Setup-0.13.1.exe** | 推荐安装版 |
| Tempo-Portable-0.13.1.exe | 免安装单文件 |
| Tempo-0.13.1-win.zip | 解压即用 |

> 未签名，SmartScreen 首次可能提示"仍要运行"。`
writeFileSync('dist-release/r131.json', JSON.stringify({ tag_name: 'v0.13.1', target_commitish: 'v0.13.1', name: 'Tempo v0.13.1', body, draft: false, prerelease: false }))
const rr = execSync(`curl --noproxy "*" -s -X POST -H "Authorization: token ${token}" -H "Content-Type: application/json" --data-binary @dist-release/r131.json https://api.github.com/repos/GardenOfKruse/tempo-tasks/releases`, { encoding: 'utf-8', timeout: 60000 })
const newId = JSON.parse(rr).id
console.log('v0.13.1 Release id:', newId)
if (newId) {
  execSync(`node build/upload-release.mjs ${newId} Tempo-Setup-0.13.1.exe Tempo-Portable-0.13.1.exe Tempo-0.13.1-win.zip`, { stdio: 'inherit', timeout: 590000 })
}
