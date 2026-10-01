import { execSync } from 'node:child_process'
import * as path from 'node:path'
const cred = execSync('git -c http.proxy= -c https.proxy= credential fill', { input: 'protocol=https\nhost=github.com\n', encoding: 'utf-8' })
const token = cred.split('\n').find((l) => l.startsWith('password='))?.slice(9)
const jobs = [
  [401257941, ['Tempo-Setup-0.9.0.exe', 'Tempo-Portable-0.9.0.exe', 'Tempo-0.9.0-win.zip']],
  [401257953, ['Tempo-Setup-0.10.0.exe', 'Tempo-Portable-0.10.0.exe', 'Tempo-0.10.0-win.zip']],
  [401257959, ['Tempo-Setup-0.10.1.exe', 'Tempo-Portable-0.10.1.exe', 'Tempo-0.10.1-win.zip']],
]
for (const [id, files] of jobs) {
  for (const f of files) {
    const p = path.resolve('dist-release', f)
    let ok = false
    for (let a = 1; a <= 2 && !ok; a++) {
      try {
        const r = execSync(`curl --noproxy "*" -s -X POST -H "Authorization: token ${token}" -H "Content-Type: application/octet-stream" --data-binary @${JSON.stringify(p)} "https://uploads.github.com/repos/GardenOfKruse/tempo-tasks/releases/${id}/assets?name=${f}"`, { encoding: 'utf-8', timeout: 590000 })
        const j = JSON.parse(r)
        console.log(j.state === 'uploaded' ? `OK ${f}` : `FAIL ${f}`)
        ok = j.state === 'uploaded'
      } catch (e) { console.log(`RETRY ${f}`) }
    }
  }
}
console.log('all done')
