/**
 * Cuts the shots into one 1080p30 promo.
 *
 * Order comes from the file names. Anything in ai/ named to sort into place is
 * picked up automatically, so the generated cold open and outro b-roll can drop
 * in later without touching this script. Transitions are 0.4s crossfades.
 */
import { existsSync, readdirSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const OUT = join(HERE, 'out')
mkdirSync(OUT, { recursive: true })

const XFADE = 0.4
const clips = []
for (const dir of ['ai', 'shots']) {
  const d = join(HERE, dir)
  if (!existsSync(d)) continue
  for (const f of readdirSync(d)) {
    if (/\.(webm|mp4|mov)$/i.test(f)) clips.push({ sort: f, path: join(d, f) })
  }
}
clips.sort((a, b) => a.sort.localeCompare(b.sort))
if (!clips.length) throw new Error('no clips found')

const dur = (p) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8' }).trim())

/* Normalize first. Mixing a VP8 screen recording and an h264 generated clip
   straight into one xfade graph is where this fell over: same fps, same pixel
   format, same SAR, or the transitions desynchronise. */
const norm = []
for (const [i, c] of clips.entries()) {
  const out = join(OUT, `.n${String(i).padStart(2, '0')}.mp4`)
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-i', c.path,
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=#0b0f14,fps=30,setsar=1,format=yuv420p',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', out,
  ], { stdio: 'inherit' })
  norm.push({ path: out, name: c.sort, seconds: dur(out) })
  console.log(`normalized ${c.sort} (${norm.at(-1).seconds.toFixed(2)}s)`)
}

/* Chain the crossfades. Each xfade shortens the timeline by its duration, so
   the next offset is tracked cumulatively rather than derived per clip. */
const args = norm.flatMap((n) => ['-i', n.path])
let filter = ''
let label = '0:v'
let elapsed = norm[0].seconds
for (let i = 1; i < norm.length; i++) {
  const offset = (elapsed - XFADE).toFixed(3)
  const next = `x${i}`
  filter += `[${label}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${offset}[${next}];`
  label = next
  elapsed = elapsed - XFADE + norm[i].seconds
}
/* No fade-in. GitHub strips the `poster` attribute from a README <video>, so the
   thumbnail everyone sees is frame one -- which a fade from black makes a black
   rectangle. The cut opens on the title card instead, and still fades out. */
filter += `[${label}]fade=t=out:st=${(elapsed - 0.7).toFixed(3)}:d=0.7[v]`

const final = join(OUT, 'openleaf-promo.mp4')
execFileSync('ffmpeg', [
  '-v', 'error', '-y', ...args,
  '-filter_complex', filter, '-map', '[v]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  final,
], { stdio: 'inherit' })

/* A muted autoplay loop for the README wants webm too, and much smaller. */
const web = join(OUT, 'openleaf-promo.webm')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', final, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-an', web], { stdio: 'inherit' })

for (const n of norm) execFileSync('rm', ['-f', n.path])
console.log(`\n${final}\n${web}\ntotal ${elapsed.toFixed(2)}s from ${norm.length} clips`)
