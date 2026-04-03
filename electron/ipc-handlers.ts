import { ipcMain, clipboard, nativeImage, BrowserWindow, app, shell } from 'electron'
import {
  getClips,
  getClipCount,
  deleteClip,
  toggleFavorite,
  getClipById,
  clearAll,
  getSettings,
  saveSettings,
  hashContent,
  recordCopy
} from './database'
import { registerShortcut, updateLastHash } from './main'
import fs from 'fs'
import path from 'path'
import type { AppSettings } from '../src/types'

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  // 获取剪切板记录列表
  ipcMain.handle('get-clips', (_event, params) => {
    return getClips(params)
  })

  // 获取记录总数
  ipcMain.handle('get-clip-count', (_event, params) => {
    return getClipCount(params)
  })

  // 删除记录（同时清理图片文件）
  ipcMain.handle('delete-clip', (_event, id: number) => {
    if (typeof id !== 'number' || isNaN(id)) return

    const clip = getClipById(id)
    if (clip?.image_path) {
      // 清理对应的图片文件
      try {
        if (fs.existsSync(clip.image_path)) {
          fs.unlinkSync(clip.image_path)
        }
      } catch (err) {
        console.error('Failed to delete image file:', err)
      }
    }
    deleteClip(id)
  })

  // 切换收藏
  ipcMain.handle('toggle-favorite', (_event, id: number) => {
    if (typeof id !== 'number' || isNaN(id)) return
    toggleFavorite(id)
  })

  // 复制到剪切板
  ipcMain.handle('copy-to-clipboard', (_event, id: number) => {
    const clip = getClipById(id)
    if (!clip) return false

    try {
      if (clip.type === 'image' && clip.image_path) {
        if (fs.existsSync(clip.image_path)) {
          const image = nativeImage.createFromPath(clip.image_path)
          clipboard.writeImage(image)
          // 更新 lastHash 防止监听器重复检测
          const imageBuffer = image.toPNG()
          const imageHash = hashContent(imageBuffer.toString('base64').substring(0, 1000))
          updateLastHash(imageHash)
        }
      } else {
        clipboard.writeText(clip.content)
        // 更新 lastHash 防止监听器重复检测
        updateLastHash(hashContent(clip.content))
      }
      // 记录复制统计
      recordCopy(id)
      return true
    } catch (err) {
      console.error('Failed to copy:', err)
      return false
    }
  })

  // 清空所有记录（同时清理图片文件夹）
  ipcMain.handle('clear-all', () => {
    // 获取所有非收藏的图片记录并删除文件
    const clips = getClips({ offset: 0, limit: 999999 })
    for (const clip of clips) {
      if (!clip.is_favorite && clip.image_path) {
        try {
          if (fs.existsSync(clip.image_path)) {
            fs.unlinkSync(clip.image_path)
          }
        } catch { /* ignore */ }
      }
    }
    clearAll()
  })

  // 获取设置
  ipcMain.handle('get-settings', () => {
    return getSettings()
  })

  // 保存设置 — 同时重新注册快捷键和更新开机自启
  ipcMain.handle('save-settings', (_event, newSettings: AppSettings) => {
    const oldSettings = getSettings()
    saveSettings(newSettings)

    // 快捷键变更后重新注册
    if (newSettings.shortcut !== oldSettings.shortcut) {
      const success = registerShortcut()
      if (!success) {
        // 注册失败，回滚快捷键设置
        saveSettings({ ...newSettings, shortcut: oldSettings.shortcut })
        return { success: false, error: `快捷键 "${newSettings.shortcut}" 注册失败，可能被其他应用占用` }
      }
    }

    // 开机自启变更
    if (newSettings.launchAtLogin !== oldSettings.launchAtLogin) {
      app.setLoginItemSettings({ openAtLogin: newSettings.launchAtLogin })
    }

    return { success: true }
  })

  // 隐藏窗口
  ipcMain.on('hide-window', () => {
    mainWindow.hide()
  })

  // 获取图片 base64（限制只能读取 clipboard-images 目录下的图片）
  ipcMain.handle('get-image-base64', (_event, imagePath: string) => {
    try {
      // 安全检查：只允许读取 clipboard-images 目录下的文件
      const allowedDir = path.join(app.getPath('userData'), 'clipboard-images')
      const resolvedPath = path.resolve(imagePath)
      if (!resolvedPath.startsWith(allowedDir)) {
        console.error('Blocked read attempt outside clipboard-images:', imagePath)
        return null
      }

      if (fs.existsSync(resolvedPath)) {
        const buffer = fs.readFileSync(resolvedPath)
        return `data:image/png;base64,${buffer.toString('base64')}`
      }
    } catch (err) {
      console.error('Failed to read image:', err)
    }
    return null
  })

  // 获取数据存储路径信息
  ipcMain.handle('get-storage-paths', () => {
    const userDataDir = app.getPath('userData')
    return {
      dataDir: userDataDir,
      dbFile: path.join(userDataDir, 'snappaste-clips.json'),
      settingsFile: path.join(userDataDir, 'snappaste-settings.json'),
      imagesDir: path.join(userDataDir, 'clipboard-images')
    }
  })

  // 在 Finder 中显示文件/文件夹
  ipcMain.handle('show-in-folder', (_event, filePath: string) => {
    // 安全检查：只允许打开 userData 目录下的路径
    const userDataDir = app.getPath('userData')
    const resolvedPath = path.resolve(filePath)
    if (!resolvedPath.startsWith(userDataDir)) {
      console.error('Blocked folder open attempt outside userData:', filePath)
      return false
    }
    shell.showItemInFolder(resolvedPath)
    return true
  })
}
