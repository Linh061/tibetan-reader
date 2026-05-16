# 藏文阅读器 · བོད་ཡིག་ཀློག་པ།

> 德格版《四部医典》OCR 藏文典籍阅读器 — 支持词典查词、AI 辅助阅读、PDF 对照

![Flask](https://img.shields.io/badge/Flask-3.0-blue) ![Electron](https://img.shields.io/badge/Electron-28-green) ![Python](https://img.shields.io/badge/Python-3.8+-orange)

---

## 📖 功能概览

| 功能 | 说明 |
|------|------|
| **📚 典籍浏览** | 分页阅读 OCR 识别的藏文文本，支持键盘翻页（← →） |
| **📖 词典查词** | 藏文 → 中文/英文 词典查询，支持模糊匹配和中文/英文反查 |
| **🌐 在线翻译** | 选中文本后自动调用 Google Translate 翻译 |
| **📄 PDF 对照** | 左右分栏同步显示 PDF 扫描件，文本与原文对照阅读 |
| **✏️ 文本编辑** | 直接编辑 OCR 文本并保存修正 |
| **🔍 全文搜索** | 在当前典籍中搜索关键词，点击结果跳转对应页面 |
| **🤖 AI 辅助阅读** | 接入 OpenAI 兼容 API，支持文本解释、翻译、页面总结、自由对话 |
| **🖥️ 桌面应用** | Electron 封装，支持 Linux / Windows / macOS 跨平台打包 |

---

## 🚀 快速开始

### 方式一：Web 浏览器运行

```bash
# 1. 安装 Python 依赖
pip install -r requirements.txt

# 2. 启动后端服务
cd backend
python3 app.py

# 3. 打开浏览器访问
# http://127.0.0.1:5000
```

### 方式二：Electron 桌面应用

```bash
# 1. 安装 Electron 依赖
cd electron
npm install

# 2. 开发模式运行（自动启动 Flask 后端）
npm start
```

### 方式三：一键启动脚本

```bash
./start.sh
```

---

## 🗂️ 项目结构

```
tibetan-reader/
├── backend/                    # Flask 后端
│   ├── app.py                  # 主应用 + API 路由
│   ├── ai_service.py           # AI 辅助阅读服务
│   ├── dictionary_service.py   # 词典查询服务
│   ├── text_service.py         # 文本管理服务
│   └── data/                   # 词典数据
│       ├── Tibetan-Chinese_dictionary.json
│       └── Tibetan-English_dictionary.json
├── frontend/                   # 前端
│   ├── templates/
│   │   ├── index.html          # 首页（典籍选择 + 词典查词）
│   │   └── reader.html         # 阅读页（文本 + PDF + AI）
│   └── static/
│       ├── css/
│       │   ├── style.css       # 全局样式
│       │   └── reader.css      # 阅读页样式
│       ├── js/
│       │   ├── app.js          # 首页逻辑
│       │   └── reader.js       # 阅读页逻辑
│       └── icon.svg
├── data/                       # 数据目录
│   ├── the_four_treatises/     # 《四部医典》数据
│   │   ├── pdfs/               # PDF 扫描件
│   │   ├── pdf_cache/          # PDF 渲染缓存（PNG）
│   │   └── texts/              # OCR 文本（按页码分文件）
│   ├── ai_config.json          # AI 配置
│   └── chat_history/           # AI 对话历史
├── electron/                   # Electron 桌面封装
│   ├── main.js                 # 主进程
│   ├── package.json
│   └── icon.svg
├── requirements.txt
├── start.sh
└── README.md
```

---

## 🎯 核心功能详解

### 📖 词典查词

支持两种词典数据源：
- **藏汉词典** — 藏文 → 中文释义
- **藏英词典** — 藏文 → 英文释义

**查询方式：**
- **藏文输入** — 精确查找 + 模糊匹配（包含查询字符串的所有词条）
- **中文/英文输入** — 自动反查，找到包含该中文/英文释义的藏文词条
- **选中查词** — 在阅读页选中文本，自动弹出词典释义

### 📄 PDF 对照

- 点击工具栏「📄 PDF」按钮打开/关闭 PDF 面板
- 翻页时自动同步到对应的 PDF 页面
- 支持快捷键 `Ctrl+P` 切换

### ✏️ 文本编辑

- 点击「✏️」进入编辑模式，直接修改 OCR 文本
- `Ctrl+S` 保存修改，`Esc` 取消编辑
- 修改内容持久化到服务器

### 🤖 AI 辅助阅读

支持任何 OpenAI 兼容的 API 服务：

| 服务 | API 地址 | 推荐模型 |
|------|----------|----------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Ollama (本地) | `http://localhost:11434/v1` | `llama3` 等 |

**功能：**
- **📖 解释** — 选中文本后点击，AI 解释藏文含义、关键术语和背景
- **🌐 翻译** — 选中文本后点击，AI 翻译为中文
- **📝 总结** — AI 总结当前页面内容
- **💬 自由对话** — 在输入框提问，AI 结合上下文回答
- 对话历史按页面自动保存

### ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `←` / `→` | 上一页 / 下一页 |
| `Ctrl+F` | 搜索 |
| `Ctrl+D` | 查词 |
| `Ctrl+P` | PDF 对照 |
| `Ctrl+I` | AI 辅助阅读 |
| `Ctrl+E` | 编辑模式 |
| `Ctrl+S` | 保存编辑 |

---

## 🔧 配置

### AI 配置

在首页点击「🤖 AI 设置」按钮，配置：
- **API 地址** — OpenAI 兼容 API 的地址
- **API Key** — API 密钥（仅保存在本地）
- **模型名称** — 使用的模型
- **系统提示词** — 自定义 AI 助手的角色设定

配置保存在 `data/ai_config.json`。

### 词典数据

词典文件位于 `backend/data/` 目录：
- `Tibetan-Chinese_dictionary.json` — 藏汉词典
- `Tibetan-English_dictionary.json` — 藏英词典

格式示例：
```json
{
  "tibetan": "བཀྲ་ཤིས་བདེ་ལེགས",
  "chinese": "吉祥如意",
  "english": "good luck and happiness",
  "pos": "名词"
}
```

---

## 📦 打包为桌面应用

### Linux (.AppImage / .deb)

```bash
cd electron
npm run build:linux
```

输出在 `electron/dist/`：
- `藏文阅读器-1.0.0.AppImage` — 便携版，双击运行
- `藏文阅读器_1.0.0_amd64.deb` — Debian/Ubuntu 安装包

### Windows (.exe)

```bash
cd electron
npm run build:win
```

### macOS (.dmg)

```bash
cd electron
npm run build:mac
```

### 打包说明

打包时会将以下目录包含在可执行文件中：
- `backend/` — Flask 后端（Python 代码）
- `data/` — PDF 和文本数据
- `frontend/` — 前端静态文件

> **注意**：打包后的应用需要系统已安装 Python 3 和 `pdftoppm`（poppler-utils）。如需完全独立分发，可使用 PyInstaller 将 Flask 后端也打包为可执行文件。

---

## 📋 依赖

### Python

```
flask>=3.0
flask-cors>=4.0
requests>=2.31
```

可选依赖：
- `googletrans==4.0.0-rc1` — Google Translate 翻译
- `poppler-utils` — PDF 渲染（系统包，提供 `pdftoppm` 命令）

### Node.js (Electron)

```
electron
electron-builder
```

---

## 🛠️ 开发

```bash
# 后端开发（热重载）
cd backend
FLASK_DEBUG=1 python3 app.py

# 前端开发
# 直接修改 frontend/ 下的 HTML/CSS/JS 文件，刷新浏览器即可
```

---

## 📜 数据来源

- **典籍文本**：德格版《四部医典》OCR 识别结果
- **藏汉词典**：基于公开藏文词典数据
- **藏英词典**：基于 kaikki.org Tibetan-English 词典数据

---

## 📄 许可证

MIT License
