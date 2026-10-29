import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import crypto from 'crypto'
import type { ClipRecord, ClipType, AppSettings } from '../src/types'

interface DatabaseData {
  clips: ClipRecord[]
  nextId: number
}

const DEFAULT_SETTINGS: AppSettings = {
  maxRecords: 1000,
  retentionDays: 30,
  shortcut: 'CommandOrControl+Shift+V',
  launchAtLogin: false
}

let data: DatabaseData = { clips: [], nextId: 1 }
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let dbPath: string
let settingsPath: string

// 防抖写入计时器
let saveTimer: NodeJS.Timeout | null = null
const SAVE_DEBOUNCE_MS = 1000

// 写盘串行化：同一时刻只允许一次数据库写入。
// 旧实现里后台写入与删除/收藏触发的同步写入共用同一个 .tmp，
// 后台写入期间同步写入先完成 rename，随后后台写入再把旧快照 rename 上去，
// 刚删除的记录被写回、刚复制的记录丢失。
let writing = false
// 内存数据有尚未落盘的改动
let dirty = false
// 退出前已做最终同步写入，之后的后台写入不得再覆盖
let closed = false
// 数据文件读取失败且未能备份时禁止写盘，避免用空数据覆盖用户的原文件
let writeBlocked = false

/**
 * 原子写入文件：先写临时文件，再 rename 覆盖目标文件
 * 防止写入中途崩溃导致数据丢失
 */
