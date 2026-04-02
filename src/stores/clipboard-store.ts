import { create } from 'zustand'
import type { ClipRecord, ClipType, AppSettings } from '../types'
import { toast } from '../components/Toast'

type ViewMode = 'all' | 'favorites' | 'settings'

interface ClipboardStore {
  // 数据
  clips: ClipRecord[]
  totalCount: number
  isLoading: boolean

  // 过滤
  searchQuery: string
  filterType: ClipType | 'all'
  viewMode: ViewMode

  // UI 状态
  isPinned: boolean
  selectedIndex: number // 键盘导航当前选中的索引

  // 设置
  settings: AppSettings | null

  // Actions
  setSearchQuery: (query: string) => void
  setFilterType: (type: ClipType | 'all') => void
  setViewMode: (mode: ViewMode) => void
  setPinned: (pinned: boolean) => void
  setSelectedIndex: (index: number) => void

  fetchClips: (reset?: boolean) => Promise<void>
  deleteClip: (id: number) => Promise<void>
  toggleFavorite: (id: number) => Promise<void>
  copyToClipboard: (id: number) => Promise<void>
  clearAll: () => Promise<void>

  loadSettings: () => Promise<void>
  updateSettings: (settings: AppSettings) => Promise<{ success: boolean; error?: string }>

  refresh: () => Promise<void>
}

const PAGE_SIZE = 50

// 搜索防抖定时器
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
const SEARCH_DEBOUNCE_MS = 300

export const useClipboardStore = create<ClipboardStore>((set, get) => ({
  clips: [],
  totalCount: 0,
  isLoading: false,
  searchQuery: '',
  filterType: 'all',
  viewMode: 'all',
  isPinned: false,
  selectedIndex: -1,
  settings: null,

  setSearchQuery: (query) => {
    set({ searchQuery: query, selectedIndex: -1 })

    // 搜索防抖
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer)
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      get().fetchClips(true)
    }, SEARCH_DEBOUNCE_MS)
  },

  setFilterType: (type) => {
    set({ filterType: type, selectedIndex: -1 })
    get().fetchClips(true)
  },

  setViewMode: (mode) => {
    set({ viewMode: mode, selectedIndex: -1 })
    if (mode === 'settings') {
      get().loadSettings()
    } else {
      get().fetchClips(true)
    }
  },

  setPinned: (pinned) => {
    set({ isPinned: pinned })
  },

  setSelectedIndex: (index) => {
    set({ selectedIndex: index })
  },

  fetchClips: async (reset = false) => {
    const { searchQuery, filterType, viewMode, clips, isLoading } = get()
    if (isLoading) return

    set({ isLoading: true })

    try {
      const offset = reset ? 0 : clips.length
      const params = {
        offset,
        limit: PAGE_SIZE,
        type: filterType,
        search: searchQuery || undefined,
        favoritesOnly: viewMode === 'favorites'
      }

      const [newClips, count] = await Promise.all([
        window.clipboardAPI.getClips(params),
        window.clipboardAPI.getClipCount({
          type: filterType,
          search: searchQuery || undefined,
          favoritesOnly: viewMode === 'favorites'
        })
      ])

      set({
        clips: reset ? newClips : [...clips, ...newClips],
        totalCount: count,
        isLoading: false
      })
    } catch (err) {
      console.error('Failed to fetch clips:', err)
      set({ isLoading: false })
    }
  },

  deleteClip: async (id) => {
    try {
      await window.clipboardAPI.deleteClip(id)
      set((state) => ({
        clips: state.clips.filter((c) => c.id !== id),
        totalCount: state.totalCount - 1,
        selectedIndex: -1
      }))
      toast.success('已删除')
    } catch (err) {
      console.error('Failed to delete clip:', err)
      toast.error('删除失败')
    }
  },

  toggleFavorite: async (id) => {
    try {
      await window.clipboardAPI.toggleFavorite(id)
      set((state) => ({
        clips: state.clips.map((c) =>
          c.id === id ? { ...c, is_favorite: c.is_favorite ? 0 : 1 } : c
        )
      }))
    } catch (err) {
      console.error('Failed to toggle favorite:', err)
      toast.error('操作失败')
    }
  },

  copyToClipboard: async (id) => {
    const { isPinned } = get()

    // 非钉住模式：先隐藏窗口再复制，零延迟体验
    if (!isPinned) {
      window.clipboardAPI.hideWindow()
    }

    try {
      const result = await window.clipboardAPI.copyToClipboard(id)
      if (result === false) {
        // 复制失败时，钉住模式下显示错误
        if (isPinned) {
          toast.error('复制失败')
        }
        return
      }
      // 前端同步更新复制统计字段
      const now = new Date().toISOString()
      set((state) => ({
        clips: state.clips.map((c) => {
          if (c.id !== id) return c
          return {
            ...c,
            copy_count: (c.copy_count || 0) + 1,
            first_copied_at: c.first_copied_at || now,
            last_copied_at: now
          }
        })
      }))
      // 钉住模式下显示成功提示
      if (isPinned) {
        toast.success('已复制到剪切板')
      }
    } catch (err) {
      console.error('Failed to copy:', err)
      if (isPinned) {
        toast.error('复制失败')
      }
    }
  },

  clearAll: async () => {
    try {
      await window.clipboardAPI.clearAll()
      get().fetchClips(true)
      toast.success('已清空历史记录')
    } catch (err) {
      toast.error('清空失败')
    }
  },

  loadSettings: async () => {
    const settings = await window.clipboardAPI.getSettings()
    set({ settings })
  },

  updateSettings: async (settings) => {
    const result = await window.clipboardAPI.saveSettings(settings)
    if (result?.success === false) {
      toast.error(result.error || '保存失败')
      return { success: false, error: result.error }
    }
    set({ settings })
    toast.success('设置已保存')
    return { success: true }
  },

  refresh: async () => {
    await get().fetchClips(true)
  }
}))
