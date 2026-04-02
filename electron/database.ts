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

/**
 * 原子写入文件：先写临时文件，再 rename 覆盖目标文件
 * 防止写入中途崩溃导致数据丢失
 */
function atomicWriteSync(filePath: string, content: string) {
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, content, 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

/**
 * 异步原子写入
 */
function atomicWriteAsync(filePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpPath = filePath + '.tmp'
    fs.writeFile(tmpPath, content, 'utf-8', (err) => {
      if (err) {
        reject(err)
        return
      }
      fs.rename(tmpPath, filePath, (renameErr) => {
        if (renameErr) {
          reject(renameErr)
          return
        }
        resolve()
      })
    })
  })
}

/**
 * 防抖异步保存数据库（合并短时间内的多次写入）
 */
function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    atomicWriteAsync(dbPath, JSON.stringify(data, null, 2)).catch((err) => {
      console.error('Failed to save database:', err)
    })
  }, SAVE_DEBOUNCE_MS)
}

/**
 * 立即保存（用于关键操作如删除、收藏等需要立即持久化的场景）
 */
function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    atomicWriteSync(dbPath, JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('Failed to save database:', err)
  }
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
  try {
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf-8')
      data = JSON.parse(raw)
      // 为旧记录补充新字段默认值
      for (const clip of data.clips) {
        if (clip.copy_count === undefined) clip.copy_count = 0
        if (clip.first_copied_at === undefined) clip.first_copied_at = null
        if (clip.last_copied_at === undefined) clip.last_copied_at = null
        if (clip.last_pasted_at === undefined) clip.last_pasted_at = clip.created_at
      }
    }
  } catch (err) {
    console.error('Failed to load database, starting fresh:', err)
    // 尝试从 .tmp 恢复
    const tmpPath = dbPath + '.tmp'
    try {
      if (fs.existsSync(tmpPath)) {
        const raw = fs.readFileSync(tmpPath, 'utf-8')
        data = JSON.parse(raw)
        console.log('Recovered database from .tmp file')
      }
    } catch {
      data = { clips: [], nextId: 1 }
    }
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

export function insertClip(content: string, type: ClipType, imagePath?: string): ClipRecord | null {
  const contentHash = hashContent(content)

  // 检查是否存在相同内容
  const existingIdx = data.clips.findIndex((c) => c.content_hash === contentHash)
  if (existingIdx !== -1) {
    const existing = data.clips[existingIdx]
    // created_at 保持不变（首次创建时间），仅更新 last_pasted_at 用于排序置顶
    existing.last_pasted_at = new Date().toISOString()
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

/** 记录一次用户主动复制，更新 copy_count / first_copied_at / last_copied_at */
export function recordCopy(id: number) {
  const clip = data.clips.find((c) => c.id === id)
  if (!clip) return
  const now = new Date().toISOString()
  clip.copy_count = (clip.copy_count || 0) + 1
  if (!clip.first_copied_at) {
    clip.first_copied_at = now
  }
  clip.last_copied_at = now
  scheduleSave()
}

export function clearAll() {
  data.clips = data.clips.filter((c) => c.is_favorite === 1)
  saveNow()
}

function cleanOldRecords() {
  // retentionDays 为 -1 时永久保留，不按时间清理
  if (settings.retentionDays !== -1) {
    const now = new Date().getTime()
    const retentionMs = settings.retentionDays * 24 * 60 * 60 * 1000

    data.clips = data.clips.filter((c) => {
      if (c.is_favorite) return true
      const activeTime = new Date(c.last_pasted_at || c.created_at).getTime()
      return now - activeTime < retentionMs
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
      const toRemove = new Set(nonFavorites.slice(settings.maxRecords).map((c) => c.id))
      data.clips = data.clips.filter((c) => c.is_favorite || !toRemove.has(c.id))
    }
  }
}

export function getSettings(): AppSettings {
  return { ...settings }
}

export function saveSettings(newSettings: AppSettings) {
  settings = { ...newSettings }
  saveSettingsFile()
}
