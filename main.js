const { app, BrowserWindow, Tray, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const chokidar = require('chokidar');
const fs = require('fs');
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
    width: 450,
    height: 350,
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
  
  // Handle window closed event
  summaryWindow.on('closed', () => {
    console.log('Summary window closed');
  });
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

// Helper function to safely send to renderer
function safelySendToRenderer(channel, data) {
  try {
    if (summaryWindow && !summaryWindow.isDestroyed() && summaryWindow.webContents) {
      summaryWindow.webContents.send(channel, data);
      return true;
    }
  } catch (error) {
    console.error('Error sending to renderer:', error.message);
    return false;
  }
  return false;
}

// Helper function to safely show window
function safelyShowWindow() {
  try {
    if (summaryWindow && !summaryWindow.isDestroyed()) {
      summaryWindow.show();
      return true;
    }
  } catch (error) {
    console.error('Error showing window:', error.message);
    return false;
  }
  return false;
}

// 4️⃣ Process file function - Send file as Base64 with better error handling
async function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED.includes(ext)) return;

  console.log(`Processing file: ${filePath}`);
  
  try {
    // Check if file exists and is readable
    if (!fs.existsSync(filePath)) {
      console.error('File does not exist:', filePath);
      return;
    }

    // Check file size (limit to 25MB for base64 encoding)
    const stats = fs.statSync(filePath);
    const fileSizeMB = stats.size / (1024 * 1024);
    console.log(`File size: ${fileSizeMB.toFixed(2)} MB`);
    
    if (fileSizeMB > 25) {
      showError(`File too large: ${fileSizeMB.toFixed(1)}MB. Maximum size is 25MB.`);
      return;
    }

    // Read file as base64
    console.log('Reading file...');
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const fileName = path.basename(filePath);

    console.log(`Sending file ${fileName} to API server...`);
    console.log(`Base64 data length: ${base64Data.length} characters`);

    // API call to send file data
    let summary;
    try {
      const response = await axios.post('http://127.0.0.1:8000/summarize-file-base64', 
        { 
          fileData: base64Data,
          fileName: fileName,
          fileType: ext
        }, 
        { 
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('✅ API Response received');
      console.log('Response status:', response.status);
      console.log('Response data:', response.data);
      
      summary = response.data.summary;
      console.log('Summary received from API server');
      
    } catch (apiError) {
      console.error('❌ API Error Details:');
      console.error('Status:', apiError.response?.status);
      console.error('Status Text:', apiError.response?.statusText);
      console.error('Error Data:', apiError.response?.data);
      console.error('Error Message:', apiError.message);
      
      if (apiError.response?.data?.error) {
        summary = `❌ API Error: ${apiError.response.data.error}`;
      } else {
        summary = `❌ Connection Error: ${apiError.message}\n\nPlease check if the API server is running.`;
      }
    }

    // 5️⃣ Show in UI with safety checks
    const sent = safelySendToRenderer('show-summary', { 
      file: fileName, 
      summary 
    });
    
    if (sent) {
      safelyShowWindow();
      
      // Auto-hide after 15 seconds (increased from 10)
      setTimeout(() => {
        try {
          if (summaryWindow && !summaryWindow.isDestroyed() && summaryWindow.isVisible()) {
            summaryWindow.hide();
          }
        } catch (error) {
          console.warn('Error auto-hiding window:', error.message);
        }
      }, 15000);
    } else {
      console.error('Failed to send summary to renderer');
    }

  } catch (err) {
    console.error('❌ Error processing file:', filePath);
    console.error('Error details:', err.message);
    console.error('Stack:', err.stack);
    showError(`Error processing file: ${err.message}`);
  }
}

// Error notification with safety checks
function showError(message) {
  console.error('Showing error:', message);
  
  const sent = safelySendToRenderer('show-summary', { 
    file: '⚠️ Error', 
    summary: message 
  });
  
  if (sent) {
    safelyShowWindow();
    
    setTimeout(() => {
      try {
        if (summaryWindow && !summaryWindow.isDestroyed() && summaryWindow.isVisible()) {
          summaryWindow.hide();
        }
      } catch (error) {
        console.warn('Error auto-hiding error window:', error.message);
      }
    }, 8000);
  }
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

// Enhanced global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.warn('⚠️ Unhandled Promise Rejection:');
  console.warn('Reason:', reason?.message || reason);
  console.warn('Promise:', promise);
  // Don't crash the app, but log details
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:');
  console.error('Message:', error.message);
  console.error('Stack:', error.stack);
  
  // Try to show error if possible
  try {
    if (summaryWindow && !summaryWindow.isDestroyed()) {
      showError(`Application Error: ${error.message}`);
    }
  } catch (e) {
    console.error('Could not show error in UI');
  }
  
  // Don't crash for minor errors
  if (!error.message.includes('Object has been destroyed')) {
    console.error('Fatal error, exiting...');
    process.exit(1);
  }
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