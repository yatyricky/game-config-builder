/**
 * 近期工程（裁决 2026-10-08：句柄一键重开 + 打开时间倒排 + 同名目录可区分）。
 * - 每条 {id, name}：id 为打开时生成的 UUID；localStorage 存名单（FSA 不暴露绝对路径，只能显示目录名）
 * - IndexedDB 以 id 为 key 存 FileSystemDirectoryHandle（localStorage 存不了句柄）
 * - 每次打开/重开成功，该条目移至列表首位（打开时间倒排）
 */

const NAMES_KEY = 'gcb.recents'
const DB_NAME = 'gcb-handles'
const STORE = 'handles'
const MAX_RECENTS = 5

export interface RecentEntry {
  id: string
  name: string
}

export function loadRecentEntries(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(NAMES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is RecentEntry => typeof e === 'object' && e !== null && typeof (e as RecentEntry).id === 'string' && typeof (e as RecentEntry).name === 'string',
    )
  } catch {
    return []
  }
}

/** 打开/重开成功后调用：置顶（打开时间倒排）、去重、截断，并回写 */
export function rememberRecent(id: string, name: string): RecentEntry[] {
  const next = [{ id, name }, ...loadRecentEntries().filter(e => e.id !== id)].slice(0, MAX_RECENTS)
  localStorage.setItem(NAMES_KEY, JSON.stringify(next))
  return next
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function getHandleById(id: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return handle
}
