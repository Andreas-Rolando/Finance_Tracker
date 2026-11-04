// Gabungkan setiap Edge Function + modul _shared menjadi SATU file, supaya bisa
// di-copy-paste ke Supabase Dashboard → Edge Functions → Via Editor.
// Jalankan dari root repo:  node scripts/bundle-functions.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', 'supabase', 'functions')
const OUT = path.resolve(import.meta.dirname, '..', 'supabase', 'functions-bundled')

const FUNCTIONS = {
  'telegram-webhook': ['_shared/core.ts', '_shared/parser.ts', '_shared/telegram.ts', '_shared/data.ts', 'telegram-webhook/index.ts'],
  'telegram-cron': ['_shared/core.ts', '_shared/telegram.ts', '_shared/data.ts', 'telegram-cron/index.ts'],
}

// import ... from './x.ts' / '../_shared/x.ts' (boleh multi-baris)
const LOCAL_IMPORT = /^import\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]\.{1,2}\/[^'"]+['"];?[ \t]*\r?\n/gm
// import ... from 'npm:...' / 'jsr:...' → diangkat ke atas sekali saja
const EXTERNAL_IMPORT = /^import\s+[\s\S]*?\s+from\s+['"](?:npm|jsr|https?):[^'"]+['"];?[ \t]*\r?\n/gm

fs.mkdirSync(OUT, { recursive: true })
for (const [name, files] of Object.entries(FUNCTIONS)) {
  const externals = new Set()
  const bodies = files.map((rel) => {
    let src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    src = src.replace(EXTERNAL_IMPORT, (m) => { externals.add(m.trim()); return '' })
    src = src.replace(LOCAL_IMPORT, '')
    return `// ───────────────────────── ${rel}\n${src.trim()}\n`
  })
  const header = [
    '// ⚠️ FILE HASIL GENERATE — jangan diedit di sini.',
    `// Sumber: supabase/functions/${name}/ + _shared/. Regenerate: node scripts/bundle-functions.mjs`,
    '',
    ...externals,
    '',
  ].join('\n')
  const out = path.join(OUT, `${name}.ts`)
  fs.writeFileSync(out, header + bodies.join('\n'))
  console.log(`✓ ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`)
}
