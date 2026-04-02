import React, { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('SnapPaste Error Boundary caught:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center
          bg-[var(--bg-primary)] text-[var(--text-primary)] p-8">
          <div className="text-4xl mb-4">😵</div>
          <h2 className="text-lg font-semibold mb-2">出了点问题</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4 text-center">
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 rounded-lg text-sm font-medium
              bg-[var(--accent-color)] text-white
              hover:bg-[var(--accent-hover)] transition-colors"
          >
            重新加载
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
