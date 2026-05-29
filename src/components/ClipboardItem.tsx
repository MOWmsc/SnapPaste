import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { ClipRecord } from '../types'
import { useClipboardStore } from '../stores/clipboard-store'

interface Props {
  clip: ClipRecord
  searchQuery: string
  isSelected?: boolean
}

// 图片缓存（避免重复 IPC 请求）
const imageCache = new Map<string, string>()

// Tooltip 延迟（ms）
const TOOLTIP_DELAY = 500

export default function ClipboardItem({ clip, searchQuery, isSelected }: Props) {
  const [imageData, setImageData] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; above: boolean }>({ x: 0, y: 0, above: true })
  // 图片预览模式下，根据可用空间动态调整 tooltip 高度（避免被窗口裁切）
  const [previewHeight, setPreviewHeight] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 用于追踪鼠标是否在条目或浮层区域内
  const isInTooltipZoneRef = useRef(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const deleteClip = useClipboardStore((s) => s.deleteClip)
  const toggleFavorite = useClipboardStore((s) => s.toggleFavorite)
  const copyToClipboard = useClipboardStore((s) => s.copyToClipboard)

  // 加载图片（带缓存）
  useEffect(() => {
    if (clip.type === 'image' && clip.image_path) {
      // 检查缓存
      const cached = imageCache.get(clip.image_path)
      if (cached) {
        setImageData(cached)
        return
      }

      setImageLoading(true)
      window.imageAPI.getImageBase64(clip.image_path).then((data) => {
        if (data) {
          imageCache.set(clip.image_path!, data)
          setImageData(data)
        }
        setImageLoading(false)
      })
    }
  }, [clip.type, clip.image_path])

  // 点击外部关闭菜单
  useEffect(() => {
    if (!showMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMenu])

  // 选中时滚动到可视区域
  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isSelected])

  // 清理计时器
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  // 取消隐藏计时器
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  // 延迟隐藏浮层（给鼠标从条目移入浮层的时间）
  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimerRef.current = setTimeout(() => {
      if (!isInTooltipZoneRef.current) {
        setShowTooltip(false)
      }
    }, 150)
  }, [cancelHide])

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    isInTooltipZoneRef.current = true
    cancelHide()

    // 如果已经在显示了，不需要重新计时
    if (showTooltip) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const isImage = clip.type === 'image'
    hoverTimerRef.current = setTimeout(() => {
      if (isImage) {
        // 图片预览：智能定位 — 选上下方向中可用空间更大的一侧，并根据该空间动态决定 tooltip 高度
        // 避免主窗口尺寸有限（680×600）时 tooltip 被裁切
        const previewWidth = 480 // 与 CSS .clip-tooltip-image-mode width 一致
        const PREVIEW_MAX_HEIGHT = 480 // 整个 tooltip 上限（统计区 + 图片区）
        const PREVIEW_MIN_HEIGHT = 200 // 太小就没意义了
        const GAP = 8 // 与条目的间距
        const SAFE_MARGIN = 8 // 距离窗口边缘留白

        const spaceAbove = rect.top - SAFE_MARGIN - GAP
        const spaceBelow = window.innerHeight - rect.bottom - SAFE_MARGIN - GAP
        // 选空间更大的一侧；若两边都不够也选较大那侧（至少不会更糟）
        const above = spaceAbove >= spaceBelow
        const availableSpace = above ? spaceAbove : spaceBelow
        // 动态高度：取 min(可用空间, 设计上限)，保底 200px
        const finalHeight = Math.max(PREVIEW_MIN_HEIGHT, Math.min(availableSpace, PREVIEW_MAX_HEIGHT))

        // 水平居中对齐条目，并确保不超出窗口
        let x = rect.left + rect.width / 2 - previewWidth / 2
        x = Math.max(SAFE_MARGIN, Math.min(x, window.innerWidth - previewWidth - SAFE_MARGIN))
        // 垂直位置：above 时给定 tooltip 的"底边"位置（CSS 用 translateY(-100%) 上推）
        //          below 时给定 tooltip 的"顶边"位置
        const y = above ? rect.top - GAP : rect.bottom + GAP
        setPreviewHeight(finalHeight)
        setTooltipPos({ x, y, above })
      } else {
        // 文本 tooltip：原有上下定位逻辑
        const tooltipHeight = 300 // 估算浮层最大高度
        const above = rect.top > tooltipHeight + 16
        const x = rect.left + 16
        const y = above ? rect.top - 8 : rect.bottom + 8
        setPreviewHeight(null)
        setTooltipPos({ x, y, above })
      }
      setShowTooltip(true)
    }, TOOLTIP_DELAY)
  }, [showTooltip, cancelHide, clip.type])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    isInTooltipZoneRef.current = false
    scheduleHide()
  }, [scheduleHide])

  // 浮层自身的鼠标进入/离开事件
  const handleTooltipMouseEnter = useCallback(() => {
    isInTooltipZoneRef.current = true
    cancelHide()
  }, [cancelHide])

  const handleTooltipMouseLeave = useCallback(() => {
    isInTooltipZoneRef.current = false
    scheduleHide()
  }, [scheduleHide])

  const dismissTooltip = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    cancelHide()
    isInTooltipZoneRef.current = false
    setShowTooltip(false)
  }, [cancelHide])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dismissTooltip() // 右键菜单时关闭 tooltip
    // 边界检测：确保菜单不超出窗口
    const menuWidth = 160
    const menuHeight = 120
    let x = e.clientX
    let y = e.clientY
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8
    }
    setMenuPos({ x, y })
    setShowMenu(true)
  }, [dismissTooltip])

  const handleClick = useCallback(() => {
    dismissTooltip() // 点击时关闭 tooltip
    copyToClipboard(clip.id)
  }, [clip.id, copyToClipboard, dismissTooltip])

  // 高亮搜索文本（memo 化）
  const highlightedContent = useMemo(() => {
    const text = clip.preview || clip.content
    if (!searchQuery) return text

    try {
      const parts = text.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
      return parts.map((part, i) =>
        part.toLowerCase() === searchQuery.toLowerCase()
          ? <span key={i} className="search-highlight">{part}</span>
          : part
      )
    } catch {
      return text
    }
  }, [clip.preview, clip.content, searchQuery])

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    const diffHr = Math.floor(diffMs / 3600000)
    const diffDay = Math.floor(diffMs / 86400000)

    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    if (diffHr < 24) return `${diffHr} 小时前`
    if (diffDay < 7) return `${diffDay} 天前`
    // 跨年显示年份
    if (date.getFullYear() !== now.getFullYear()) {
      return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
    }
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  const formatFullTime = (dateStr: string | null) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  const typeIcon = () => {
    switch (clip.type) {
      case 'image': return '🖼️'
      case 'file': return '📁'
      default: return '📝'
    }
  }

  return (
    <>
      <div
        ref={itemRef}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`group px-4 py-2.5 cursor-pointer transition-all duration-100
          border-b border-[var(--border-color)] last:border-b-0
          animate-fade-in
          ${isSelected
            ? 'bg-[var(--bg-active)] ring-1 ring-[var(--accent-color)] ring-inset'
            : 'hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]'
          }`}
      >
        <div className="flex items-start gap-3">
          {/* 类型图标 */}
          <span className="text-sm mt-0.5 flex-shrink-0 opacity-60">
            {typeIcon()}
          </span>

          {/* 内容区域 */}
          <div className="flex-1 min-w-0">
            {clip.type === 'image' ? (
              imageLoading ? (
                <div className="h-16 rounded-md bg-[var(--bg-secondary)] animate-pulse flex items-center justify-center">
                  <span className="text-xs text-[var(--text-tertiary)]">加载中...</span>
                </div>
              ) : imageData ? (
                <img
                  src={imageData}
                  alt="clipboard image"
                  className="max-h-24 max-w-full rounded-md object-contain bg-[var(--bg-secondary)]"
                />
              ) : (
                <p className="text-sm text-[var(--text-tertiary)] italic">图片已失效</p>
              )
            ) : (
              <p className="text-sm text-[var(--text-primary)] leading-relaxed
                line-clamp-3 break-all whitespace-pre-wrap">
                {highlightedContent}
              </p>
            )}
          </div>

          {/* 右侧信息 */}
          <div className="flex-shrink-0 flex flex-col items-end gap-1">
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {formatTime(clip.last_pasted_at || clip.created_at)}
            </span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* 复制次数标记 */}
              {(clip.copy_count || 0) > 0 && (
                <span className="text-[9px] text-[var(--text-tertiary)] tabular-nums mr-0.5"
                  title={`已复制 ${clip.copy_count} 次`}
                >
                  ×{clip.copy_count}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFavorite(clip.id)
                }}
                className="w-6 h-6 flex items-center justify-center rounded
                  hover:bg-[var(--bg-secondary)] transition-colors"
                title={clip.is_favorite ? '取消收藏' : '收藏'}
              >
                <span className="text-xs">
                  {clip.is_favorite ? '⭐' : '☆'}
                </span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteClip(clip.id)
                }}
                className="w-6 h-6 flex items-center justify-center rounded
                  hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                title="删除"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" className="text-[var(--text-tertiary)] hover:text-[var(--danger-color)]">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {clip.is_favorite ? (
              <span className="text-[10px] opacity-60">⭐</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* 悬停 Tooltip — 详细内容 + 复制统计 */}
      {showTooltip && (
        <div
          ref={tooltipRef}
          className={`clip-tooltip ${clip.type === 'image' ? 'clip-tooltip-image-mode' : ''} ${tooltipPos.above ? 'clip-tooltip-above' : 'clip-tooltip-below'}`}
          onClick={handleClick}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
          style={{
            left: clip.type === 'image' ? tooltipPos.x : Math.min(tooltipPos.x, window.innerWidth - 340),
            top: tooltipPos.y,
            cursor: 'pointer',
            // 图片模式：根据可用空间动态限制 tooltip 总高度，避免被主窗口裁切
            ...(clip.type === 'image' && previewHeight
              ? { maxHeight: previewHeight, height: previewHeight }
              : {}),
          }}
        >
          {/* 图片预览（大图） */}
          {clip.type === 'image' && (
            <div
              className="clip-tooltip-image-wrap"
              style={
                // 给图片区分配 = (tooltip总高 - 统计区估算高 ~136px)
                previewHeight
                  ? { height: Math.max(80, previewHeight - 136), maxHeight: 'none' }
                  : undefined
              }
            >
              {imageData ? (
                <img src={imageData} alt="preview" className="clip-tooltip-image" />
              ) : (
                <div className="clip-tooltip-image-empty">
                  {imageLoading ? '加载中…' : '图片已失效'}
                </div>
              )}
            </div>
          )}

          {/* 完整文本内容（仅较长文本才展示完整内容区） */}
          {clip.type !== 'image' && (clip.content.length > 80 || clip.content.includes('\n')) && (
            <div className="clip-tooltip-content">
              {clip.content}
            </div>
          )}

          {/* 统计信息 */}
          <div className="clip-tooltip-stats">
            <div className="clip-tooltip-stat-row">
              <span className="clip-tooltip-label">📋 复制次数</span>
              <span className="clip-tooltip-value">{clip.copy_count || 0} 次</span>
            </div>
            <div className="clip-tooltip-stat-row">
              <span className="clip-tooltip-label">⏱️ 首次复制</span>
              <span className="clip-tooltip-value">{formatFullTime(clip.first_copied_at)}</span>
            </div>
            <div className="clip-tooltip-stat-row">
              <span className="clip-tooltip-label">🕐 末次复制</span>
              <span className="clip-tooltip-value">{formatFullTime(clip.last_copied_at)}</span>
            </div>
            <div className="clip-tooltip-stat-row">
              <span className="clip-tooltip-label">📅 创建时间</span>
              <span className="clip-tooltip-value">{formatFullTime(clip.created_at)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {showMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-[var(--bg-primary)] border border-[var(--border-color)]
            rounded-lg shadow-lg py-1 min-w-[160px] animate-fade-in backdrop-blur-xl"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            onClick={() => { copyToClipboard(clip.id); setShowMenu(false) }}
            className="w-full px-3 py-1.5 text-left text-sm text-[var(--text-primary)]
              hover:bg-[var(--bg-active)] transition-colors flex items-center gap-2"
          >
            <span className="text-xs">📋</span> 复制
          </button>
          <button
            onClick={() => { toggleFavorite(clip.id); setShowMenu(false) }}
            className="w-full px-3 py-1.5 text-left text-sm text-[var(--text-primary)]
              hover:bg-[var(--bg-active)] transition-colors flex items-center gap-2"
          >
            <span className="text-xs">{clip.is_favorite ? '💔' : '⭐'}</span>
            {clip.is_favorite ? '取消收藏' : '收藏'}
          </button>
          <div className="my-1 border-t border-[var(--border-color)]" />
          <button
            onClick={() => { deleteClip(clip.id); setShowMenu(false) }}
            className="w-full px-3 py-1.5 text-left text-sm text-[var(--danger-color)]
              hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2"
          >
            <span className="text-xs">🗑️</span> 删除
          </button>
        </div>
      )}
    </>
  )
}
