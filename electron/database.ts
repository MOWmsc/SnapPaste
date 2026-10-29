import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import crypto from 'crypto'
import Database from 'better-sqlite3'
import type { ClipRecord, ClipType, AppSettings } from '../src/types'

const DEFAULT_SETTINGS: AppSettings = {
  maxRecords: 1000,
  retentionDays: 30,
  shortcut: 'CommandOrControl+Shift+V',
  launchAtLogin: false
}

// 表结构：clips 主表 + 排序索引 + FTS5 trigram 全文索引（中文按子串匹配）
const SCHEMA = `
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  type TEXT NOT NULL,
  preview TEXT NOT NULL,
  image_path TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_pasted_at TEXT NOT NULL,
  copy_count INTEGER NOT NULL DEFAULT 0,
  first_copied_at TEXT,
  last_copied_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_clips_order ON clips(is_favorite DESC, last_pasted_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_type ON clips(type);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(
  content, content='clips', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS clips_ai AFTER INSERT ON clips BEGIN
  INSERT INTO clips_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS clips_ad AFTER DELETE ON clips BEGIN
  INSERT INTO clips_fts(clips_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS clips_au AFTER UPDATE OF content ON clips BEGIN
  INSERT INTO clips_fts(clips_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO clips_fts(rowid, content) VALUES (new.id, new.content);
END;
`

let db: Database.Database | null = null
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let dbPath: string
let settingsPath: string
let closed = false

export function initDatabase() {
  const userDataDir = app.getPath('userData')
  dbPath = path.join(userDataDir, 'snappaste.db')
  settingsPath = path.join(userDataDir, 'snappaste-settings.json')

  migrateLegacyData(userDataDir)
  openDatabase()
  importFromJson(userDataDir)
  loadSettings()
}

/**
 * 兼容旧版：从旧 Claw 应用的 userData 目录迁移数据
 * 改名后 Electron 的 userData 路径不同（snappaste/ vs claw/），需要跨目录迁移
 */
function migrateLegacyData(userDataDir: string) {
  const jsonPath = path.join(userDataDir, 'snappaste-clips.json')
  const oldUserDataDir = path.join(path.dirname(userDataDir), 'claw')
  const oldPaths = [
    { oldFile: path.join(oldUserDataDir, 'claw-clips.json'), newFile: jsonPath },
    { oldFile: path.join(oldUserDataDir, 'claw-settings.json'), newFile: settingsPath }
  ]
  // 也兼容同目录下的旧文件名（以防万一）
  oldPaths.push(
    { oldFile: path.join(userDataDir, 'claw-clips.json'), newFile: jsonPath },
    { oldFile: path.join(userDataDir, 'claw-settings.json'), newFile: settingsPath }
  )

  try {
    for (const { oldFile, newFile } of oldPaths) {
      if (!fs.existsSync(newFile) && fs.existsSync(oldFile)) {
        // 跨目录用 copy + 保留原文件（防止意外），同目录用 rename
        if (path.dirname(oldFile) !== path.dirname(newFile)) {
          fs.copyFileSync(oldFile, newFile)
          console.log(`Migrated (copy) ${oldFile} → ${newFile}`)
        } else {
          fs.renameSync(oldFile, newFile)
          console.log(`Migrated (rename) ${oldFile} → ${newFile}`)
        }
      }
    }
    // 迁移 clipboard-images 目录
    const oldImagesDir = path.join(oldUserDataDir, 'clipboard-images')
    const newImagesDir = path.join(userDataDir, 'clipboard-images')
    if (!fs.existsSync(newImagesDir) && fs.existsSync(oldImagesDir)) {
      fs.cpSync(oldImagesDir, newImagesDir, { recursive: true })
      console.log('Migrated clipboard-images directory')
    }
  } catch (err) {
    console.error('Migration from old Claw data failed:', err)
  }
}

