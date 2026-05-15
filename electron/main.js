/**
 * Tibetan Reader - Electron Main Process
 * Wraps the Flask backend as a desktop application.
 * 
 * Usage:
 *   npm install
 *   npm start          # development
 *   npm run build      # package for distribution
 */

const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Keep a global reference of the window object
let mainWindow = null;
let flaskProcess = null;
const FLASK_PORT = 5000;

// Determine if running in development or packaged mode
const isDev = !app.isPackaged;

// Paths
const BACKEND_DIR = isDev
    ? path.join(__dirname, '..', 'backend')
    : path.join(process.resourcesPath, 'backend');

const PYTHON = isDev ? 'python3' : path.join(process.resourcesPath, 'python', 'python3');

function startFlask() {
    return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env, {
            FLASK_PORT: String(FLASK_PORT),
        });

        flaskProcess = spawn(PYTHON, ['app.py'], {
            cwd: BACKEND_DIR,
            env: env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        flaskProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('[Flask]', output);
            // Resolve when server is ready
            if (output.includes('Running on') || output.includes('* Running')) {
                resolve();
            }
        });

        flaskProcess.stderr.on('data', (data) => {
            const output = data.toString();
            console.log('[Flask]', output);
            // Flask prints server URL to stderr in debug mode
            if (output.includes('Running on') || output.includes('* Running')) {
                resolve();
            }
        });

        flaskProcess.on('error', (err) => {
            console.error('[Flask] Failed to start:', err);
            reject(err);
        });

        flaskProcess.on('exit', (code) => {
            console.log('[Flask] Exited with code:', code);
            flaskProcess = null;
        });

        // Timeout after 15 seconds
        setTimeout(() => {
            resolve(); // Try to connect anyway
        }, 15000);
    });
}

function stopFlask() {
    if (flaskProcess) {
        flaskProcess.kill('SIGTERM');
        flaskProcess = null;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: '藏文阅读器 · Tibetan Reader',
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    // Build the application menu
    const menuTemplate = [
        {
            label: '文件',
            submenu: [
                {
                    label: '打开阅读器',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        mainWindow.loadURL(`http://127.0.0.1:${FLASK_PORT}/reader`);
                    },
                },
                {
                    label: '返回首页',
                    accelerator: 'CmdOrCtrl+H',
                    click: () => {
                        mainWindow.loadURL(`http://127.0.0.1:${FLASK_PORT}/`);
                    },
                },
                { type: 'separator' },
                {
                    label: '退出',
                    accelerator: 'CmdOrCtrl+Q',
                    click: () => app.quit(),
                },
            ],
        },
        {
            label: '视图',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '关于',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: '关于 藏文阅读器',
                            message: '藏文阅读器 · Tibetan Reader',
                            detail: '德格版《四部医典》OCR阅读器\n\n基于 Flask + Electron 构建',
                        });
                    },
                },
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    // Load the app
    mainWindow.loadURL(`http://127.0.0.1:${FLASK_PORT}/`);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// App lifecycle
app.whenReady().then(async () => {
    try {
        console.log('Starting Flask backend...');
        await startFlask();
        console.log('Flask backend started. Creating window...');
        createWindow();
    } catch (err) {
        console.error('Failed to start:', err);
        dialog.showErrorBox('启动失败', `无法启动后端服务: ${err.message}`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    stopFlask();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('before-quit', () => {
    stopFlask();
});
