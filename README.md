# SnapPaste

> 一款轻量、极速的 macOS 剪切板历史管理器。快速抓取，即刻粘贴。

<p>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey.svg" alt="platform" />
  <img src="https://img.shields.io/badge/version-1.0.3-blue.svg" alt="version" />
  <img src="https://img.shields.io/badge/electron-33-9feaf9.svg" alt="electron" />
  <img src="https://img.shields.io/badge/react-18-61dafb.svg" alt="react" />
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="license" />
</p>

---

## ✨ 特性

- 🚀 **全局快捷键** — 默认 `⌘ + Shift + V` 唤起，再按一次或 `Esc` 隐藏
- 📋 **多类型支持** — 文本 / 图片 / 文件路径 自动识别归类
- 🔍 **实时搜索** — 输入即过滤，支持关键词高亮
- ⭐ **收藏置顶** — 重要内容一键收藏，永不被清理
- 📊 **复制统计** — 记录每条内容的复制次数、首次/末次复制时间
- 🖼️ **图片大图预览** — hover 任意图片项即可放大查看
- 🎯 **智能置顶** — 复制后该项自动移到列表第一位
- ⚡️ **自适应轮询** — 基于 `changeCount` 的零开销变化检测，活跃 300ms / 空闲 800ms 动态切换
- 🌓 **深色模式** — 自动跟随系统外观
- 📌 **窗口钉住** — 防止失焦自动隐藏，方便连续操作
- ⌨️ **键盘导航** — `↑↓` 选择 / `Enter` 复制 / `Esc` 关闭
- 💾 **原子写入** — 防抖 + 临时文件 rename，避免数据丢失
- 🧹 **自动清理** — 可配置保留天数与最大条数，收藏项不受影响

## 📸 截图

> 截图位置：`resources/screenshot-*.png`（待补充）

## 🚀 安装

### 方式一：下载安装包（推荐）

到 [Releases](https://github.com/MOWmsc/SnapPaste/releases) 下载最新的 `SnapPaste-x.x.x.dmg` 双击安装。

由于没有 Apple Developer ID 签名，首次打开 macOS 会拦截，可任选其一处理：

```bash
# 方式 A：清除 quarantine 属性
xattr -cr /Applications/SnapPaste.app
```

或在 系统设置 → 隐私与安全性 → 找到 SnapPaste 点击「仍要打开」。

### 方式二：源码构建

```bash
# 1. 克隆
git clone https://github.com/MOWmsc/SnapPaste.git
cd SnapPaste

# 2. 安装依赖
npm install

# 3. 开发模式（实时热更新）
npm run dev

# 4. 打包发布（DMG + ZIP）
npm run build
# 产物位于 release/ 目录
```

## ⌨️ 快捷键

| 操作 | 快捷键 |
|---|---|
| 唤起 / 隐藏窗口 | `⌘ + Shift + V`（可在设置中自定义） |
| 关闭窗口 | `Esc` |
| 聚焦搜索框 | `⌘ + F` |
| 上下选择 | `↑` / `↓` |
| 复制选中项 | `Enter` |

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | [Electron 33](https://www.electronjs.org/) |
| 渲染层 | [React 18](https://react.dev/) + [TypeScript 5](https://www.typescriptlang.org/) |
| 状态管理 | [Zustand 5](https://github.com/pmndrs/zustand) |
| 长列表虚拟化 | [react-virtuoso](https://virtuoso.dev/) |
| 样式 | [Tailwind CSS 3](https://tailwindcss.com/) + CSS Variables |
| 构建 | [Vite 6](https://vitejs.dev/) + [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron) |
| 打包 | [electron-builder 25](https://www.electron.build/) |
| 持久化 | JSON + 原子写入（防抖） |

## 📂 项目结构

```
SnapPaste/
├── electron/                   # 主进程代码
│   ├── main.ts                 # 入口：窗口、快捷键、生命周期
│   ├── preload.ts              # 预加载：暴露安全 API 给渲染进程
│   ├── database.ts             # 持久化层：JSON 文件 + 原子写入
│   ├── clipboard-monitor.ts    # 剪切板监听：基于 changeCount 自适应轮询
│   ├── ipc-handlers.ts         # IPC 调用处理
│   └── tray.ts                 # 系统托盘 + 手绘 PNG 图标
├── src/                        # 渲染进程代码
│   ├── App.tsx                 # 主面板
│   ├── components/             # UI 组件（列表、搜索、设置、Toast 等）
│   ├── stores/                 # Zustand store
│   ├── types/                  # 共享类型定义
│   └── styles/globals.css      # 全局样式
├── resources/                  # 应用图标等资源
├── electron-builder.yml        # 打包配置
└── vite.config.ts              # Vite + Electron 构建配置
```

## 🧠 核心设计

### 自适应剪切板轮询

传统轮询每 500ms 读一次剪切板，CPU 浪费在重复内容上。SnapPaste 利用 Electron 的 `clipboard.readChangeCount()`（原生 O(1) 计数器）作为前置过滤：

- **空闲态** 800ms 检查一次 `changeCount`
- **活跃态**（最近 3s 有变化）切换到 300ms 提高响应
- **changeCount 未变化**直接 return，零内容读取开销

### 智能内容去重

- **文本**：基于 `sha256(content)` 去重
- **图片**：基于 `sha256(full PNG base64)` 去重（早期版本错误地用了 `preview` 文本作 hash，导致同尺寸图片相互覆盖，已在 1.0.1 修复并提供自动数据迁移）
- 重复内容只刷新 `last_pasted_at`，记录置顶不重建

### 复制置顶

复制任意一项后：

1. 后端立即更新 `copy_count`、`last_copied_at`、`last_pasted_at`
2. 前端 store 同步本地状态并按规则（收藏优先 → 时间倒序）重排，UI 立即把该项移到第一位
3. 写入剪切板时同步更新 `lastHash`，防止剪切板监听器把"我刚写的"误判为"新内容"

### 数据安全

- **防抖写入**：1s 内多次变更合并为一次 IO
- **原子写入**：`fs.writeFileSync(tmpPath) → fs.renameSync(tmpPath, dbPath)`，防止崩溃时半写状态
- **崩溃恢复**：启动时若主文件损坏，自动尝试从 `.tmp` 恢复
- **数据迁移版本位**：旧数据库结构变化时安全升级，启动时一次性执行

## 🗂 数据存储位置

```
~/Library/Application Support/snappaste/
├── snappaste-clips.json        # 剪切板记录
├── snappaste-settings.json     # 用户设置
└── clipboard-images/           # 图片缓存目录
```

可在「设置 → 数据存储」页查看并跳转到 Finder。

## 📅 更新日志

### v1.0.3 (2026-05-28)
- ✨ 图片项 hover 显示**大图预览** + 复制统计 tooltip
- 🐛 修复图片项不显示 hover 信息浮层的问题（v1.0.2 合并）

### v1.0.1 (2026-05-27)
- 🐛 **重要修复**：图片去重 hash 算法错误导致同尺寸图片相互覆盖
- ✨ 复制后自动置顶到列表第一位 + 复制次数 +1 + 末次复制时间更新
- ⚡️ 剪切板监听改为基于 `changeCount` 的自适应轮询
- 🔄 新增启动时自动迁移老数据库错误图片 hash + 清理孤儿记录

### v1.0.0 (2026-05-26)
- 🎉 首发版本

## 🤝 贡献

欢迎提 Issue 与 PR。建议在动手前先创建 Issue 讨论方向，避免重复劳动。

## 📄 License

[MIT](LICENSE) © [MOWmsc](https://github.com/MOWmsc)