function openDatabase() {
  try {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.exec(SCHEMA)
  } catch (err) {
    console.error('Failed to open database:', err)
    // 打不开时先改名保留原文件，避免后续写入把它彻底覆盖
    try {
      db?.close()
    } catch {
      /* ignore */
    }
    db = null
    const backupPath = `${dbPath}.corrupt-${Date.now()}`
    try {
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, backupPath)
        console.error(`Unreadable database preserved at ${backupPath}`)
      }
    } catch (renameErr) {
      console.error('Failed to preserve unreadable database:', renameErr)
    }
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(SCHEMA)
  }
}

/**
 * 首次启动时把旧的 JSON 数据一次性导入 SQLite。
 * 导入成功后才把 JSON 改名为 .migrated-<时间戳> 保留，绝不删除；
 * 导入失败则原样保留 JSON，下次启动重试。
 */
function importFromJson(userDataDir: string) {
  const jsonPath = path.join(userDataDir, 'snappaste-clips.json')
  if (getMeta('json_imported') === '1') return
  if (!fs.existsSync(jsonPath)) {
    setMeta('json_imported', '1')
    return
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    if (!parsed || !Array.isArray(parsed.clips)) {
      throw new Error('Invalid database structure: clips is not an array')
    }
    const rows = parsed.clips.map(normalizeClipRow)
    const insert = db!.prepare(`
      INSERT OR IGNORE INTO clips
        (id, content, type, preview, image_path, is_favorite, content_hash,
         created_at, last_pasted_at, copy_count, first_copied_at, last_copied_at)
      VALUES
        (@id, @content, @type, @preview, @image_path, @is_favorite, @content_hash,
         @created_at, @last_pasted_at, @copy_count, @first_copied_at, @last_copied_at)
    `)
    const run = db!.transaction((list: ReturnType<typeof normalizeClipRow>[]) => {
      for (const row of list) insert.run(row)
    })
    run(rows)

    setMeta('json_imported', '1')
    // 旧数据已完成图片 hash 重算时打标，避免重复迁移
    if (parsed.image_hash_v2_migrated === true) setMeta('image_hash_v2_migrated', '1')
    // 全量导入后合并 FTS 段，索引更紧凑
    db!.exec("INSERT INTO clips_fts(clips_fts) VALUES('optimize')")
    renameJsonAside(jsonPath)
    console.log(`Imported ${countAll()} clips from JSON (${rows.length} rows read)`)
  } catch (err) {
    console.error('JSON import failed, JSON file kept intact:', err)
  }
}

function renameJsonAside(jsonPath: string) {
  try {
    const backupPath = `${jsonPath}.migrated-${Date.now()}`
    fs.renameSync(jsonPath, backupPath)
    console.log(`JSON data archived at ${backupPath}`)
  } catch (err) {
    console.error('Failed to archive JSON data:', err)
  }
}

function normalizeClipRow(raw: any) {
  const createdAt = raw.created_at || new Date().toISOString()
  return {
    id: typeof raw.id === 'number' ? raw.id : undefined,
    content: typeof raw.content === 'string' ? raw.content : String(raw.content ?? ''),
    type: (raw.type as ClipType) || 'text',
    preview: typeof raw.preview === 'string' ? raw.preview : String(raw.content ?? '').substring(0, 200),
    image_path: raw.image_path || null,
    is_favorite: raw.is_favorite ? 1 : 0,
    content_hash: raw.content_hash || hashContent(String(raw.content ?? '')),
    created_at: createdAt,
    last_pasted_at: raw.last_pasted_at || createdAt,
    copy_count: typeof raw.copy_count === 'number' ? raw.copy_count : 0,
    first_copied_at: raw.first_copied_at || null,
    last_copied_at: raw.last_copied_at || null
  }
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) }
    }
  } catch (err) {
    console.error('Failed to load settings:', err)
    settings = { ...DEFAULT_SETTINGS }
  }
}

