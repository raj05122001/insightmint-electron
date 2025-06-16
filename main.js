const { app, BrowserWindow, Tray, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const chokidar = require('chokidar');
const fs = require('fs');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const axios = require('axios');

let tray = null;
let summaryWindow = null;
const WATCH_DIR = app.getPath('documents');
const SUPPORTED = ['.pdf', '.docx', '.doc'];

// File association के लिए protocol handler
app.setAsDefaultProtocolClient('insightmint');

// 1️⃣ Create Tray + Context Menu
function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/tray-icon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Open File...', 
      click: () => openFileDialog() 
    },
    { type: 'separator' },
    { 
      label: 'Quit InsightMint', 
      click: () => app.quit() 
    }
  ]);
  tray.setToolTip('InsightMint is running');
  tray.setContextMenu(contextMenu);
  
  // Tray click करने पर file dialog open करें
  tray.on('click', () => {
    openFileDialog();
  });
}

// File dialog open करने के लिए function
async function openFileDialog() {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx'] },
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'Word Documents', extensions: ['docx'] }
      ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      await processFile(result.filePaths[0]);
    }
  } catch (error) {
    console.error('Error opening file dialog:', error.message);
    showError('Failed to open file dialog');
  }
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false
    }
  });
  summaryWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
}

// 3️⃣ Watcher setup (Documents folder के लिए) with better error handling
function setupWatcher() {
  try {
    const watcher = chokidar.watch(WATCH_DIR, {
      ignored: [
        /(^|[\/\\])\../, // dotfiles
        /My Music/,      // Windows special folders
        /My Pictures/,
        /My Videos/,
        /Desktop.ini/,
        /Thumbs.db/,
        /~*/             // temp files
      ], 
      persistent: true,
      depth: 1,        // Reduced depth to avoid permission issues
      ignorePermissionErrors: true,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100
      }
    });

    watcher.on('add', (filePath) => {
      processFile(filePath).catch(err => {
        console.error('Error processing added file:', err.message);
      });
    });
    
    watcher.on('change', (filePath) => {
      processFile(filePath).catch(err => {
        console.error('Error processing changed file:', err.message);
      });
    });

    watcher.on('error', (error) => {
      console.warn('Watcher error (ignoring):', error.message);
      // Don't crash the app, just log the error
    });

    watcher.on('ready', () => {
      console.log(`✅ Successfully watching directory: ${WATCH_DIR}`);
    });
    
    return watcher;
    
  } catch (error) {
    console.warn('Failed to setup file watcher:', error.message);
    console.log('File watching disabled, but manual file selection will still work.');
    return null;
  }
}

// 4️⃣ Process file function with better error handling
async function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED.includes(ext)) return;

  console.log(`Processing file: ${filePath}`);
  
  try {
    let text = '';
    
    // Check if file exists and is readable
    if (!fs.existsSync(filePath)) {
      console.error('File does not exist:', filePath);
      return;
    }

    const data = fs.readFileSync(filePath);

    if (ext === '.pdf') {
      const pdfData = await pdf(data);
      text = pdfData.text;
    }
    else if (ext === '.docx') {
      const { value } = await mammoth.extractRawText({ buffer: data });
      text = value;
    }

    console.log(`Extracted ${text.length} characters from ${path.basename(filePath)}`);

    if (text.trim().length === 0) {
      showError('No text found in the document');
      return;
    }

    // API call के लिए try-catch
    let summary;
    try {
      const response = await axios.post('http://127.0.0.1:8000/summarize', 
        { text }, 
        { timeout: 30000 }
      );
      summary = response.data.summary;
    } catch (apiError) {
      console.error('API Error:', apiError.message);
      // Fallback: Simple text truncation
      summary = createSimpleSummary(text);
    }

    // 5️⃣ Show in UI
    summaryWindow.webContents.send('show-summary', { 
      file: path.basename(filePath), 
      summary 
    });
    summaryWindow.show();
    
    // Auto-hide after 10 seconds
    setTimeout(() => {
      if (summaryWindow && summaryWindow.isVisible()) {
        summaryWindow.hide();
      }
    }, 10000);

  } catch (err) {
    console.error('Error processing', filePath, err);
    showError(`Error processing file: ${err.message}`);
  }
}

// Simple summary fallback
function createSimpleSummary(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const firstFew = sentences.slice(0, 3).join('. ');
  return firstFew.length > 200 ? firstFew.substring(0, 200) + '...' : firstFew;
}

// Error notification
function showError(message) {
  summaryWindow.webContents.send('show-summary', { 
    file: 'Error', 
    summary: message 
  });
  summaryWindow.show();
  
  setTimeout(() => {
    if (summaryWindow && summaryWindow.isVisible()) {
      summaryWindow.hide();
    }
  }, 5000);
}

// 6️⃣ App lifecycle
app.whenReady().then(() => {
  createTray();
  createSummaryWindow();
  
  // Setup watcher with error handling
  const watcher = setupWatcher();
  
  // Command line arguments से file open करना
  const argv = process.argv;
  if (argv.length > 1) {
    const filePath = argv[argv.length - 1];
    if (fs.existsSync(filePath) && SUPPORTED.includes(path.extname(filePath).toLowerCase())) {
      processFile(filePath).catch(err => {
        console.error('Error processing command line file:', err.message);
      });
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSummaryWindow();
  });
});

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Promise Rejection (ignoring):', reason?.message || reason);
  // Don't crash the app
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
  // Don't crash the app for minor errors
});

// Second instance prevention
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // दूसरी instance की command line arguments check करें
    const filePath = commandLine[commandLine.length - 1];
    if (fs.existsSync(filePath) && SUPPORTED.includes(path.extname(filePath).toLowerCase())) {
      processFile(filePath);
    }
  });
}

app.on('window-all-closed', (e) => {
  // Keep app alive in tray
  e.preventDefault();
});

// File association के लिए
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  processFile(filePath);
});