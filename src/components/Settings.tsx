import React, { useEffect, useState, useCallback } from 'react'
import { useClipboardStore } from '../stores/clipboard-store'
import type { AppSettings } from '../types'

// 将 Electron 快捷键格式转为用户友好的显示格式
function formatShortcutDisplay(shortcut: string): string {
  return shortcut
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace('Option', '⌥')
    .replace(/\+/g, ' + ')
}

// 将按键事件转为 Electron 快捷键格式
function keyEventToShortcut(e: React.KeyboardEvent): string | null {
  const modifiers: string[] = []
  if (e.metaKey) modifiers.push('CommandOrControl')
  if (e.ctrlKey && !e.metaKey) modifiers.push('CommandOrControl')
  if (e.shiftKey) modifiers.push('Shift')
  if (e.altKey) modifiers.push('Alt')

  // 需要至少一个修饰键
  if (modifiers.length === 0) return null

  const key = e.key
  // 忽略纯修饰键
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(key)) return null

  // 映射常用键名
  const keyMap: Record<string, string> = {
    ' ': 'Space',
    'ArrowUp': 'Up',
    'ArrowDown': 'Down',
    'ArrowLeft': 'Left',
    'ArrowRight': 'Right',
  }

  const mappedKey = keyMap[key] || key.toUpperCase()
  return [...modifiers, mappedKey].join('+')
}

