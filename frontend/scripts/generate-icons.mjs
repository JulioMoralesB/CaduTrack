// Rasterises public/favicon.svg into the PNG sizes a PWA needs.
// Committed rather than run at build time: the icons change only when the logo
// does, and a build step would put sharp on the deploy path for nothing.
//
//   node scripts/generate-icons.mjs
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const SOURCE = 'public/favicon.svg'
const OUT = 'public/icons'

// Background behind the logo. Maskable icons are cropped to whatever shape the
// launcher uses, so they cannot be transparent or the logo loses its edges.
const BACKGROUND = { r: 20, g: 23, b: 15, alpha: 1 }

await mkdir(OUT, { recursive: true })

const targets = [
  { name: 'icon-192.png', size: 192, padding: 0, background: { ...BACKGROUND, alpha: 0 } },
  { name: 'icon-512.png', size: 512, padding: 0, background: { ...BACKGROUND, alpha: 0 } },
  // Maskable icons need the logo inside the safe zone — roughly the middle 80%,
  // since launchers crop to a circle, squircle or rounded square.
  { name: 'icon-192-maskable.png', size: 192, padding: 0.2, background: BACKGROUND },
  { name: 'icon-512-maskable.png', size: 512, padding: 0.2, background: BACKGROUND },
  // iOS ignores the manifest icons and uses this one, and it never applies a
  // mask, so it needs its own opaque background.
  { name: 'apple-touch-icon.png', size: 180, padding: 0.1, background: BACKGROUND },
]

for (const { name, size, padding, background } of targets) {
  const inner = Math.round(size * (1 - padding * 2))
  const offset = Math.round((size - inner) / 2)

  const logo = await sharp(SOURCE, { density: 512 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: logo, top: offset, left: offset }])
    .png()
    .toFile(`${OUT}/${name}`)

  console.log(`${OUT}/${name}  ${size}x${size}`)
}
