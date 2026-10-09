export interface DirEntry {
  name: string
  kind: 'file' | 'dir'
}

/** 最小目录访问接口：浏览器走 File System Access，测试/调试走 Node fs（nodeSource.ts） */
export interface DirSource {
  listDir(relPath: string): Promise<DirEntry[]>
  readFile(relPath: string): Promise<string>
}

export function fsaSource(root: FileSystemDirectoryHandle): DirSource {
  const dirOf = async (rel: string): Promise<FileSystemDirectoryHandle> => {
    let dir = root
    for (const seg of rel.split('/')) {
      if (seg === '' || seg === '.') continue
      dir = await dir.getDirectoryHandle(seg)
    }
    return dir
  }
  return {
    async listDir(rel) {
      const dir = await dirOf(rel)
      const entries: DirEntry[] = []
      for await (const [name, handle] of dir.entries()) {
        entries.push({ name, kind: handle.kind === 'directory' ? 'dir' : 'file' })
      }
      return entries
    },
    async readFile(rel) {
      const segments = rel.split('/')
      const file = segments.pop() ?? ''
      const dir = await dirOf(segments.join('/'))
      const handle = await dir.getFileHandle(file)
      const f = await handle.getFile()
      return await f.text()
    },
  }
}

/** 按相对路径逐级解析目录句柄（目录须已存在，不 create——防拼错路径静默建目录） */
async function resolveDir(root: FileSystemDirectoryHandle, relDir: string): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const seg of relDir.split('/')) {
    if (seg === '' || seg === '.') continue
    dir = await dir.getDirectoryHandle(seg)
  }
  return dir
}

/** 覆盖写工程根（或子目录）下的一个文件；fileName 可含 / 相对路径（FSA 不接受文件名带斜杠，须走目录句柄） */
export async function fsaWriteFile(root: FileSystemDirectoryHandle, fileName: string, content: string): Promise<void> {
  const segments = fileName.split('/')
  const file = segments.pop() ?? ''
  const dir = await resolveDir(root, segments.join('/'))
  const handle = await dir.getFileHandle(file, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

/** 删除工程根（或子目录）下的一个文件；fileName 可含 / 相对路径 */
export async function fsaDeleteFile(root: FileSystemDirectoryHandle, fileName: string): Promise<void> {
  const segments = fileName.split('/')
  const file = segments.pop() ?? ''
  const dir = await resolveDir(root, segments.join('/'))
  await dir.removeEntry(file)
}