function atomicWriteSync(filePath: string, content: string) {
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, content, 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

function getMeta(key: string): string | null {
  const row = db!.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row ? row.value : null
}

function setMeta(key: string, value: string) {
  db!
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

function countAll(): number {
  return (db!.prepare('SELECT COUNT(*) AS n FROM clips').get() as { n: number }).n
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/** 转义 LIKE 通配符，避免用户输入的 % _ 被当成通配 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => '\\' + m)
}

/**
 * 搜索条件：3 个字符以上走 FTS5 trigram 子串匹配（中文友好），
 * 更短的查询 trigram 无法命中，回退 LIKE。
 */
function buildWhere(params: {
  type?: ClipType | 'all'
  search?: string
  favoritesOnly?: boolean
}): { sql: string; args: unknown[] } {
  const clauses: string[] = []
  const args: unknown[] = []

  if (params.type && params.type !== 'all') {
    clauses.push('type = ?')
    args.push(params.type)
  }
  if (params.favoritesOnly) {
    clauses.push('is_favorite = 1')
  }
  if (params.search) {
    if (params.search.length >= 3) {
      clauses.push('id IN (SELECT rowid FROM clips_fts WHERE clips_fts MATCH ?)')
      args.push(`"${params.search.replace(/"/g, '""')}"`)
    } else {
      clauses.push("content LIKE ? ESCAPE '\\'")
      args.push(`%${escapeLike(params.search)}%`)
    }
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args }
}

export function getClips(params: {
  offset: number
  limit: number
  type?: ClipType | 'all'
  search?: string
  favoritesOnly?: boolean
}): ClipRecord[] {
  const { offset, limit, type, search, favoritesOnly } = params
  const where = buildWhere({ type, search, favoritesOnly })
  const rows = db!
    .prepare(
      `SELECT * FROM clips ${where.sql}
       ORDER BY is_favorite DESC, last_pasted_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...where.args, limit, offset)
  return rows as ClipRecord[]
}

export function getClipCount(params: {
  type?: ClipType | 'all'
  search?: string
  favoritesOnly?: boolean
}): number {
  const where = buildWhere(params)
  const row = db!.prepare(`SELECT COUNT(*) AS n FROM clips ${where.sql}`).get(...where.args) as { n: number }
  return row.n
}

/**
 * 插入一条记录。图片必须传入 externalHash（图片二进制 hash），
 * 否则不同图片只要 preview 文本（如 "[图片 1920×1080]"）相同就会被错误去重。
 */
export function insertClip(
  content: string,
  type: ClipType,
  imagePath?: string,
  externalHash?: string
): ClipRecord | null {
  const contentHash = externalHash || hashContent(content)
  const now = new Date().toISOString()

  const existing = db!
    .prepare('SELECT * FROM clips WHERE content_hash = ?')
    .get(contentHash) as ClipRecord | undefined
  if (existing) {
    // created_at 保持不变（首次创建时间），仅更新 last_pasted_at 用于排序置顶
    db!.prepare('UPDATE clips SET last_pasted_at = ? WHERE id = ?').run(now, existing.id)
    let resolvedImagePath = existing.image_path
    // 图片：若现有记录的 image_path 已失效（文件被清理），用新路径替换
    if (type === 'image' && imagePath && existing.image_path !== imagePath) {
      try {
        if (!existing.image_path || !fs.existsSync(existing.image_path)) {
          db!.prepare('UPDATE clips SET image_path = ? WHERE id = ?').run(imagePath, existing.id)
          resolvedImagePath = imagePath
        } else if (fs.existsSync(imagePath)) {
          // 旧文件还在，新文件是冗余的，删除新文件避免磁盘泄漏
          fs.unlinkSync(imagePath)
        }
      } catch (err) {
        console.error('Failed to reconcile image path:', err)
      }
    }
    return { ...existing, last_pasted_at: now, image_path: resolvedImagePath }
  }

  const info = db!
    .prepare(
      `INSERT INTO clips (content, type, preview, image_path, is_favorite, content_hash,
                          created_at, last_pasted_at, copy_count, first_copied_at, last_copied_at)
       VALUES (@content, @type, @preview, @image_path, 0, @content_hash,
               @created_at, @created_at, 0, NULL, NULL)`
    )
    .run({
      content,
      type,
      preview: content.substring(0, 200),
      image_path: imagePath || null,
      content_hash: contentHash,
      created_at: now
    })

  cleanOldRecords()
  return getClipById(Number(info.lastInsertRowid)) || null
}

export function deleteClip(id: number) {
  const clip = getClipById(id)
  if (clip) unlinkClipImage(clip)
  db!.prepare('DELETE FROM clips WHERE id = ?').run(id)
}

export function toggleFavorite(id: number) {
  db!.prepare('UPDATE clips SET is_favorite = 1 - is_favorite WHERE id = ?').run(id)
}

export function getClipById(id: number): ClipRecord | undefined {
  return db!.prepare('SELECT * FROM clips WHERE id = ?').get(id) as ClipRecord | undefined
}

/** 记录一次用户主动复制，更新 copy_count / first_copied_at / last_copied_at，
 *  并刷新 last_pasted_at 以使该条目排序置顶 */
export function recordCopy(id: number) {
  const now = new Date().toISOString()
  db!
    .prepare(
      `UPDATE clips
          SET copy_count = copy_count + 1,
              first_copied_at = COALESCE(first_copied_at, @now),
              last_copied_at = @now,
              last_pasted_at = @now
        WHERE id = @id`
    )
    .run({ id, now })
}

export function clearAll() {
  const rows = db!.prepare('SELECT * FROM clips WHERE is_favorite = 0').all() as ClipRecord[]
  for (const clip of rows) unlinkClipImage(clip)
  db!.prepare('DELETE FROM clips WHERE is_favorite = 0').run()
}

/**
 * 删除记录对应的图片文件。
 * 安全边界：只删 clipboard-images 目录内的文件，防止脏数据把任意路径删掉。
 */
function unlinkClipImage(clip: Pick<ClipRecord, 'image_path'>) {
  if (!clip.image_path) return
  const imagesDir = path.join(app.getPath('userData'), 'clipboard-images')
  const target = path.resolve(clip.image_path)
  if (!target.startsWith(path.resolve(imagesDir) + path.sep)) return
  try {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target)
    }
  } catch (err) {
    console.error('Failed to delete image file:', target, err)
  }
}

/**
 * 按保留天数 / 最大条数清理（收藏项不参与）。
 * 改为 SQL 后单次成本很低，插入后直接执行，设置改动立即生效。
 */
function cleanOldRecords() {
  try {
    if (settings.retentionDays !== -1) {
      const cutoff = new Date(Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000).toISOString()
      const expired = db!
        .prepare('SELECT * FROM clips WHERE is_favorite = 0 AND last_pasted_at < ?')
        .all(cutoff) as ClipRecord[]
      if (expired.length) {
        for (const clip of expired) unlinkClipImage(clip)
        db!.prepare('DELETE FROM clips WHERE is_favorite = 0 AND last_pasted_at < ?').run(cutoff)
      }
    }

    if (settings.maxRecords !== -1) {
      const total = (db!.prepare('SELECT COUNT(*) AS n FROM clips WHERE is_favorite = 0').get() as { n: number }).n
      if (total > settings.maxRecords) {
        const overflow = db!
          .prepare(
            `SELECT * FROM clips WHERE is_favorite = 0
             ORDER BY last_pasted_at DESC LIMIT -1 OFFSET ?`
          )
          .all(settings.maxRecords) as ClipRecord[]
        for (const clip of overflow) unlinkClipImage(clip)
        const del = db!.prepare('DELETE FROM clips WHERE id = ?')
        const remove = db!.transaction((list: ClipRecord[]) => {
          for (const clip of list) del.run(clip.id)
        })
        remove(overflow)
      }
    }
  } catch (err) {
    console.error('Failed to clean old records:', err)
  }
}

export function getSettings(): AppSettings {
  return { ...settings }
}

export function saveSettings(newSettings: AppSettings) {
  settings = { ...newSettings }
  try {
    atomicWriteSync(settingsPath, JSON.stringify(settings, null, 2))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
  // 条数/天数限制改动后立即按新设置清理
  cleanOldRecords()
}

/**
 * 退出前落盘并关闭数据库（WAL 合并回主文件）。
 * SQLite 每次写入自身即持久化，这里只需 checkpoint + close。
 */
export function flushDatabaseSync() {
  if (closed || !db) return
  closed = true
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
  } catch (err) {
    console.error('Failed to flush database on quit:', err)
  }
}
