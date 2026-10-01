import { execSync } from 'node:child_process'
import * as path from 'node:path'
const cred = execSync('git -c http.proxy= -c https.proxy= credential fill', { input: 'protocol=https\nhost=github.com\n', encoding: 'utf-8' })
const token = cred.split('\n').find((l) => l.startsWith('password='))?.slice(9)
const id = process.argv[2]
const files = process.argv.slice(3)
for (const f of files) {
  const p = path.resolve('dist-release', f)
  let ok = false
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
    try {
      const r = execSync(`curl --noproxy "*" -s -X POST -H "Authorization: token ${token}" -H "Content-Type: application/octet-stream" --data-binary @${JSON.stringify(p)} "https://uploads.github.com/repos/GardenOfKruse/tempo-tasks/releases/${id}/assets?name=${f}"`, { encoding: 'utf-8', timeout: 590000 })
      const j = JSON.parse(r)
      console.log(j.state ? `OK ${f}` : `FAIL ${f}: ` + r.slice(0, 100))
      ok = j.state === 'uploaded'
    } catch (e) {
      console.log(`RETRY ${f}: ${String(e.message).slice(0, 80)}`)
    }
  }
  if (!ok) console.log(`GIVEUP ${f}`)
}
