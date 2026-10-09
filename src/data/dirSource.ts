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

/** 覆盖写工程根下的一个文件（自动保存/保存按钮用；需 readwrite 授权） */
export async function fsaWriteFile(root: FileSystemDirectoryHandle, fileName: string, content: string): Promise<void> {
  const handle = await root.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

/** 删除工程根下的一个文件（类型删除/改名用；需 readwrite 授权） */
export async function fsaDeleteFile(root: FileSystemDirectoryHandle, fileName: string): Promise<void> {
  await root.removeEntry(fileName)
}
