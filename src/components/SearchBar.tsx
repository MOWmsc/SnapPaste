import React, { useRef, useEffect } from 'react'
import { useClipboardStore } from '../stores/clipboard-store'

export default function SearchBar() {
  const inputRef = useRef<HTMLInputElement>(null)
  const searchQuery = useClipboardStore((s) => s.searchQuery)
  const setSearchQuery = useClipboardStore((s) => s.setSearchQuery)

  // 自动聚焦 + 键盘快捷键
  useEffect(() => {
    inputRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery) {
          setSearchQuery('')
        } else {
          window.clipboardAPI.hideWindow()
        }
      }
      // Cmd+F 聚焦搜索框
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchQuery, setSearchQuery])

  // 监听窗口显示事件，重新聚焦搜索框
  useEffect(() => {
    const unsubscribe = window.clipboardAPI.onWindowShown(() => {
      // 短暂延迟确保窗口已经完全显示
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    })
    return unsubscribe
  }, [])

  return (
    <div className="drag-region px-4 pt-3 pb-2">
      <div className="no-drag relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-[var(--text-tertiary)]"
          >
            <path
              d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10.646 11.354a6 6 0 1 1 .708-.708l3.5 3.5a.5.5 0 0 1-.708.708l-3.5-3.5Z"
              fill="currentColor"
            />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="text"
          placeholder="搜索剪切板历史..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-9 pl-9 pr-8 rounded-lg
            bg-[var(--bg-secondary)] text-[var(--text-primary)]
            placeholder:text-[var(--text-tertiary)]
            border border-[var(--border-color)]
            outline-none focus:border-[var(--accent-color)]
            focus:ring-1 focus:ring-[var(--accent-color)]
            text-sm transition-all duration-150"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2
              w-5 h-5 flex items-center justify-center rounded-full
              bg-[var(--text-tertiary)] hover:bg-[var(--text-secondary)]
              transition-colors"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="white">
              <path d="M1 1l6 6M7 1l-6 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