export default function Settings() {
  const settings = useClipboardStore((s) => s.settings)
  const loadSettings = useClipboardStore((s) => s.loadSettings)
  const updateSettings = useClipboardStore((s) => s.updateSettings)
  const clearAll = useClipboardStore((s) => s.clearAll)

  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (settings) {
      setLocalSettings({ ...settings })
      setHasChanges(false)
    }
  }, [settings])

  // 检测是否有未保存的变更
  useEffect(() => {
    if (localSettings && settings) {
      const changed = JSON.stringify(localSettings) !== JSON.stringify(settings)
      setHasChanges(changed)
    }
  }, [localSettings, settings])

  const handleShortcutKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isRecordingShortcut || !localSettings) return
    e.preventDefault()
    e.stopPropagation()

    const shortcut = keyEventToShortcut(e)
    if (shortcut) {
      setLocalSettings({ ...localSettings, shortcut })
      setIsRecordingShortcut(false)
    }
  }, [isRecordingShortcut, localSettings])

  if (!localSettings) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        加载中...
      </div>
    )
  }

  const handleSave = async () => {
    const result = await updateSettings(localSettings)
    if (result?.success === false && result.error) {
      // 快捷键注册失败，回滚显示
      if (settings) {
        setLocalSettings({ ...localSettings, shortcut: settings.shortcut })
      }
    }
  }

  const handleClear = async () => {
    await clearAll()
    setShowClearConfirm(false)
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-6">设置</h2>

      {/* 历史记录设置 */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">历史记录</h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--text-primary)]">最大记录数</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                {localSettings.maxRecords === -1
                  ? '不限制条数，所有记录将永久保存'
                  : '超出后自动清理最旧的记录'}
              </p>
            </div>
            <select
              value={localSettings.maxRecords}
              onChange={(e) => setLocalSettings({ ...localSettings, maxRecords: parseInt(e.target.value) })}
              className="bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm
                border border-[var(--border-color)] rounded-lg px-3 py-1.5
                outline-none focus:border-[var(--accent-color)]"
            >
              <option value={-1}>♾️ 不限制</option>
              <option value={200}>200 条</option>
              <option value={500}>500 条</option>
              <option value={1000}>1000 条</option>
              <option value={2000}>2000 条</option>
              <option value={5000}>5000 条</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--text-primary)]">保留天数</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                {localSettings.retentionDays === -1
                  ? '永久保留，记录不会因时间过期被清理'
                  : '超过该天数的记录将被自动清理'}
              </p>
            </div>
            <select
              value={localSettings.retentionDays}
              onChange={(e) => setLocalSettings({ ...localSettings, retentionDays: parseInt(e.target.value) })}
              className="bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm
                border border-[var(--border-color)] rounded-lg px-3 py-1.5
                outline-none focus:border-[var(--accent-color)]"
            >
              <option value={-1}>♾️ 永久保留</option>
              <option value={7}>7 天</option>
              <option value={14}>14 天</option>
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value={365}>365 天</option>
            </select>
          </div>
        </div>
      </div>

      {/* 快捷键设置 */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">快捷键</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--text-primary)]">唤起窗口</p>
            <p className="text-xs text-[var(--text-tertiary)]">
              {isRecordingShortcut ? '按下新的快捷键组合...' : '点击右侧按钮修改快捷键'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              tabIndex={0}
              onKeyDown={handleShortcutKeyDown}
              onBlur={() => setIsRecordingShortcut(false)}
              onClick={() => setIsRecordingShortcut(true)}
              className={`text-sm px-3 py-1.5 rounded-lg cursor-pointer transition-all
                border select-none min-w-[120px] text-center
                ${isRecordingShortcut
                  ? 'bg-[var(--accent-color)] text-white border-[var(--accent-color)] animate-pulse'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-color)] hover:border-[var(--accent-color)]'
                }`}
            >
              {isRecordingShortcut
                ? '请按下快捷键...'
                : formatShortcutDisplay(localSettings.shortcut)
              }
            </div>
          </div>
        </div>
      </div>

      {/* 通用设置 */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">通用</h3>

        <div className="space-y-4">
          {/* 开机自启 */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--text-primary)]">开机自启动</p>
              <p className="text-xs text-[var(--text-tertiary)]">登录系统时自动启动 SnapPaste</p>
            </div>
            <button
              onClick={() => setLocalSettings({ ...localSettings, launchAtLogin: !localSettings.launchAtLogin })}
              className={`relative w-10 h-6 rounded-full transition-colors duration-200 flex-shrink-0
                ${localSettings.launchAtLogin ? 'bg-[var(--accent-color)]' : 'bg-[var(--text-tertiary)]'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white
                  shadow transition-transform duration-200
                  ${localSettings.launchAtLogin ? 'translate-x-4' : 'translate-x-0'}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 危险区域 */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-[var(--danger-color)] mb-3">危险操作</h3>

        {!showClearConfirm ? (
          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-4 py-2 rounded-lg text-sm
              bg-red-50 dark:bg-red-900/20 text-[var(--danger-color)]
              hover:bg-red-100 dark:hover:bg-red-900/30
              border border-red-200 dark:border-red-800
              transition-colors"
          >
            清空所有历史记录
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--danger-color)]">确定要清空吗？收藏的内容会保留。</span>
            <button
              onClick={handleClear}
              className="px-3 py-1.5 rounded-lg text-sm bg-[var(--danger-color)] text-white
                hover:opacity-90 transition-opacity"
            >
              确定清空
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)]
                hover:bg-[var(--bg-hover)] transition-colors"
            >
              取消
            </button>
          </div>
        )}
      </div>

      {/* 保存按钮 */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!hasChanges}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
            ${hasChanges
              ? 'bg-[var(--accent-color)] text-white hover:bg-[var(--accent-hover)]'
              : 'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] cursor-not-allowed'
            }`}
        >
          保存设置
        </button>
        {hasChanges && (
          <span className="text-xs text-[var(--text-tertiary)] animate-fade-in">
            有未保存的更改
          </span>
        )}
      </div>

      {/* 关于 */}
      <div className="mt-8 pt-4 border-t border-[var(--border-color)]">
        <p className="text-xs text-[var(--text-tertiary)]">
          SnapPaste v1.0.0 — 快捷剪切板管理工具
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          快捷键 {formatShortcutDisplay(localSettings.shortcut)} 唤起 · 点击条目即可复制 · ↑↓ 键盘导航
        </p>
      </div>
    </div>
  )
}
