import { Tray, Menu, nativeImage, BrowserWindow, app, dialog } from 'electron'

let tray: Tray | null = null

export function createTray(mainWindow: BrowserWindow) {
  const icon = createTrayIcon()
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('SnapPaste — 快捷剪切板')

  updateTrayMenu(mainWindow)

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  return tray
}

export function updateTrayMenu(mainWindow: BrowserWindow) {
  if (!tray) return

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示 SnapPaste',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    { type: 'separator' },
    {
      label: '关于 SnapPaste',
      click: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '关于 SnapPaste',
          message: 'SnapPaste — 快捷剪切板',
          detail: `版本: ${app.getVersion()}\n\n快捷键: ⌘+Shift+V 唤起\n\n一款轻量、极速的 Mac 剪切板历史管理器。\n快速抓取，即刻粘贴。`,
          buttons: ['确定']
        })
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        (app as any).isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
}

/**
 * 生成 22x22 精致托盘图标 — 「闪电粘贴板」造型
 * 设计理念：左侧是一个圆角便签板/卡片，右上角叠加一个小闪电，象征"快速粘贴"
 * 使用反锯齿边缘 + macOS 模板图标（黑色+透明度）
 */
function createTrayIcon(): Electron.NativeImage {
  const size = 22
  const canvas = new Float32Array(size * size) // alpha 通道，0~1

  // --- 辅助函数 ---
  const setPixel = (x: number, y: number, alpha: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      canvas[y * size + x] = Math.min(1, Math.max(0, alpha))
    }
  }

  const addPixel = (x: number, y: number, alpha: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      canvas[y * size + x] = Math.min(1, canvas[y * size + x] + alpha)
    }
  }

  // 绘制填充圆角矩形
  const fillRoundRect = (x0: number, y0: number, w: number, h: number, r: number, alpha: number) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        // 检查四个角的圆角
        let inside = true
        const corners = [
          [x0 + r, y0 + r],         // 左上
          [x0 + w - r - 1, y0 + r],     // 右上
          [x0 + r, y0 + h - r - 1],     // 左下
          [x0 + w - r - 1, y0 + h - r - 1]  // 右下
        ]

        for (let ci = 0; ci < 4; ci++) {
          const [cx, cy] = corners[ci]
          const isInCornerRegion =
            (ci === 0 && x < x0 + r && y < y0 + r) ||
            (ci === 1 && x > x0 + w - r - 1 && y < y0 + r) ||
            (ci === 2 && x < x0 + r && y > y0 + h - r - 1) ||
            (ci === 3 && x > x0 + w - r - 1 && y > y0 + h - r - 1)

          if (isInCornerRegion) {
            const dx = x - cx
            const dy = y - cy
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist > r + 0.5) {
              inside = false
            } else if (dist > r - 0.5) {
              // 反锯齿边缘
              setPixel(x, y, alpha * (r + 0.5 - dist))
              inside = false
            }
          }
        }
        if (inside) {
          setPixel(x, y, alpha)
        }
      }
    }
  }

  // 绘制水平线段
  const hLine = (x0: number, x1: number, y: number, alpha: number) => {
    for (let x = x0; x <= x1; x++) setPixel(x, y, alpha)
  }

  // --- 绘制图标 ---

  // 1) 主体：圆角卡片/便签板  (x:2, y:3, w:16, h:17, r:2.5)
  fillRoundRect(2, 3, 16, 17, 3, 1.0)

  // 2) 顶部夹子凸起 (居中，比卡片窄一些)
  fillRoundRect(6, 1, 6, 5, 2, 1.0)
  // 夹子内部镂空（让它看起来像个"夹子"）
  fillRoundRect(8, 2, 2, 2, 0.5, 0)

  // 3) 卡片内部线条（模拟文本） — 用半透明白色"擦除"效果
  //    通过将 alpha 设置为较低值来模拟内容线
  const lineAlpha = 0.15
  hLine(5, 14, 8, lineAlpha)
  hLine(5, 14, 10, lineAlpha)
  hLine(5, 14, 12, lineAlpha)
  hLine(5, 11, 14, lineAlpha)  // 最后一行短一些
  hLine(5, 14, 16, lineAlpha)

  // 4) 右上角闪电符号 ⚡ — SnapPaste 的标志性元素
  //    闪电位于卡片右上角外侧，稍微叠加
  const boltAlpha = 1.0

  // 闪电形状（手绘像素，位于右上方 x:14-20, y:0-10）
  // 闪电上半部分（向右下倾斜的三角）
  setPixel(18, 0, boltAlpha * 0.5)
  setPixel(17, 0, boltAlpha * 0.8)
  setPixel(19, 1, boltAlpha * 0.4)
  setPixel(18, 1, boltAlpha)
  setPixel(17, 1, boltAlpha)
  setPixel(16, 1, boltAlpha * 0.6)
  setPixel(19, 2, boltAlpha * 0.6)
  setPixel(18, 2, boltAlpha)
  setPixel(17, 2, boltAlpha)
  setPixel(16, 2, boltAlpha)
  setPixel(15, 2, boltAlpha * 0.4)
  // 中间横杠
  setPixel(19, 3, boltAlpha * 0.8)
  setPixel(18, 3, boltAlpha)
  setPixel(17, 3, boltAlpha)
  setPixel(16, 3, boltAlpha)
  setPixel(15, 3, boltAlpha)
  setPixel(14, 3, boltAlpha * 0.5)
  // 闪电下半部分
  setPixel(18, 4, boltAlpha * 0.3)
  setPixel(17, 4, boltAlpha)
  setPixel(16, 4, boltAlpha)
  setPixel(15, 4, boltAlpha * 0.8)
  setPixel(17, 5, boltAlpha * 0.5)
  setPixel(16, 5, boltAlpha)
  setPixel(15, 5, boltAlpha * 0.9)
  setPixel(16, 6, boltAlpha * 0.7)
  setPixel(15, 6, boltAlpha * 0.5)
  setPixel(16, 7, boltAlpha * 0.3)

  // 5) 给闪电添加一圈微弱光晕（增加辨识度）
  const glowPixels = [
    [16, 0, 0.15], [19, 0, 0.1], [20, 1, 0.1], [20, 2, 0.15],
    [20, 3, 0.2], [19, 4, 0.1], [18, 5, 0.1], [17, 6, 0.15],
    [15, 1, 0.1], [14, 2, 0.1], [13, 3, 0.1], [14, 4, 0.1],
    [14, 5, 0.1], [14, 6, 0.1], [15, 7, 0.1], [17, 7, 0.1]
  ]
  for (const [gx, gy, ga] of glowPixels) {
    addPixel(gx, gy, ga)
  }

  // --- 转为 RGBA Buffer ---
  const pixels = Buffer.alloc(size * size * 4, 0)
  for (let i = 0; i < size * size; i++) {
    const a = Math.round(canvas[i] * 255)
    if (a > 0) {
      pixels[i * 4] = 0       // R — 黑色（模板图标会被系统着色）
      pixels[i * 4 + 1] = 0   // G
      pixels[i * 4 + 2] = 0   // B
      pixels[i * 4 + 3] = a   // A
    }
  }

  const pngBuffer = buildPNG(size, size, pixels)
  return nativeImage.createFromBuffer(pngBuffer, {
    width: size,
    height: size,
    scaleFactor: 2.0
  })
}

/**
 * 手动构建合法 PNG 文件
 */
function buildPNG(width: number, height: number, rgba: Buffer): Buffer {
  const chunks: Buffer[] = []

  // PNG 签名
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  chunks.push(createPNGChunk('IHDR', ihdr))

  // IDAT
  const rawData: number[] = []
  for (let y = 0; y < height; y++) {
    rawData.push(0) // filter: None
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      rawData.push(rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3])
    }
  }
  const zlib = require('zlib')
  const compressed = zlib.deflateSync(Buffer.from(rawData))
  chunks.push(createPNGChunk('IDAT', compressed))

  // IEND
  chunks.push(createPNGChunk('IEND', Buffer.alloc(0)))

  return Buffer.concat(chunks)
}

function createPNGChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([typeBuffer, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcData), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buf: Buffer): number {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
