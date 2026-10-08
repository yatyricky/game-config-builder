/**
 * 近期工程（用户 2026-10-08 裁决：句柄一键重开）。
 * - localStorage 存目录名名单（下拉展示；FSA 安全模型不暴露绝对路径，只能显示目录名）
 * - IndexedDB 存 FileSystemDirectoryHandle（localStorage 存不了句柄），重载后一键重开（需一次 requestPermission）
 */

const NAMES_KEY = 'gcb.recents'
const DB_NAME = 'gcb-handles'
const STORE = 'handles'
const MAX_RECENTS = 5

export function loadRecentNames(): string[] {
  try {
    const raw = localStorage.getItem(NAMES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

export function rememberRecentName(name: string): string[] {
  const next = [name, ...loadRecentNames().filter(n => n !== name)].slice(0, MAX_RECENTS)
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

export async function putHandle(name: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function getHandle(name: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(name)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return handle
}
