import React from 'react'
import { useClipboardStore } from '../stores/clipboard-store'
import type { ClipType } from '../types'

const TABS: { label: string; value: ClipType | 'all'; icon: string }[] = [
  { label: '全部', value: 'all', icon: '📋' },
  { label: '文本', value: 'text', icon: '📝' },
  { label: '图片', value: 'image', icon: '🖼️' },
  { label: '文件', value: 'file', icon: '📁' },
]

export default function FilterTabs() {
  const filterType = useClipboardStore((s) => s.filterType)
  const setFilterType = useClipboardStore((s) => s.setFilterType)
  const viewMode = useClipboardStore((s) => s.viewMode)
  const setViewMode = useClipboardStore((s) => s.setViewMode)
  const totalCount = useClipboardStore((s) => s.totalCount)

  return (
    <div className="px-4 pb-2 flex items-center justify-between">
      <div className="flex items-center gap-1">
        {/* 视图模式切换 */}
        <button
          onClick={() => setViewMode('all')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
            ${viewMode === 'all'
              ? 'bg-[var(--accent-color)] text-white'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
        >
          全部
        </button>
        <button
          onClick={() => setViewMode('favorites')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
            ${viewMode === 'favorites'
              ? 'bg-[var(--accent-color)] text-white'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
        >
          ⭐ 收藏
        </button>
        <button
          onClick={() => setViewMode('settings')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150
            ${viewMode === 'settings'
              ? 'bg-[var(--accent-color)] text-white'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
        >
          ⚙️ 设置
        </button>

        {viewMode !== 'settings' && (
          <>
            <div className="w-px h-4 bg-[var(--border-color)] mx-1" />
            {TABS.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setFilterType(tab.value)}
                className={`px-2 py-1 rounded-md text-xs transition-all duration-150
                  ${filterType === tab.value
                    ? 'bg-[var(--bg-active)] text-[var(--accent-color)] font-medium'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </>
        )}
      </div>

      {viewMode !== 'settings' && (
        <span className="text-xs text-[var(--text-tertiary)]">
          {totalCount} 条记录
        </span>
      )}
    </div>
  )
}
