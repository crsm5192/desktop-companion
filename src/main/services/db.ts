import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import type { ChatMessage, DiaryEntry, TodoItem } from '../../shared/types'
import { validateChatImages } from '../../shared/chatContent'
import { appRootDir } from '../paths'

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null
let db: Database | null = null
let dbReady: Promise<Database> | null = null

function dbFile(): string {
  return app.isPackaged
    ? join(appRootDir(), 'data.db')
    : join(app.getPath('userData'), 'data.db')
}

function wasmPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'sql-wasm.wasm')
    : join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
}

async function openDb(): Promise<Database> {
  if (db) return db
  if (!SQL) SQL = await initSqlJs({ locateFile: () => wasmPath() })
  const f = dbFile()
  if (existsSync(f)) {
    db = new SQL.Database(readFileSync(f))
  } else {
    db = new SQL.Database()
  }
  initTables(db)
  migrateFromJson(db)
  return db
}

function getDb(): Promise<Database> {
  if (!dbReady) dbReady = openDb().catch(error => { dbReady = null; throw error })
  return dbReady
}

/** sql.js 是内存库，每次写后导出到磁盘 */
function save(): void {
  if (!db) return
  mkdirSync(dirname(dbFile()), { recursive: true })
  writeFileSync(dbFile(), Buffer.from(db.export()))
}

function initTables(d: Database): void {
  d.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      speak_text TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todo_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS diary_entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  const columns = queryRows<{ name: string }>(d, 'PRAGMA table_info(chat_messages)')
  for (const column of ['images_json', 'performance_json']) {
    if (!columns.some(item => item.name === column)) d.run(`ALTER TABLE chat_messages ADD COLUMN ${column} TEXT`)
  }
  save()
}

function queryRows<T>(d: Database, sql: string, params: unknown[] = []): T[] {
  const stmt = d.prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}

/** 一次性迁移：老的 todo.json / diary.json 搬进 SQLite（幂等，INSERT OR IGNORE） */
function migrateFromJson(d: Database): void {
  const ud = app.getPath('userData')
  const todoFile = join(ud, 'todo.json')
  const diaryFile = join(ud, 'diary.json')

  if (existsSync(todoFile)) {
    try {
      const todos = JSON.parse(readFileSync(todoFile, 'utf-8')) as TodoItem[]
      for (const t of todos) {
        d.run('INSERT OR IGNORE INTO todo_items (id, title, done, created_at) VALUES (?, ?, ?, ?)', [t.id, t.title, t.done ? 1 : 0, t.createdAt])
      }
      save()
    } catch (e) {
      console.error('[db] 迁移 todo.json 失败：', e)
    }
  }

  if (existsSync(diaryFile)) {
    try {
      const entries = JSON.parse(readFileSync(diaryFile, 'utf-8')) as DiaryEntry[]
      for (const e of entries) {
        d.run('INSERT OR REPLACE INTO diary_entries (id, date, title, content, updated_at) VALUES (?, ?, ?, ?, ?)', [e.id, e.date, e.title, e.content, e.updatedAt])
      }
      save()
    } catch (e) {
      console.error('[db] 迁移 diary.json 失败：', e)
    }
  }
}

// ---------- 聊天 ----------
export async function dbListChat(limit = 100): Promise<ChatMessage[]> {
  const d = await getDb()
  const rows = queryRows<{ role: string; content: string; speak_text: string | null; images_json: string | null; performance_json: string | null }>(
    d, 'SELECT role, content, speak_text, images_json, performance_json FROM chat_messages ORDER BY id DESC LIMIT ?', [limit]
  )
  return rows.reverse().map((r) => ({
    role: r.role as ChatMessage['role'],
    content: r.content,
    speakText: r.speak_text ?? undefined,
    images: r.images_json ? JSON.parse(r.images_json) : undefined,
    performance: r.performance_json ? JSON.parse(r.performance_json) : undefined
  }))
}

export async function dbAddChat(msgs: ChatMessage[]): Promise<void> {
  const d = await getDb()
  const now = Date.now()
  const normalized = msgs.map(message => ({ ...message, images: validateChatImages(message.images) }))
  for (const m of normalized) {
    d.run('INSERT INTO chat_messages (role, content, speak_text, created_at, images_json, performance_json) VALUES (?, ?, ?, ?, ?, ?)', [m.role, m.content, m.speakText ?? null, now, m.images.length ? JSON.stringify(m.images) : null, m.performance ? JSON.stringify(m.performance) : null])
  }
  save()
}

export async function dbClearChat(): Promise<void> {
  const d = await getDb()
  d.run('DELETE FROM chat_messages')
  save()
}

// ---------- Todo ----------
export async function dbListTodos(): Promise<TodoItem[]> {
  const d = await getDb()
  const rows = queryRows<{ id: string; title: string; done: number; created_at: number }>(
    d, 'SELECT id, title, done, created_at FROM todo_items ORDER BY created_at ASC'
  )
  return rows.map((r) => ({ id: r.id, title: r.title, done: !!r.done, createdAt: r.created_at }))
}

export async function dbAddTodo(title: string): Promise<TodoItem> {
  const d = await getDb()
  const item: TodoItem = { id: randomUUID(), title, done: false, createdAt: Date.now() }
  d.run('INSERT INTO todo_items (id, title, done, created_at) VALUES (?, ?, ?, ?)', [item.id, item.title, 0, item.createdAt])
  save()
  return item
}

export async function dbUpdateTodo(item: TodoItem): Promise<TodoItem[]> {
  const d = await getDb()
  d.run('UPDATE todo_items SET title = ?, done = ? WHERE id = ?', [item.title, item.done ? 1 : 0, item.id])
  save()
  return dbListTodos()
}

export async function dbDeleteTodo(id: string): Promise<TodoItem[]> {
  const d = await getDb()
  d.run('DELETE FROM todo_items WHERE id = ?', [id])
  save()
  return dbListTodos()
}

// ---------- 日记 ----------
export async function dbListDiary(): Promise<DiaryEntry[]> {
  const d = await getDb()
  const rows = queryRows<{ id: string; date: string; title: string; content: string; updated_at: number }>(
    d, 'SELECT id, date, title, content, updated_at FROM diary_entries ORDER BY date DESC'
  )
  return rows.map((r) => ({ id: r.id, date: r.date, title: r.title, content: r.content, updatedAt: r.updated_at }))
}

export async function dbSaveDiary(entry: DiaryEntry): Promise<DiaryEntry> {
  const d = await getDb()
  d.run('INSERT OR REPLACE INTO diary_entries (id, date, title, content, updated_at) VALUES (?, ?, ?, ?, ?)', [entry.id, entry.date, entry.title, entry.content, entry.updatedAt])
  save()
  return entry
}

export async function dbDeleteDiary(id: string): Promise<DiaryEntry[]> {
  const d = await getDb()
  d.run('DELETE FROM diary_entries WHERE id = ?', [id])
  save()
  return dbListDiary()
}
