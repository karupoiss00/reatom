import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WIDTH = 9183
const HEIGHT = 5859

const fixtures = [
  { name: 'large-01.jpg', rgb: [196, 48, 40] },
  { name: 'large-02.jpg', rgb: [32, 96, 180] },
  { name: 'large-03.jpg', rgb: [40, 140, 72] },
  { name: 'large-04.jpg', rgb: [180, 140, 32] },
]

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../src/__fixtures__/large',
)

function paintRow(rgb, stripe) {
  const row = Buffer.alloc(WIDTH * 3)
  for (let x = 0; x < WIDTH; x++) {
    const inStripe = x > WIDTH * 0.08 && x < WIDTH * 0.16
    const color = inStripe ? stripe : rgb
    row[x * 3] = color[0]
    row[x * 3 + 1] = color[1]
    row[x * 3 + 2] = color[2]
  }
  return row
}

function encodeFixture(fixture) {
  const dest = join(outDir, fixture.name)
  const stripe = fixture.rgb.map((channel) => 255 - channel)
  const row = paintRow(fixture.rgb, stripe)

  return new Promise((resolve, reject) => {
    const child = spawn(
      'cjpeg',
      ['-quality', '30', '-optimize', '-outfile', dest],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    )
    const stdin = child.stdin
    let y = 0
    let failed = false

    const fail = (error) => {
      if (failed) return
      failed = true
      reject(error)
    }

    child.on('error', fail)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else fail(new Error(`cjpeg exited ${code} for ${fixture.name}`))
    })

    stdin.on('error', fail)
    stdin.write(`P6\n${WIDTH} ${HEIGHT}\n255\n`)

    const writeRows = () => {
      while (y < HEIGHT) {
        const ok = stdin.write(row)
        y += 1
        if (!ok) {
          stdin.once('drain', writeRows)
          return
        }
      }
      stdin.end()
    }

    writeRows()
  })
}

await mkdir(outDir, { recursive: true })

for (const fixture of fixtures) {
  await encodeFixture(fixture)
  console.log(fixture.name)
}
