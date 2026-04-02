import { clipboard, nativeImage } from 'electron'
import { insertClip, hashContent } from './database'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { ClipType } from '../src/types'

let monitorTimer: NodeJS.Timeout | null = null
let lastHash = ''
let onChangeCallback: (() => void) | null = null

const POLL_INTERVAL = 500 // 500ms 轮询间隔

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
}

function checkClipboard() {
  try {
    // 优先检查图片
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      const imageBuffer = image.toPNG()
      // 使用更多的 base64 字符来降低碰撞概率
      const imageHash = hashContent(imageBuffer.toString('base64').substring(0, 5000))

      if (imageHash !== lastHash) {
        lastHash = imageHash

        // 保存图片到文件
        const fileName = `clip_${Date.now()}.png`
        const imagePath = path.join(getImageDir(), fileName)
        fs.writeFileSync(imagePath, imageBuffer)

        const preview = `[图片 ${image.getSize().width}×${image.getSize().height}]`
        insertClip(preview, 'image', imagePath)
        onChangeCallback?.()
        return
      }
    }

    // 检查文本
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
      }
    }
  } catch (err) {
    console.error('Clipboard monitor error:', err)
  }
}

export function startMonitor(onChange: () => void) {
  onChangeCallback = onChange

  // 初始化当前剪切板内容的哈希值
  const currentText = clipboard.readText()
  if (currentText) {
    lastHash = hashContent(currentText)
  }

  monitorTimer = setInterval(checkClipboard, POLL_INTERVAL)
  console.log('Clipboard monitor started')
}

export function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
  onChangeCallback = null
  console.log('Clipboard monitor stopped')
}
