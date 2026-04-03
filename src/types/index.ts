export type ClipType = 'text' | 'image' | 'file'

export interface ClipRecord {
  id: number
  content: string
  type: ClipType
  preview: string
  image_path: string | null
  is_favorite: number
  content_hash: string
  created_at: string
  /** 最后一次从剪贴板检测到该内容的时间（用于排序置顶） */
  last_pasted_at: string
  /** 复制次数（用户主动复制） */
  copy_count: number
  /** 首次复制时间 */
  first_copied_at: string | null
  /** 末次复制时间 */
  last_copied_at: string | null
}

export interface ClipboardAPI {
  getClips: (params: {
    offset: number
    limit: number
    type?: ClipType | 'all'
    search?: string
    favoritesOnly?: boolean
  }) => Promise<ClipRecord[]>
  getClipCount: (params: {
    type?: ClipType | 'all'
    search?: string
    favoritesOnly?: boolean
  }) => Promise<number>
  deleteClip: (id: number) => Promise<void>
  toggleFavorite: (id: number) => Promise<void>
  copyToClipboard: (id: number) => Promise<boolean | void>
  clearAll: () => Promise<void>
  onClipboardUpdate: (callback: () => void) => () => void
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean; error?: string } | void>
  hideWindow: () => void
  onWindowShown: (callback: () => void) => () => void
  onCheckPinStatus: (callback: () => void) => () => void
}

export interface ImageAPI {
  getImageBase64: (imagePath: string) => Promise<string | null>
}

export interface StorageAPI {
  getStoragePaths: () => Promise<{
    dataDir: string
    dbFile: string
    settingsFile: string
    imagesDir: string
  }>
  showInFolder: (filePath: string) => Promise<boolean>
}

export interface AppSettings {
  /** 最大记录数，-1 表示不限制 */
  maxRecords: number
  /** 保留天数，-1 表示永久保留 */
  retentionDays: number
  shortcut: string
  launchAtLogin: boolean
}

declare global {
  interface Window {
    clipboardAPI: ClipboardAPI
    imageAPI: ImageAPI
    storageAPI: StorageAPI
  }
}
