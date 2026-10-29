# SnapPaste

> 一款轻量、极速的 macOS 剪切板历史管理器。快速抓取，即刻粘贴。

<p>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey.svg" alt="platform" />
  <img src="https://img.shields.io/badge/version-1.0.9-blue.svg" alt="version" />
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
- ⚡️ **自适应轮询** — 活跃 300ms / 空闲 800ms 动态切换，图片检查限频每秒一次
- 🌓 **深色模式** — 自动跟随系统外观
- 📌 **窗口钉住** — 防止失焦自动隐藏，方便连续操作
- ⌨️ **键盘导航** — `↑↓` 选择 / `Enter` 复制 / `Esc` 关闭
- 💾 **增量写入** — SQLite + WAL，单条变更只写单条，不再整份重写
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
| 持久化 | SQLite（better-sqlite3 + WAL + FTS5 trigram） |

## 📂 项目结构

```
SnapPaste/
├── electron/                   # 主进程代码
│   ├── main.ts                 # 入口：窗口、快捷键、生命周期
│   ├── preload.ts              # 预加载：暴露安全 API 给渲染进程
│   ├── database.ts             # 持久化层：SQLite（WAL + FTS5 全文索引）
│   ├── clipboard-monitor.ts    # 剪切板监听：自适应轮询（图片限频每秒一次）
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

Electron 的 `clipboard` 没有暴露 macOS 的 `changeCount`，无法做「计数器变了才读内容」的零成本检测，因此采用分层轮询：

- **空闲态** 800ms 轮询一次
- **活跃态**（最近 3s 内有变化）切换到 300ms 提高响应
- **文本**每轮读取并比对 `sha256`，成本低
- **图片**解码 + PNG 编码成本高，限频每秒最多检查一次
- 文本与图片各记一份最近入库哈希；剪贴板不再包含某类型时清空对应哈希，保证「复制 A → 复制 B → 再复制 A」时 A 能重新置顶

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

- **SQLite + WAL**：每条记录增量写入，不再整份重写数据文件；崩溃后由 SQLite 自身保证一致性
- **退出前 checkpoint**：把 WAL 合并回主库，最近一次操作不会随退出丢失
- **损坏文件保留**：库文件打不开时先改名为 `.corrupt-<时间戳>`，不会用空数据覆盖
- **JSON 迁移**：首次启动把旧的 `snappaste-clips.json` 一次性导入，成功后改名为 `.migrated-<时间戳>` 保留

## 🗂 数据存储位置

```
~/Library/Application Support/snappaste/
├── snappaste.db                # 剪切板记录（SQLite，含全文索引）
├── snappaste-settings.json     # 用户设置
└── clipboard-images/           # 图片缓存目录
```

可在「设置 → 数据存储」页查看并跳转到 Finder。

## 📅 更新日志

### v1.0.9 (2026-10-29)
- 🐛 **修复搜索快速切换时结果停在旧关键词**：旧实现用 `isLoading` 直接丢弃新请求，请求一慢，最后一次输入就发不出去；改为请求序号，只有最后一次请求写状态，旧结果自动作废
- ⚡️ **剪贴板停留图片时不再每秒重新 PNG 压缩**：改用原始位图比对是否换图，编码次数从「每秒一次」降到「换图时一次」
- 🐛 **启动时剪贴板里已有的图片不再被重复收录**（此前只记了文字的 hash，图片会在首轮轮询被当成新内容）
- 🐛 **图片缓存加双重上限**（80 条 / 24MB 字符），长时间滚动不再让内存无限增长
- 🔒 读图与「在访达中显示」的路径校验改用 `path.relative`，避免 `clipboard-images-xxx/` 这类同级目录靠前缀绕过
- 🧹 `.codebuddy/` 加入忽略列表，不再纳入版本库

### v1.0.8 (2026-10-29)
- 🗄️ **持久化从 JSON 迁移到 SQLite**（better-sqlite3 + WAL）：新增/删除/收藏只写单条记录，不再整份重写几十 MB 的数据文件
- ⚡️ 搜索改走 FTS5 全文索引（trigram，中文按子串匹配；少于 3 个字符回退 LIKE），实测 15k 条 / 19MB 内容下从 27–41ms 降到 0.2–20ms
- ⚡️ 删除、收藏从约 59ms 降到亚毫秒，且不再阻塞主进程
- 🛡️ 首次启动自动导入旧 JSON，成功后改名为 `snappaste-clips.json.migrated-<时间戳>` 保留，不删除
- 🛡️ 数据库文件打不开时先改名为 `.corrupt-<时间戳>` 保留，不会用空数据覆盖
- 🐛 条数与保留天数限制改动后立即生效（此前要等累计 10 次新增才触发清理）

### v1.0.7 (2026-10-29)
- 🛡️ **修复数据可能被写坏/丢失**：后台防抖写盘与删除、收藏的写盘互相覆盖（已删除的记录会被写回、新复制的记录会丢），改为写盘串行化，进行中再有改动则写完后补写最新快照
- 🛡️ 数据文件读取失败时不再用空数据开局覆盖原文件，先改名为 `.corrupt-<时间戳>` 保留；连改名也失败则本次运行不写盘
- 🛡️ 退出应用时同步保存最近 1 秒内尚未落盘的改动
- 🐛 修复 v1.0.6 引入的回归：「复制图 A → 复制文字 → 再复制图 A」第二次不会置顶、看起来像没记录；文字同理
- ⚡️ 删除、收藏不再同步写 30MB+ 的数据文件阻塞主进程

### v1.0.6 (2026-10-26)
- 🐛 **图文混排不再丢图**：从 Word / 浏览器复制含图片的段落时，文字与图片各存一条记录（此前图片被静默丢弃）
- 🐛 删除记录（超出条数/天数限制）时同步删除对应图片文件，不再遗留孤儿图片
- ⚡️ 图片检测限频每秒一次，剪贴板停留图片时不再每轮重复编码与计算哈希
- 🔧 移除无效的 `changeCount` 快路径调用（Electron 未暴露该接口，原分支从未生效）

### v1.0.5 (2026-05-29)
- 🎯 图片预览**智能定位**：根据条目所处位置自动选择上方/下方弹出
- 🐛 修复底部图片项 hover 时大图预览被主窗口下边缘裁切的问题
- 📐 tooltip 高度在 200px ~ 480px 之间随可用空间动态调整，图片按比例缩放

### v1.0.4 (2026-05-29)
- 🐛 修复大图预览 tooltip 宽度被内部内容压缩、显得不够大的问题（CSS 优先级与 `width: auto` 收缩问题）

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
