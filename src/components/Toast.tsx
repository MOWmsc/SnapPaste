import React, { useEffect, useState } from 'react'
import { create } from 'zustand'

interface ToastState {
  message: string
  type: 'success' | 'error' | 'info'
  visible: boolean
  show: (message: string, type?: 'success' | 'error' | 'info') => void
  hide: () => void
}

export const useToastStore = create<ToastState>((set) => ({
  message: '',
  type: 'success',
  visible: false,
  show: (message, type = 'success') => {
    set({ message, type, visible: true })
  },
  hide: () => {
    set({ visible: false })
  }
}))

// 便捷函数
export const toast = {
  success: (message: string) => useToastStore.getState().show(message, 'success'),
  error: (message: string) => useToastStore.getState().show(message, 'error'),
  info: (message: string) => useToastStore.getState().show(message, 'info'),
}

export default function Toast() {
  const { message, type, visible, hide } = useToastStore()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (visible) {
      setShow(true)
      const timer = setTimeout(() => {
        setShow(false)
        setTimeout(hide, 200) // 等动画结束后隐藏
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [visible, hide])

  if (!visible) return null

  const icons: Record<string, string> = {
    success: '✓',
    error: '✗',
    info: 'ℹ',
  }

  const bgColors: Record<string, string> = {
    success: 'bg-[var(--success-color)]',
    error: 'bg-[var(--danger-color)]',
    info: 'bg-[var(--accent-color)]',
  }

  return (
    <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100]
      transition-all duration-200 ease-out
      ${show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
    >
      <div className={`${bgColors[type]} text-white text-sm font-medium
        px-4 py-2 rounded-lg shadow-lg flex items-center gap-2
        backdrop-blur-sm`}
      >
        <span className="text-base font-bold">{icons[type]}</span>
        <span>{message}</span>
      </div>
    </div>
  )
}
