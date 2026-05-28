import { clipboard, nativeImage } from 'electron'
import { insertClip, hashContent } from './database'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { ClipType } from '../src/types'

let monitorTimer: NodeJS.Timeout | null = null
let lastHash = ''
let lastChangeCount = -1 // Electron 提供的剪切板变化计数器
let onChangeCallback: (() => void) | null = null

// 自适应轮询：空闲 800ms，活跃后短时间内 300ms
const POLL_IDLE = 800
const POLL_ACTIVE = 300
const ACTIVE_DURATION = 3000 // 活跃窗口 3s
let currentInterval = POLL_IDLE
let lastActivityTs = 0

function getImageDir(): string {
  const dir = path.join(app.getPath('userData'), 'clipboard-images')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 允许外部更新 lastHash（复制操作后调用，防止重复检测）
 */
export function updateLastHash(hash: string) {
  lastHash = hash
  // 同步更新 changeCount，避免下一轮被误判
  try {
    lastChangeCount = (clipboard as any).readChangeCount?.() ?? lastChangeCount
  } catch {}
}

function checkClipboard() {
  try {
    // ✅ 关键优化：先用 changeCount 快速判断剪切板是否变化
    // 这是一个原生整数计数器，O(1) 操作，几乎零成本
    // 只有计数器变化了，才需要真正去读取并编码内容
    const changeCount = (clipboard as any).readChangeCount?.()
    if (typeof changeCount === 'number') {
      if (changeCount === lastChangeCount) {
        return // 剪切板未变化，直接跳过本轮所有重活
      }
      lastChangeCount = changeCount
    }

    // 走到这里说明剪切板确实变化了 — 这是低频路径
    // 优先文本（编码成本远低于图片）
    const text = clipboard.readText()
    if (text && text.trim()) {
      const textHash = hashContent(text)
      if (textHash !== lastHash) {
        lastHash = textHash

        // 判断是否为文件路径
        let type: ClipType = 'text'
        if (text.startsWith('/') || text.startsWith('~')) {
          try {
            if (fs.existsSync(text.trim())) {
              type = 'file'
            }
          } catch {
            // 不是有效路径，当作文本处理
          }
        }

        insertClip(text, type)
        onChangeCallback?.()
        markActive()
        return
      }
    }

    // 图片检测放在最后（成本最高，仅当文本也无变化时才执行一次）
    // 由于 changeCount 已经过滤，这里不会被反复触发
    const formats = clipboard.availableFormats()
    const hasImage = formats.some((f) => f.startsWith('image/'))
    if (hasImage) {
      const image = clipboard.readImage()
      if (!image.isEmpty()) {
        const imageBuffer = image.toPNG()
        // 使用完整 PNG buffer 的 sha256 作为图片 hash，避免不同图片碰撞
        const imageHash = hashContent(imageBuffer.toString('base64'))

        if (imageHash !== lastHash) {
          lastHash = imageHash

          const fileName = `clip_${Date.now()}.png`
          const imagePath = path.join(getImageDir(), fileName)
          fs.writeFileSync(imagePath, imageBuffer)

          const preview = `[图片 ${image.getSize().width}×${image.getSize().height}]`
          // ⚠️ 必须传入 imageHash 作为 externalHash，
          //    否则 insertClip 内部会用 hashContent(preview) 导致同尺寸图片被错误去重
          insertClip(preview, 'image', imagePath, imageHash)
          onChangeCallback?.()
          markActive()
        }
      }
    }
  } catch (err) {
    console.error('Clipboard monitor error:', err)
  }
}

/** 标记为活跃状态，提高短时间内的轮询频率 */
function markActive() {
  lastActivityTs = Date.now()
  if (currentInterval !== POLL_ACTIVE) {
    setInterval_(POLL_ACTIVE)
  }
}

function setInterval_(ms: number) {
  currentInterval = ms
  if (monitorTimer) clearInterval(monitorTimer)
  monitorTimer = setInterval(() => {
    // 活跃窗口过期 → 回退到空闲间隔
    if (currentInterval === POLL_ACTIVE && Date.now() - lastActivityTs > ACTIVE_DURATION) {
      setInterval_(POLL_IDLE)
      return
    }
    checkClipboard()
  }, ms)
}

export function startMonitor(onChange: () => void) {
  onChangeCallback = onChange

  // 初始化当前剪切板状态
  try {
    lastChangeCount = (clipboard as any).readChangeCount?.() ?? -1
  } catch {}
  const currentText = clipboard.readText()
  if (currentText) {
    lastHash = hashContent(currentText)
  }

  setInterval_(POLL_IDLE)
  console.log('Clipboard monitor started (adaptive polling)')
}

export function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
  onChangeCallback = null
  console.log('Clipboard monitor stopped')
}

