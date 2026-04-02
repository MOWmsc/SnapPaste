import React, { useEffect } from 'react'
import SearchBar from './components/SearchBar'
import FilterTabs from './components/FilterTabs'
import ClipboardList from './components/ClipboardList'
import Settings from './components/Settings'
import Toast from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import { useClipboardStore } from './stores/clipboard-store'

export default function App() {
  const viewMode = useClipboardStore((s) => s.viewMode)
  const isPinned = useClipboardStore((s) => s.isPinned)
  const setPinned = useClipboardStore((s) => s.setPinned)

  // 监听主进程的钉住检查请求（窗口失焦时触发）
  useEffect(() => {
    const unsubscribe = window.clipboardAPI.onCheckPinStatus(() => {
      const pinned = useClipboardStore.getState().isPinned
      if (!pinned) {
        window.clipboardAPI.hideWindow()
      }
    })
    return unsubscribe
  }, [])

  return (
    <ErrorBoundary>
      <div className="w-full h-full flex flex-col rounded-xl overflow-hidden
        bg-[var(--bg-primary)] backdrop-blur-xl"
        style={{ boxShadow: 'var(--shadow)' }}
      >
        {/* 顶部搜索栏 + 钉住按钮 */}
        <div className="flex items-start">
          <div className="flex-1">
            <SearchBar />
          </div>
          <button
            onClick={() => setPinned(!isPinned)}
            className={`mt-3 mr-3 w-8 h-8 flex items-center justify-center rounded-lg
              transition-all duration-150 no-drag flex-shrink-0
              ${isPinned
                ? 'bg-[var(--accent-color)] text-white'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
              }`}
            title={isPinned ? '取消固定' : '固定窗口（防止失焦隐藏）'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M8.5 1.5L12.5 5.5L11 7L10 6.5L7.5 9L7.5 12L6 10.5L3.5 8L2 7.5L5 5L4.5 4L3 3.5L5.5 1L7 2.5Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={isPinned ? 'currentColor' : 'none'}
              />
            </svg>
          </button>
        </div>

        {/* 过滤标签栏 */}
        <FilterTabs />

        {/* 分隔线 */}
        <div className="border-t border-[var(--border-color)]" />

        {/* 内容区域 */}
        {viewMode === 'settings' ? <Settings /> : <ClipboardList />}

        {/* 底部状态栏 */}
        <div className="border-t border-[var(--border-color)] px-4 py-1.5 flex items-center justify-between
          text-[10px] text-[var(--text-tertiary)]">
          <span>⌘+Shift+V 唤起 · ↑↓ 选择 · Enter 复制</span>
          <span>ESC 关闭{isPinned ? ' · 📌 已固定' : ''}</span>
        </div>

        {/* Toast 通知 */}
        <Toast />
      </div>
    </ErrorBoundary>
  )
}
