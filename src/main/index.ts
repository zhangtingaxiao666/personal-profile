import { app, BrowserWindow, Menu, shell } from 'electron'
import path from 'path'
import { registerIpc } from './ipc'

// 固定 userData 路径为 %APPDATA%/个人画像，避免开发模式与打包模式或版本更新因目录名变化导致数据不一致
app.setPath('userData', path.join(app.getPath('appData'), '个人画像'))

let win: BrowserWindow | null = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: '个人画像',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    registerIpc(() => win)
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
