# 藏文阅读器 · Tibetan Reader (Desktop)

Electron 桌面应用封装，将 Flask Web 应用打包为跨平台可执行程序。

## 快速开始

```bash
# 1. 安装依赖
cd electron
npm install

# 2. 开发模式运行（需要先启动 Flask 后端）
# 在另一个终端：
cd ../backend
python3 app.py

# 然后：
cd ../electron
npm start

# 或者一键启动（Electron 会自动启动 Flask）：
npm start
```

## 打包为可执行文件

### Linux (.AppImage / .deb)

```bash
cd electron
npm run build:linux
```

输出在 `electron/dist/` 目录：
- `藏文阅读器-1.0.0.AppImage` — 便携版，双击运行
- `藏文阅读器_1.0.0_amd64.deb` — Debian/Ubuntu 安装包

### Windows (.exe 安装包)

```bash
cd electron
npm run build:win
```

### macOS (.dmg)

```bash
cd electron
npm run build:mac
```

## 打包说明

打包时会将以下目录包含在可执行文件中：
- `backend/` — Flask 后端（Python 代码）
- `data/` — PDF 和文本数据
- `frontend/` — 前端静态文件

**注意**：打包后的应用需要系统已安装 Python 3 和 `pdftoppm`（poppler-utils）。
如需完全独立分发，可使用 PyInstaller 将 Flask 后端也打包为可执行文件。