function atomicWriteSync(filePath: string, content: string, tmpSuffix = '.tmp') {
  const tmpPath = filePath + tmpSuffix
  fs.writeFileSync(tmpPath, content, 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

/**
 * 后台写入数据库。进行中再有改动时只标记 dirty，写完后再写一次最新快照。
 */
function writeDb() {
  if (writeBlocked || closed) return
  if (writing) return // 当前写入结束后会根据 dirty 补写
  writing = true
  dirty = false
  const tmpPath = dbPath + '.tmp'
  const content = JSON.stringify(data, null, 2)

  const done = (err?: unknown) => {
    if (err) {
      console.error('Failed to save database:', err)
      dirty = true // 本次快照没落盘，留给下一次写入
    }
    writing = false
    // 防抖计时器还在等待时交给它处理，否则立即补写
    if (dirty && !saveTimer) writeDb()
  }

  fs.writeFile(tmpPath, content, 'utf-8', (err) => {
    if (err) return done(err)
    if (closed) {
      // 退出时已同步写入了更新的数据，丢弃这份旧快照
      fs.unlink(tmpPath, () => {})
      return done()
    }
    fs.rename(tmpPath, dbPath, (renameErr) => done(renameErr || undefined))
  })
}

/**
 * 防抖保存数据库（合并短时间内的多次写入）
 */
function scheduleSave() {
  dirty = true
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    writeDb()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * 立即保存（删除、收藏等关键操作）：跳过防抖立即开始写入；
 * 若已有写入在进行，则在其结束后立刻补写。
 */
function saveNow() {
  dirty = true
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  writeDb()
}

/**
 * 退出前同步落盘尚未写入的改动。使用独立的临时文件，不与可能仍在进行的后台写入冲突。
 */
export function flushDatabaseSync() {
  if (closed || !dbPath) return
  closed = true
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (writeBlocked || (!dirty && !writing)) return
  try {
    atomicWriteSync(dbPath, JSON.stringify(data, null, 2), '.quit.tmp')
  } catch (err) {
    console.error('Failed to flush database on quit:', err)
  }
}

/** 解析并校验数据文件，结构不对时抛错，按“损坏”处理 */
function parseDatabase(raw: string): DatabaseData {
  const parsed = JSON.parse(raw)
  if (!parsed || !Array.isArray(parsed.clips)) {
    throw new Error('Invalid database structure: clips is not an array')
  }
  if (typeof parsed.nextId !== 'number') {
    parsed.nextId = parsed.clips.reduce((max: number, c: ClipRecord) => Math.max(max, c.id || 0), 0) + 1
  }
  return parsed
}

function saveSettingsFile() {
  try {
    atomicWriteSync(settingsPath, JSON.stringify(settings, null, 2))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

export function initDatabase() {
  const userDataDir = app.getPath('userData')
  dbPath = path.join(userDataDir, 'snappaste-clips.json')
  settingsPath = path.join(userDataDir, 'snappaste-settings.json')

  // 兼容旧版：从旧 Claw 应用的 userData 目录迁移数据
  // 改名后 Electron 的 userData 路径不同（snappaste/ vs claw/），需要跨目录迁移
  const oldUserDataDir = path.join(path.dirname(userDataDir), 'claw')
  const oldPaths = [
    { oldFile: path.join(oldUserDataDir, 'claw-clips.json'), newFile: dbPath },
    { oldFile: path.join(oldUserDataDir, 'claw-settings.json'), newFile: settingsPath }
  ]
  // 也兼容同目录下的旧文件名（以防万一）
  oldPaths.push(
    { oldFile: path.join(userDataDir, 'claw-clips.json'), newFile: dbPath },
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

  // 加载剪切板数据
  let loaded = false
  if (fs.existsSync(dbPath)) {
    try {
      data = parseDatabase(fs.readFileSync(dbPath, 'utf-8'))
      loaded = true
    } catch (err) {
      console.error('Failed to load database:', err)
      // 读不了的原文件先改名保留，绝不能被之后的保存覆盖
      const backupPath = `${dbPath}.corrupt-${Date.now()}`
      try {
        fs.renameSync(dbPath, backupPath)
        console.error(`Unreadable database preserved at ${backupPath}`)
      } catch (backupErr) {
        // 原文件改不了名就不能往同一路径写，本次运行禁止写盘
        writeBlocked = true
        console.error('Failed to preserve unreadable database, saving disabled:', backupErr)
      }
      // 尝试从 .tmp 恢复
      const tmpPath = dbPath + '.tmp'
      try {
        if (fs.existsSync(tmpPath)) {
          data = parseDatabase(fs.readFileSync(tmpPath, 'utf-8'))
          loaded = true
          console.log('Recovered database from .tmp file')
        }
      } catch {
        data = { clips: [], nextId: 1 }
      }
    }
  }

  if (loaded) {
    // 为旧记录补充新字段默认值
    for (const clip of data.clips) {
      if (clip.copy_count === undefined) clip.copy_count = 0
      if (clip.first_copied_at === undefined) clip.first_copied_at = null
      if (clip.last_copied_at === undefined) clip.last_copied_at = null
      if (clip.last_pasted_at === undefined) clip.last_pasted_at = clip.created_at
    }
    // 一次性数据修复：旧版本图片记录的 content_hash 是基于 preview 文本计算的，
    // 导致同尺寸图片相互错误去重。这里基于实际图片文件重算一次正确的 hash。
    migrateImageHashes()
  }

  // 加载设置
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8')
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    }
  } catch (err) {
    console.error('Failed to load settings:', err)
    settings = { ...DEFAULT_SETTINGS }
  }
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * 一次性迁移：旧版本图片记录的 content_hash 是 hash(preview)，
 * 导致同尺寸图片错误去重。这里基于实际 PNG 文件重算 hash，并去除孤儿记录与重复记录。
 *
 * 安全设计：
 * - 通过添加 image_hash_v2 标记位识别已迁移记录，避免每次启动重复执行
 * - 找不到 image_path 文件的图片记录会被删除（已经无法显示）
 * - 重算后若发现真正的重复（同图二份），保留 last_pasted_at 较新的那条
 */
function migrateImageHashes() {
  const flag = (data as any).image_hash_v2_migrated
  if (flag) return

  let recomputed = 0
  let removedOrphans = 0
  let mergedDups = 0

  // Step 1: 重算所有图片记录的 content_hash
  const seen = new Map<string, ClipRecord>() // 新 hash → 保留的记录
  const toRemove = new Set<number>()

  for (const clip of data.clips) {
    if (clip.type !== 'image') continue
    if (!clip.image_path || !fs.existsSync(clip.image_path)) {
      // 孤儿图片记录（文件已被清理或丢失），直接删除
      toRemove.add(clip.id)
      removedOrphans++
      continue
    }
    try {
      const buffer = fs.readFileSync(clip.image_path)
      const newHash = hashContent(buffer.toString('base64'))
      clip.content_hash = newHash
      recomputed++

      // 同一新 hash 出现多次 → 真正的重复，保留较新一条
      const prior = seen.get(newHash)
      if (prior) {
        const priorTime = new Date(prior.last_pasted_at || prior.created_at).getTime()
        const curTime = new Date(clip.last_pasted_at || clip.created_at).getTime()
        const loser = curTime > priorTime ? prior : clip
        const winner = curTime > priorTime ? clip : prior
        toRemove.add(loser.id)
        seen.set(newHash, winner)
        mergedDups++
      } else {
        seen.set(newHash, clip)
      }
    } catch (err) {
      console.error(`Failed to rehash image ${clip.image_path}:`, err)
      // 读不出来的图片视为孤儿
      toRemove.add(clip.id)
      removedOrphans++
    }
  }

  if (toRemove.size > 0) {
    const dropped = data.clips.filter((c) => toRemove.has(c.id))
    data.clips = data.clips.filter((c) => !toRemove.has(c.id))
    // 被合并/删除的记录同步删图；若同文件仍被保留记录引用则不删
    const stillReferenced = new Set(
      data.clips.filter((c) => c.image_path).map((c) => path.basename(c.image_path as string))
    )
    for (const clip of dropped) {
      if (clip.image_path && stillReferenced.has(path.basename(clip.image_path))) continue
      unlinkClipImage(clip)
    }
  }

  ;(data as any).image_hash_v2_migrated = true

  if (recomputed > 0 || removedOrphans > 0 || mergedDups > 0) {
    console.log(
      `[Migration] image hashes: recomputed=${recomputed}, removedOrphans=${removedOrphans}, mergedDuplicates=${mergedDups}`
    )
    // 立即持久化迁移结果
    if (writeBlocked) return
    try {
      atomicWriteSync(dbPath, JSON.stringify(data, null, 2))
    } catch (err) {
      console.error('Failed to persist migration result:', err)
    }
  }
}

export function insertClip(
  content: string,
  type: ClipType,
  imagePath?: string,
  /** 可选的外部 hash。图片应传入图片二进制 hash；不传则用 content 计算（仅适合文本） */
  externalHash?: string
): ClipRecord | null {
  // ⚠️ 图片必须使用外部传入的 imageHash 作为 content_hash，
  //    否则不同图片只要 preview 文本（如 "[图片 1920×1080]"）相同就会被错误去重
  const contentHash = externalHash || hashContent(content)

  // 检查是否存在相同内容
  const existingIdx = data.clips.findIndex((c) => c.content_hash === contentHash)
  if (existingIdx !== -1) {
    const existing = data.clips[existingIdx]
    // created_at 保持不变（首次创建时间），仅更新 last_pasted_at 用于排序置顶
    existing.last_pasted_at = new Date().toISOString()
    // 图片：若现有记录的 image_path 已失效（文件被清理），用新路径替换
    if (type === 'image' && imagePath && existing.image_path !== imagePath) {
      try {
        if (!existing.image_path || !fs.existsSync(existing.image_path)) {
          existing.image_path = imagePath
        } else {
          // 旧文件还在，新文件是冗余的，删除新文件避免磁盘泄漏
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath)
          }
        }
      } catch (err) {
        console.error('Failed to reconcile image path:', err)
      }
    }
    scheduleSave() // 防抖保存
    return existing
  }

  const preview = content.substring(0, 200)
  const now = new Date().toISOString()
  const newClip: ClipRecord = {
    id: data.nextId++,
    content,
    type,
    preview,
    image_path: imagePath || null,
    is_favorite: 0,
    content_hash: contentHash,
    created_at: now,
    last_pasted_at: now,
    copy_count: 0,
    first_copied_at: null,
    last_copied_at: null
  }

  data.clips.unshift(newClip)

  // 清理超限记录（每 10 次插入执行一次，降低频率）
  if (data.nextId % 10 === 0) {
    cleanOldRecords()
  }
  scheduleSave() // 防抖保存

  return newClip
}

export function getClips(params: {
  offset: number
  limit: number
  type?: ClipType | 'all'
  search?: string
  favoritesOnly?: boolean
}): ClipRecord[] {
  const { offset, limit, type, search, favoritesOnly } = params
  const filtered = filterClips({ type, search, favoritesOnly })

  // 排序：收藏优先，然后按最后粘贴时间倒序
  filtered.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return b.is_favorite - a.is_favorite
    const aTime = new Date(a.last_pasted_at || a.created_at).getTime()
    const bTime = new Date(b.last_pasted_at || b.created_at).getTime()
    return bTime - aTime
  })

  return filtered.slice(offset, offset + limit)
}

export function getClipCount(params: {
  type?: ClipType | 'all'
  search?: string
  favoritesOnly?: boolean
}): number {
  return filterClips(params).length
}

/** 公共过滤函数，消除 getClips 和 getClipCount 的重复逻辑 */
function filterClips(params: {
  type?: ClipType | 'all'
  search?: string
  favoritesOnly?: boolean
}): ClipRecord[] {
  const { type, search, favoritesOnly } = params
  let filtered = [...data.clips]

  if (type && type !== 'all') {
    filtered = filtered.filter((c) => c.type === type)
  }

  if (search) {
    const lowerSearch = search.toLowerCase()
    filtered = filtered.filter((c) => c.content.toLowerCase().includes(lowerSearch))
  }

  if (favoritesOnly) {
    filtered = filtered.filter((c) => c.is_favorite === 1)
  }

  return filtered
}

export function deleteClip(id: number) {
  data.clips = data.clips.filter((c) => c.id !== id)
  saveNow() // 删除立即持久化
}

export function toggleFavorite(id: number) {
  const clip = data.clips.find((c) => c.id === id)
  if (clip) {
    clip.is_favorite = clip.is_favorite ? 0 : 1
    saveNow() // 收藏状态立即持久化
  }
}

export function getClipById(id: number): ClipRecord | undefined {
  return data.clips.find((c) => c.id === id)
}

/** 记录一次用户主动复制，更新 copy_count / first_copied_at / last_copied_at，
 *  并刷新 last_pasted_at 以使该条目排序置顶 */
export function recordCopy(id: number) {
  const clip = data.clips.find((c) => c.id === id)
  if (!clip) return
  const now = new Date().toISOString()
  clip.copy_count = (clip.copy_count || 0) + 1
  if (!clip.first_copied_at) {
    clip.first_copied_at = now
  }
  clip.last_copied_at = now
  // 同步更新最后活跃时间，使其在列表中置顶（getClips 按 last_pasted_at 排序）
  clip.last_pasted_at = now
  scheduleSave()
}

export function clearAll() {
  data.clips = data.clips.filter((c) => c.is_favorite === 1)
  saveNow()
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

function cleanOldRecords() {
  // 被清理掉的记录要同步删除图片文件，否则只删记录会留下孤儿文件
  const removed: ClipRecord[] = []

  // retentionDays 为 -1 时永久保留，不按时间清理
  if (settings.retentionDays !== -1) {
    const now = new Date().getTime()
    const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000

    data.clips = data.clips.filter((c) => {
      if (c.is_favorite) return true
      const activeTime = new Date(c.last_pasted_at || c.created_at).getTime()
      if (now - activeTime < retentionMs) return true
      removed.push(c)
      return false
    })
  }

  // maxRecords 为 -1 时不限制条数，不按数量清理
  if (settings.maxRecords !== -1) {
    const nonFavorites = data.clips.filter((c) => !c.is_favorite)
    if (nonFavorites.length > settings.maxRecords) {
      nonFavorites.sort((a, b) => {
        const aTime = new Date(a.last_pasted_at || a.created_at).getTime()
        const bTime = new Date(b.last_pasted_at || b.created_at).getTime()
        return bTime - aTime
      })
      const dropped = nonFavorites.slice(settings.maxRecords)
      const toRemove = new Set(dropped.map((c) => c.id))
      data.clips = data.clips.filter((c) => c.is_favorite || !toRemove.has(c.id))
      removed.push(...dropped)
    }
  }

  for (const clip of removed) {
    unlinkClipImage(clip)
  }
}

export function getSettings(): AppSettings {
  return { ...settings }
}

export function saveSettings(newSettings: AppSettings) {
  settings = { ...newSettings }
  saveSettingsFile()
}
