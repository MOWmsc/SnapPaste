import React, { useEffect, useCallback, useRef, useState } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { useClipboardStore } from '../stores/clipboard-store'
import ClipboardItem from './ClipboardItem'

export default function ClipboardList() {
  const clips = useClipboardStore((s) => s.clips)
  const totalCount = useClipboardStore((s) => s.totalCount)
  const isLoading = useClipboardStore((s) => s.isLoading)
  const searchQuery = useClipboardStore((s) => s.searchQuery)
  const fetchClips = useClipboardStore((s) => s.fetchClips)
  const selectedIndex = useClipboardStore((s) => s.selectedIndex)
  const setSelectedIndex = useClipboardStore((s) => s.setSelectedIndex)
  const copyToClipboard = useClipboardStore((s) => s.copyToClipboard)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)

  useEffect(() => {
    fetchClips(true)
  }, [fetchClips])

  // 监听剪切板更新
  useEffect(() => {
    const unsubscribe = window.clipboardAPI.onClipboardUpdate(() => {
      fetchClips(true)
    })
    return unsubscribe
  }, [fetchClips])

  // 每次窗口显示时重置状态并滚动到顶部
  useEffect(() => {
    const unsubscribe = window.clipboardAPI.onWindowShown(() => {
      virtuosoRef.current?.scrollToIndex({ index: 0, align: 'start' })
      setSelectedIndex(-1)
      setShowBackToTop(false)
    })
    return unsubscribe
  }, [setSelectedIndex])

  // 键盘导航
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (clips.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(Math.min(selectedIndex + 1, clips.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(Math.max(selectedIndex - 1, -1))
    } else if (e.key === 'Enter' && selectedIndex >= 0 && selectedIndex < clips.length) {
      e.preventDefault()
      copyToClipboard(clips[selectedIndex].id)
    }
  }, [clips, selectedIndex, setSelectedIndex, copyToClipboard])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // 回到顶部
  const scrollToTop = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({ index: 0, align: 'start', behavior: 'smooth' })
    setShowBackToTop(false)
  }, [])

  if (clips.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-tertiary)] py-16">
        <div className="text-5xl mb-4 opacity-40">📋</div>
        <p className="text-sm">
          {searchQuery ? '没有找到匹配的记录' : '剪切板历史为空'}
        </p>
        <p className="text-xs mt-1 opacity-60">
          {searchQuery ? '尝试其他关键词' : '复制一些内容试试'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden relative">
      <Virtuoso
        ref={virtuosoRef}
        data={clips}
        endReached={() => {
          if (clips.length < totalCount) {
            fetchClips(false)
          }
        }}
        atTopStateChange={(atTop) => {
          setShowBackToTop(!atTop)
        }}
        overscan={100}
        itemContent={(index, clip) => (
          <ClipboardItem
            key={clip.id}
            clip={clip}
            searchQuery={searchQuery}
            isSelected={index === selectedIndex}
          />
        )}
        components={{
          Footer: () =>
            isLoading ? (
              <div className="py-4 text-center text-xs text-[var(--text-tertiary)]">
                加载中...
              </div>
            ) : null
        }}
      />

      {/* 回到顶部按钮 */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          className="absolute bottom-3 right-3 w-8 h-8 rounded-full
            bg-[var(--accent-color)] text-white shadow-lg
            flex items-center justify-center
            hover:bg-[var(--accent-hover)] active:scale-95
            transition-all duration-200 animate-fade-in z-10"
          title="回到顶部"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 11V3M7 3L3 7M7 3l4 4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
