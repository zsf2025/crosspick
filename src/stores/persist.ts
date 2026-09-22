/**
 * 持久化抽象层。
 *
 * 设计目标：让 store 不关心底层用的是 localStorage 还是 IndexedDB。
 * - 浏览器环境：使用 IndexedDB（容量大、不会随清缓存轻易丢失、可存结构化数据）。
 * - Node / 测试环境：回退到 localStorage（若已注入 shim），保证单测零改动。
 *
 * 统一对外暴露异步接口（readJSON / writeJSON），调用方用 ready 门控即可。
 */

/** 运行时自动判定后端：浏览器有 indexedDB，测试环境没有 */
export const STORAGE_BACKEND: 'idb' | 'local' =
  typeof indexedDB !== 'undefined' ? 'idb' : 'local'

const DB_NAME = 'crosspick'
const DB_VERSION = 1
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'k' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function idbGetStr(key: string): Promise<string | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () =>
      resolve(req.result ? ((req.result as { v: string }).v ?? null) : null)
    req.onerror = () => reject(req.error)
  })
}

async function idbSetStr(key: string, value: string): Promise<void> {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ k: key, v: value })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function localGetStr(key: string): Promise<string | null> {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

async function localSetStr(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 配额满或隐私模式：静默失败 */
  }
}

/** 读原始字符串（后端无关） */
async function readRaw(key: string): Promise<string | null> {
  if (STORAGE_BACKEND === 'idb') return idbGetStr(key)
  return localGetStr(key)
}

/** 写原始字符串（后端无关） */
async function writeRaw(key: string, value: string): Promise<void> {
  if (STORAGE_BACKEND === 'idb') return idbSetStr(key, value)
  return localSetStr(key, value)
}

export async function readJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await readRaw(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export async function writeJSON(key: string, value: unknown): Promise<void> {
  try {
    await writeRaw(key, JSON.stringify(value))
  } catch {
    /* 序列化或存储失败：忽略 */
  }
}
