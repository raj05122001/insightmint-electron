const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const chokidar = require('chokidar');
const fs = require('fs');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const axios = require('axios');

let tray = null;
let summaryWindow = null;
const WATCH_DIR = app.getPath('documents');
const SUPPORTED = ['.pdf', '.docx'];

// 1️⃣ Create Tray + Context Menu
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/tray-icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Quit InsightMint', click: () => app.quit() }
  ]);
  tray.setToolTip('InsightMint is running');
  tray.setContextMenu(contextMenu);
}

// 2️⃣ Create a hidden summary window
function createSummaryWindow() {
  summaryWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  summaryWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
}

// 3️⃣ Watcher setup
function setupWatcher() {
  const watcher = chokidar.watch(WATCH_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    depth: 0
  });

  watcher.on('add', processFile);
  watcher.on('change', processFile);
}

async function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED.includes(ext)) return;

  try {
    let text = '';
    const data = fs.readFileSync(filePath);

    if (ext === '.pdf') {
      const pdfData = await pdf(data);
      text = pdfData.text;
    }
    else if (ext === '.docx') {
      const { value } = await mammoth.extractRawText({ buffer: data });
      text = value;
    }

    // 4️⃣ Send to summarization API
    const { data: { summary } } = await axios.post('http://127.0.0.1:8000/summarize', { text });

    // 5️⃣ Show in UI
    summaryWindow.webContents.send('show-summary', { file: path.basename(filePath), summary });
    summaryWindow.show();
  }
  catch (err) {
    console.error('Error processing', filePath, err);
  }
}

// 6️⃣ App lifecycle
app.whenReady().then(() => {
  createTray();
  createSummaryWindow();
  setupWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSummaryWindow();
  });
});

app.on('window-all-closed', (e) => {
  // Keep app alive in tray
  e.preventDefault();
});
