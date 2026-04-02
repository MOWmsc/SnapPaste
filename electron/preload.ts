import { contextBridge, ipcRenderer } from 'electron'
import type { ClipboardAPI } from '../src/types'

const clipboardAPI: ClipboardAPI = {
  getClips: (params) => ipcRenderer.invoke('get-clips', params),
  getClipCount: (params) => ipcRenderer.invoke('get-clip-count', params),
  deleteClip: (id) => ipcRenderer.invoke('delete-clip', id),
  toggleFavorite: (id) => ipcRenderer.invoke('toggle-favorite', id),
  copyToClipboard: (id) => ipcRenderer.invoke('copy-to-clipboard', id),
  clearAll: () => ipcRenderer.invoke('clear-all'),
  onClipboardUpdate: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('clipboard-updated', handler)
    return () => {
      ipcRenderer.removeListener('clipboard-updated', handler)
    }
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  hideWindow: () => ipcRenderer.send('hide-window'),
  onWindowShown: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('window-shown', handler)
    return () => {
      ipcRenderer.removeListener('window-shown', handler)
    }
  },
  onCheckPinStatus: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('check-pin-status', handler)
    return () => {
      ipcRenderer.removeListener('check-pin-status', handler)
    }
  }
}

// 图片读取 API
const imageAPI = {
  getImageBase64: (imagePath: string) => ipcRenderer.invoke('get-image-base64', imagePath)
}

contextBridge.exposeInMainWorld('clipboardAPI', clipboardAPI)
contextBridge.exposeInMainWorld('imageAPI', imageAPI)
