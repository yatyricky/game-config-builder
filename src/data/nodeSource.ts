import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { DirSource } from './dirSource.ts'

export function nodeSource(root: string): DirSource {
  const abs = (rel: string) => resolve(root, ...rel.split('/'))
  return {
    async listDir(rel) {
      const entries = await readdir(abs(rel), { withFileTypes: true })
      return entries.map(e => ({ name: e.name, kind: e.isDirectory() ? ('dir' as const) : ('file' as const) }))
    },
    async readFile(rel) {
      return await readFile(abs(rel), 'utf8')
    },
  }
}
