import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import path from 'path'
import { initDatabase, getSettings } from './database'
import { startMonitor, stopMonitor, updateLastHash } from './clipboard-monitor'
import { createTray, destroyTray } from './tray'
import { registerIpcHandlers } from './ipc-handlers'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

function createWindow() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  const windowWidth = 680
  const windowHeight = 600

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round(screenHeight * 0.15),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  // 窗口显示时通知渲染进程（用于重新聚焦搜索框）
  mainWindow.on('show', () => {
    mainWindow?.webContents.send('window-shown')
  })

  // 窗口失焦时隐藏（检查是否被钉住）
  mainWindow.on('blur', () => {
    // 通过 IPC 检查渲染进程中的钉住状态
    mainWindow?.webContents.send('check-pin-status')
  })

  // 阻止窗口关闭，改为隐藏
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // 加载页面
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  return mainWindow
}

export function registerShortcut() {
  const settings = getSettings()
  const shortcut = settings.shortcut || 'CommandOrControl+Shift+V'

  globalShortcut.unregisterAll()

  const registered = globalShortcut.register(shortcut, () => {
    if (!mainWindow) return

    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      // 重新定位到当前鼠标所在屏幕的中央偏上
      const mousePoint = screen.getCursorScreenPoint()
      const currentDisplay = screen.getDisplayNearestPoint(mousePoint)
      const { width: screenWidth, height: screenHeight } = currentDisplay.workAreaSize
      const { x: screenX, y: screenY } = currentDisplay.workArea
      const [windowWidth] = mainWindow.getSize()
      mainWindow.setPosition(
        Math.round(screenX + (screenWidth - windowWidth) / 2),
        Math.round(screenY + screenHeight * 0.15)
      )
      mainWindow.show()
      mainWindow.focus()
    }
  })

  if (!registered) {
    console.error(`快捷键注册失败: ${shortcut}`)
  }

  return registered
}

app.whenReady().then(() => {
  // 初始化数据库
  initDatabase()

  // 创建窗口
  const win = createWindow()

  // 注册 IPC 处理器
  registerIpcHandlers(win)

  // 创建系统托盘
  createTray(win)

  // 注册全局快捷键
  registerShortcut()

  // 启动剪切板监听
  startMonitor(() => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('clipboard-updated')
    }
  })

  // macOS: dock 图标点击时显示窗口
  app.on('activate', () => {
    win.show()
    win.focus()
  })

  // 处理开机自启设置
  const settings = getSettings()
  app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })

  // 隐藏 dock 图标（作为工具类应用）
  app.dock?.hide()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  stopMonitor()
  destroyTray()
  globalShortcut.unregisterAll()
})

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  // macOS 不退出
})

export { updateLastHash }
