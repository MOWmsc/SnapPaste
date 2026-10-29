import { clipboard, nativeImage } from 'electron'
import { insertClip, hashContent } from './database'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { ClipType } from '../src/types'

let monitorTimer: NodeJS.Timeout | null = null
// 文本与图片分别记录最近一次入库的 hash：图文混排时两者会同时入库，
// 共用一个 hash 会导致每轮轮询互相判为「已变化」而重复插入。
let lastTextHash = ''
let lastImageHash = ''
// 剪贴板里那张图的原始位图 hash，仅用于判断「图有没有换」。
// 位图是内存拷贝，比把图片重新 PNG 编码（zlib 压缩）便宜一个数量级。
let lastImageBitmapHash = ''
let onChangeCallback: (() => void) | null = null

const hashBuffer = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex')

// Electron 的 clipboard 没有暴露 NSPasteboard.changeCount，
// 无法做「计数器变了才读内容」的零成本检测，只能轮询。
// 图片解码成本高于文本，因此仍限制为最多每秒检查一次；
// 但剪贴板里刚出现图片时会立即检查一次，避免漏掉紧接着的复制。
const IMAGE_RECHECK_MS = 1000
let lastImageCheckTs = 0
let hadImageLastPoll = false

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
 * 允许外部更新已入库 hash（复制操作后调用，防止重复检测）
 */
export function updateLastHash(hash: string, type: 'text' | 'image' = 'text') {
  if (type === 'image') {
    lastImageHash = hash
  } else {
    lastTextHash = hash
  }
}

function checkClipboard() {
  try {
    let changed = false

    // 文本（读取成本远低于图片）
    const text = clipboard.readText()
    if (text && text.trim()) {
      const textHash = hashContent(text)
      if (textHash !== lastTextHash) {
        lastTextHash = textHash

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
        changed = true
      }
    } else {
      // 剪贴板里已没有文字：清空记忆，之后再复制同一段文字才能被识别为新的复制并置顶
      lastTextHash = ''
    }

    // 图片：不再因为文本非空就跳过。
    // 从 Word / 浏览器复制图文混排的内容时，粘贴板里同时有文字和图片，
    // 之前只存文字会把图片静默丢掉，这里改为两者各存一条。
    const formats = clipboard.availableFormats()
    const hasImage = formats.some((f) => f.startsWith('image/'))
    if (hasImage) {
      // 剪贴板里停留同一张图时避免反复处理；刚出现图片时立即检查一次
      const now = Date.now()
      const appeared = !hadImageLastPoll
      hadImageLastPoll = true
      if (appeared || now - lastImageCheckTs >= IMAGE_RECHECK_MS) {
        lastImageCheckTs = now

        const image = clipboard.readImage()
        if (!image.isEmpty()) {
          // 先用原始位图判断是否换了图：toBitmap 只是内存拷贝，
          // 不必为了比较而把整张图 PNG 压缩一遍（旧实现每秒压一次）
          const bitmapHash = hashBuffer(image.toBitmap())
          if (bitmapHash !== lastImageBitmapHash) {
            lastImageBitmapHash = bitmapHash

            const imageBuffer = image.toPNG()
            // 入库仍用完整 PNG buffer 的 sha256，与历史记录保持一致
            const imageHash = hashContent(imageBuffer.toString('base64'))

            if (imageHash !== lastImageHash) {
              lastImageHash = imageHash

              const fileName = `clip_${Date.now()}.png`
              const imagePath = path.join(getImageDir(), fileName)
              fs.writeFileSync(imagePath, imageBuffer)

              const preview = `[图片 ${image.getSize().width}×${image.getSize().height}]`
              // ⚠️ 必须传入 imageHash 作为 externalHash，
              //    否则 insertClip 内部会用 hashContent(preview) 导致同尺寸图片被错误去重
              insertClip(preview, 'image', imagePath, imageHash)
              changed = true
            }
          }
        }
      }
    } else {
      // 剪贴板里已没有图片：清空记忆。否则「复制图 A → 复制文字 → 再复制图 A」时
      // 第二次复制与记忆中的 hash 相同会被直接忽略，图 A 不会置顶，看起来像没记录
      lastImageHash = ''
      lastImageBitmapHash = ''
      hadImageLastPoll = false
    }

    // 同一次变化只通知一次，避免图文混排时刷新两遍列表
    if (changed) {
      onChangeCallback?.()
      markActive()
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
  const currentText = clipboard.readText()
  if (currentText) {
    lastTextHash = hashContent(currentText)
  }

  // 启动时剪贴板里已有的图片也要记住，否则它会在第一轮轮询时被当成新内容再录一次
  if (clipboard.availableFormats().some((f) => f.startsWith('image/'))) {
    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      lastImageBitmapHash = hashBuffer(image.toBitmap())
      hadImageLastPoll = true
    }
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

