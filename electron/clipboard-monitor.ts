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
// 剪贴板里那张图的原始位图 hash，用于「这张图是否已处理过」的判断
let lastImageBitmapHash = ''
// 剪贴板里那张图的原始字节指纹，仅用于判断「图有没有换」
let lastImageSignature = ''
let onChangeCallback: (() => void) | null = null

const hashBuffer = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex')

// 拿不到原始字节时的兜底：解码位图成本高，此时保留限频
const IMAGE_RECHECK_MS = 1000
let lastImageCheckTs = 0

// 自适应轮询：空闲 500ms，活跃后短时间内 300ms。
// 空闲间隔影响「图片在剪贴板里能停留多久不被漏掉」——图片检测改为字节指纹后
// 单次成本很低，因此把空闲间隔从 800ms 收紧到 500ms。
const POLL_IDLE = 500
const POLL_ACTIVE = 300
const ACTIVE_DURATION = 3000 // 活跃窗口 3s
let currentInterval = POLL_IDLE
let lastActivityTs = 0

/**
 * 剪贴板里图片的原始字节指纹（长度 + 首尾 4KB 的 hash）。
 *
 * 之前用「解码成位图再 hash」判断是否换图，成本高，只能限频每秒一次；
 * 连续复制两张图时，第二张的停留期常常整个落在限频窗口里，于是被漏掉。
 * Chromium 的 ReadData 是按 UTI 直接取原始数据（不解码），所以这里读字节做指纹，
 * 单次成本约一次内存拷贝，可以每轮轮询都检查。
 */
function imageSignature(): string | null {
  for (const uti of ['public.tiff', 'public.png']) {
    try {
      const buf = clipboard.readBuffer(uti)
      if (buf && buf.length) {
        const head = buf.subarray(0, 4096)
        const tail = buf.subarray(Math.max(0, buf.length - 4096))
        const digest = crypto.createHash('sha256').update(head).update(tail).digest('hex').slice(0, 16)
        return `${buf.length}:${digest}`
      }
    } catch {
      // 该类型不存在，继续试下一个
    }
  }
  return null
}

/**
 * 把当前剪贴板里的图片入库，返回是否新增了记录。
 * 位图 hash 防重复处理，PNG hash 与历史记录保持一致。
 */
function ingestImage(): boolean {
  const image = clipboard.readImage()
  if (image.isEmpty()) return false

  const bitmapHash = hashBuffer(image.toBitmap())
  if (bitmapHash === lastImageBitmapHash) return false
  lastImageBitmapHash = bitmapHash

  const imageBuffer = image.toPNG()
  const imageHash = hashContent(imageBuffer.toString('base64'))
  if (imageHash === lastImageHash) return false
  lastImageHash = imageHash

  const fileName = `clip_${Date.now()}.png`
  const imagePath = path.join(getImageDir(), fileName)
  fs.writeFileSync(imagePath, imageBuffer)

  const preview = `[图片 ${image.getSize().width}×${image.getSize().height}]`
  // ⚠️ 必须传入 imageHash 作为 externalHash，
  //    否则 insertClip 内部会用 hashContent(preview) 导致同尺寸图片被错误去重
  insertClip(preview, 'image', imagePath, imageHash)
  return true
}

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
      const signature = imageSignature()
      if (signature !== null) {
        // 原始字节指纹变了才解码入库；同一张图停留多久都不会重复处理
        if (signature !== lastImageSignature) {
          lastImageSignature = signature
          if (ingestImage()) changed = true
        }
      } else if (Date.now() - lastImageCheckTs >= IMAGE_RECHECK_MS) {
        // 拿不到原始字节（少数来源只给解码后的图）：退回解码，并保留限频
        lastImageCheckTs = Date.now()
        if (ingestImage()) changed = true
      }
    } else {
      // 剪贴板里已没有图片：清空记忆。否则「复制图 A → 复制文字 → 再复制图 A」时
      // 第二次复制与记忆中的 hash 相同会被直接忽略，图 A 不会置顶，看起来像没记录
      lastImageHash = ''
      lastImageBitmapHash = ''
      lastImageSignature = ''
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
    const signature = imageSignature()
    if (signature) {
      lastImageSignature = signature
    } else {
      const image = clipboard.readImage()
      if (!image.isEmpty()) lastImageBitmapHash = hashBuffer(image.toBitmap())
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

