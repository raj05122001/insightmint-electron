// main.js - InsightMint Enhanced File Association Version
const { app, BrowserWindow, Tray, Menu, dialog, shell, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const axios = require('axios');

// Supported document extensions
const SUPPORTED = ['.pdf', '.docx', '.doc'];
const API_BASE_URL = 'http://127.0.0.1:8000';

// Globals
let tray = null;
let summaryWindow = null;
let fileWatcher = null;
let isAPIHealthy = false;
let isWatcherEnabled = true; // New flag to control auto-processing

// Check if app started in hidden mode
const startHidden = process.argv.includes('--hidden') || process.argv.includes('--startup');

// ─── 🚀 App Initialization ─────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log('🚀 InsightMint starting...');
  
  // Register custom protocol for browser integration
  setupCustomProtocol();
  
  // Check API health first
  await checkAPIHealth();
  
  // Initialize core components
  createTray();
  createSummaryWindow();
  
  // Setup file watcher (but make it optional)
  if (isWatcherEnabled) {
    setupFileWatcher();
  }
  
  setupAutoStart();
  setupFileAssociations();
  
  // Process launch arguments if not started hidden
  if (!startHidden) {
    processLaunchArguments();
  }
  
  console.log('✅ InsightMint ready!');
});

// ─── 🔗 Custom Protocol Setup for Browser Integration ──────────────────
function setupCustomProtocol() {
  // Register insightmint:// protocol
  protocol.registerHttpProtocol('insightmint', (request, callback) => {
    const url = request.url;
    console.log('📎 Custom protocol received:', url);
    
    // Parse insightmint://process?file=path/to/file.pdf
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === 'process') {
        const filePath = decodeURIComponent(urlObj.searchParams.get('file') || '');
        if (filePath && fs.existsSync(filePath)) {
          processFile(filePath);
        }
      }
    } catch (error) {
      console.error('❌ Protocol parsing error:', error);
    }
    
    callback({ statusCode: 200 });
  });
}

// ─── 🔧 Enhanced File Associations Setup ─────────────────────────────
function setupFileAssociations() {
  if (!app.isPackaged) {
    console.log('🔧 Development mode - skipping file associations');
    return;
  }

  try {
    // Set as default protocol client
    app.setAsDefaultProtocolClient('insightmint');
    
    // For Windows: Register file associations via registry
    if (process.platform === 'win32') {
      setupWindowsFileAssociations();
    }
    
    console.log('✅ File associations configured');
  } catch (error) {
    console.warn('⚠️ Could not configure file associations:', error.message);
  }
}

function setupWindowsFileAssociations() {
  // This would typically be done during installation
  // For runtime, we can at least register the protocol
  try {
    const execPath = process.execPath;
    const appName = 'InsightMint';
    
    // Register application
    app.setAsDefaultProtocolClient('insightmint', execPath, ['--process-file']);
    
    console.log('✅ Windows associations registered');
  } catch (error) {
    console.warn('⚠️ Windows association error:', error);
  }
}

// ─── 🔍 API Health Check ──────────────────────────────────────────────
async function checkAPIHealth() {
  try {
    console.log('🔍 Checking API health...');
    const response = await axios.get(`${API_BASE_URL}/health`, { 
      timeout: 5000 
    });
    isAPIHealthy = response.status === 200;
    console.log(`✅ API Server is ${isAPIHealthy ? 'healthy' : 'unhealthy'}`);
  } catch (error) {
    isAPIHealthy = false;
    console.warn('⚠️ API Server not responding:', error.message);
    
    // Show warning but don't block app startup
    if (!startHidden) {
      setTimeout(() => {
        showError('API Server not running on port 8000.\nPlease start the summary service.');
      }, 2000);
    }
  }
  return isAPIHealthy;
}

// ─── 🔧 Auto-Start Configuration ─────────────────────────────────────
function setupAutoStart() {
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ['--startup', '--hidden']
      });
      console.log('✅ Auto-start configured');
    } catch (error) {
      console.warn('⚠️ Could not configure auto-start:', error.message);
    }
  }
}

// ─── 📄 Enhanced Launch Arguments Processing ────────────────────────
function processLaunchArguments() {
  const args = process.argv.slice(1);
  console.log('📋 Launch arguments:', args);
  
  // Look for --process-file flag (from file association)
  const processFileIndex = args.indexOf('--process-file');
  if (processFileIndex !== -1 && args[processFileIndex + 1]) {
    const filePath = args[processFileIndex + 1];
    console.log('📄 Processing file from association:', filePath);
    processFile(filePath);
    return;
  }
  
  // Look for file arguments
  const fileArg = args.find(arg => {
    if (!arg || arg.startsWith('-')) return false;
    
    const ext = path.extname(arg).toLowerCase();
    const isSupported = SUPPORTED.includes(ext);
    const exists = fs.existsSync(arg);
    
    if (isSupported && !exists) {
      console.warn('⚠️ File not found:', arg);
    }
    
    return isSupported && exists;
  });
  
  if (fileArg) {
    console.log('📄 Processing launch file:', fileArg);
    processFile(fileArg);
  } else {
    console.log('ℹ️ No valid file argument provided');
  }
}

// ─── 🖼️ Enhanced Tray with File Watcher Toggle ─────────────────────
function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    
    // Fallback icon if file doesn't exist
    if (!fs.existsSync(iconPath)) {
      console.warn('⚠️ Tray icon not found, using default');
    }
    
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'InsightMint',
        enabled: false,
        icon: path.join(__dirname, 'assets', 'menu-icon.png')
      },
      { type: 'separator' },
      {
        label: 'Open File…',
        accelerator: 'CmdOrCtrl+O',
        click: openFileDialog
      },
      {
        label: 'Auto-Process New Files',
        type: 'checkbox',
        checked: isWatcherEnabled,
        click: (item) => {
          isWatcherEnabled = item.checked;
          if (isWatcherEnabled && !fileWatcher) {
            setupFileWatcher();
          } else if (!isWatcherEnabled && fileWatcher) {
            fileWatcher.close();
            fileWatcher = null;
          }
          console.log(`📁 File watcher ${isWatcherEnabled ? 'enabled' : 'disabled'}`);
        }
      },
      {
        label: 'API Status',
        submenu: [
          {
            label: isAPIHealthy ? '✅ Connected' : '❌ Disconnected',
            enabled: false
          },
          {
            label: 'Test Connection',
            click: async () => {
              const healthy = await checkAPIHealth();
              showNotification(
                healthy ? 'API Connected Successfully' : 'API Connection Failed',
                healthy ? 'Summary service is running' : 'Please start the summary service'
              );
            }
          }
        ]
      },
      { type: 'separator' },
      {
        label: 'Settings',
        submenu: [
          {
            label: 'Auto-start',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => {
              app.setLoginItemSettings({
                openAtLogin: item.checked,
                path: process.execPath,
                args: item.checked ? ['--startup', '--hidden'] : []
              });
            }
          },
          {
            label: 'Open Documents Folder',
            click: () => shell.openPath(app.getPath('documents'))
          },
          {
            label: 'Install File Associations',
            click: setupFileAssociations
          }
        ]
      },
      { type: 'separator' },
      {
        label: 'About InsightMint',
        click: showAbout
      },
      {
        label: 'Quit InsightMint',
        accelerator: 'CmdOrCtrl+Q',
        click: () => {
          app.isQuiting = true;
          app.quit();
        }
      }
    ]);
    
    tray.setToolTip('InsightMint - Document Summary Assistant');
    tray.setContextMenu(contextMenu);
    
    // Single click to open file dialog
    tray.on('click', openFileDialog);
    
    // Double click to show/hide summary window
    tray.on('double-click', () => {
      if (summaryWindow) {
        if (summaryWindow.isVisible()) {
          summaryWindow.hide();
        } else {
          summaryWindow.show();
        }
      }
    });
    
    console.log('✅ Tray created');
  } catch (error) {
    console.error('❌ Failed to create tray:', error);
  }
}

// ─── 📂 File Dialog ──────────────────────────────────────────────────
async function openFileDialog() {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Open Document for Summary',
      properties: ['openFile'],
      filters: [
        { name: 'All Supported', extensions: ['pdf', 'docx', 'doc'] },
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'Word Documents', extensions: ['docx', 'doc'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      defaultPath: app.getPath('documents')
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      console.log('📂 User selected file:', filePath);
      processFile(filePath);
    }
  } catch (error) {
    console.error('❌ Error opening file dialog:', error);
    showError('Unable to open file dialog: ' + error.message);
  }
}

// ─── 🖥️ Summary Window Creation ─────────────────────────────────────
function createSummaryWindow() {
  try {
    summaryWindow = new BrowserWindow({
      width: 480,
      height: 380,
      show: false,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      transparent: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        enableRemoteModule: false,
        nodeIntegration: false
      }
    });
    
    summaryWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    
    // Handle window close
    summaryWindow.on('close', (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        summaryWindow.hide();
      }
    });
    
    // Auto-hide after losing focus (optional)
    summaryWindow.on('blur', () => {
      setTimeout(() => {
        if (summaryWindow && summaryWindow.isVisible() && !summaryWindow.isFocused()) {
          summaryWindow.hide();
        }
      }, 3000);
    });
    
    console.log('✅ Summary window created');
  } catch (error) {
    console.error('❌ Failed to create summary window:', error);
  }
}

// ─── 📁 Optional File Watcher Setup ─────────────────────────────────
function setupFileWatcher() {
  if (fileWatcher) {
    fileWatcher.close();
  }
  
  try {
    const watchDir = app.getPath('documents');
    const skipDirs = new Set([
      'My Music', 'My Pictures', 'My Videos',
      'node_modules', '.git', 'temp', 'cache'
    ]);
    
    fileWatcher = chokidar.watch(watchDir, {
      ignored: (incomingPath) => {
        const base = path.basename(incomingPath);
        const isHidden = base.startsWith('.') || base.startsWith('~');
        const isSkipped = skipDirs.has(base);
        const isTempFile = base.includes('tmp') || base.includes('temp');
        
        return isHidden || isSkipped || isTempFile;
      },
      persistent: true,
      depth: 2,
      ignorePermissionErrors: true,
      awaitWriteFinish: {
        stabilityThreshold: 30000,
        pollInterval: 200
      }
    });
    
    fileWatcher.on('ready', () => {
      console.log('👁️ File watcher ready, watching:', watchDir);
    });
    
    // Only process files if watcher is enabled
    fileWatcher.on('add', (filePath) => {
      if (isWatcherEnabled) {
        console.log('📄 New file detected:', filePath);
        processFile(filePath).catch(console.error);
      }
    });
    
    fileWatcher.on('error', (error) => {
      if (error.code !== 'EPERM' && error.code !== 'EACCES') {
        console.warn('⚠️ Watcher error:', error);
      }
    });
    
  } catch (error) {
    console.error('❌ Failed to setup file watcher:', error);
  }
}

// ─── 🔧 Safe IPC Communication ──────────────────────────────────────
function safelySend(channel, data) {
  try {
    if (summaryWindow && !summaryWindow.isDestroyed()) {
      summaryWindow.webContents.send(channel, data);
      return true;
    }
  } catch (error) {
    console.error('❌ IPC send error:', error);
  }
  return false;
}

function safelyShow() {
  try {
    if (summaryWindow && !summaryWindow.isDestroyed()) {
      summaryWindow.show();
      summaryWindow.focus();
      return true;
    }
  } catch (error) {
    console.error('❌ Window show error:', error);
  }
  return false;
}

// ─── ⚠️ Error Display ──────────────────────────────────────────────
function showError(message, duration = 8000) {
  console.error('❌ InsightMint Error:', message);
  
  if (safelySend('show-summary', {
    file: '⚠️ Error',
    summary: message,
    isError: true
  })) {
    safelyShow();
    
    setTimeout(() => {
      if (summaryWindow && summaryWindow.isVisible()) {
        summaryWindow.hide();
      }
    }, duration);
  }
}

// ─── 📢 Notification Helper ────────────────────────────────────────
function showNotification(title, body) {
  if (safelySend('show-summary', {
    file: title,
    summary: body,
    isNotification: true
  })) {
    safelyShow();
    
    setTimeout(() => {
      if (summaryWindow && summaryWindow.isVisible()) {
        summaryWindow.hide();
      }
    }, 5000);
  }
}

// ─── ℹ️ About Dialog ──────────────────────────────────────────────
function showAbout() {
  const aboutMessage = `InsightMint v1.0.0

Document Summary Assistant

• Automatically processes PDF and Word documents
• Provides AI-generated summaries
• Monitors Documents folder for new files
• Quick preview with overlay window

© 2024 InsightMint. All rights reserved.`;
  
  showNotification('About InsightMint', aboutMessage);
}

// ─── 🔄 Enhanced File Processing Pipeline ──────────────────────────
async function processFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  // Check if file is supported
  if (!SUPPORTED.includes(ext)) {
    console.log('⏭️ Unsupported file type:', ext);
    return;
  }
  
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.warn('⚠️ File not found:', filePath);
    return;
  }
  
  // Check file size (limit to 50MB)
  const stats = fs.statSync(filePath);
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (stats.size > maxSize) {
    showError(`File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB\nMaximum size: 50MB`);
    return;
  }
  
  console.log(`🔄 Processing file: ${path.basename(filePath)} (${(stats.size / 1024).toFixed(1)}KB)`);
  
  // Show app window immediately when file is processed
  if (summaryWindow && !summaryWindow.isVisible()) {
    safelyShow();
  }
  
  try {
    // Check API health before processing
    if (!isAPIHealthy) {
      console.log('🔍 Re-checking API health...');
      await checkAPIHealth();
      
      if (!isAPIHealthy) {
        showError('Summary service is not available.\nPlease start the API server on port 8000.');
        return;
      }
    }
    
    // Show processing indicator
    safelySend('show-summary', {
      file: path.basename(filePath),
      summary: '🔄 Processing document...\nPlease wait while we generate your summary.',
      isProcessing: true
    });
    
    // Read and encode file
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const fileName = path.basename(filePath);
    
    // Send to API
    const response = await axios.post(
      `${API_BASE_URL}/summarize-file-base64`,
      {
        fileData: base64,
        fileName: fileName,
        fileType: ext
      },
      {
        timeout: 120000, // 2 minutes timeout
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    const summary = response.data.summary || 'No summary was generated for this document.';
    
    // Show summary
    safelySend('show-summary', {
      file: fileName,
      summary: summary,
      filePath: filePath,
      fileSize: `${(stats.size / 1024).toFixed(1)}KB`,
      isSuccess: true
    });
    
    // Keep window visible for user interaction
    safelyShow();
    
    // Auto-hide after 60 seconds if user doesn't interact
    setTimeout(() => {
      if (summaryWindow && summaryWindow.isVisible() && !summaryWindow.isFocused()) {
        summaryWindow.hide();
      }
    }, 60000);
    
    console.log('✅ File processed successfully:', fileName);
    
  } catch (error) {
    console.error('❌ Error processing file:', error);
    
    let errorMessage = 'Failed to process document.';
    
    if (error.response) {
      errorMessage = error.response.data?.error || `API Error: ${error.response.status}`;
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Cannot connect to summary service.\nPlease start the API server.';
      isAPIHealthy = false;
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Processing timeout.\nThe document might be too complex.';
    } else {
      errorMessage = `Error: ${error.message}`;
    }
    
    showError(errorMessage);
  }
}

// ─── 🔄 Single Instance Lock ──────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  console.log('⚠️ Another instance is already running. Exiting...');
  app.quit();
}

// ─── 🔚 Enhanced App Lifecycle Events ─────────────────────────────
app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  console.log('👋 InsightMint shutting down...');
  app.isQuiting = true;
  
  if (fileWatcher) {
    fileWatcher.close();
  }
});

// ─── 🍎 Enhanced File Opening Events ───────────────────────────────
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  console.log('🍎 macOS open-file event:', filePath);
  
  if (SUPPORTED.includes(path.extname(filePath).toLowerCase())) {
    processFile(filePath);
  }
});

// Handle Windows file associations
app.on('second-instance', (event, commandLine, workingDirectory) => {
  console.log('🔄 Second instance detected with args:', commandLine);
  
  // Focus summary window if visible
  if (summaryWindow && summaryWindow.isVisible()) {
    summaryWindow.focus();
  }
  
  // Check for --process-file flag
  const processFileIndex = commandLine.indexOf('--process-file');
  if (processFileIndex !== -1 && commandLine[processFileIndex + 1]) {
    const filePath = commandLine[processFileIndex + 1];
    console.log('📄 Processing file from second instance:', filePath);
    processFile(filePath);
    return;
  }
  
  // Look for file arguments
  const fileArg = commandLine.find(arg => {
    const ext = path.extname(arg).toLowerCase();
    return SUPPORTED.includes(ext) && fs.existsSync(arg);
  });
  
  if (fileArg) {
    console.log('📄 Processing file from second instance:', fileArg);
    processFile(fileArg);
  }
});

// Handle URL protocols
app.on('open-url', (event, url) => {
  event.preventDefault();
  console.log('📎 Protocol URL received:', url);
  
  if (url.startsWith('insightmint://')) {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === 'process') {
        const filePath = decodeURIComponent(urlObj.searchParams.get('file') || '');
        if (filePath && fs.existsSync(filePath)) {
          processFile(filePath);
        }
      }
    } catch (error) {
      console.error('❌ URL parsing error:', error);
    }
  }
});

// ─── 🛡️ Global Error Handlers ─────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.warn('⚠️ Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  showError(`Application Error: ${error.message}`);
  
  if (app.isPackaged) {
    return;
  }
  
  process.exit(1);
});

// ─── 📱 IPC Handlers ──────────────────────────────────────────────
ipcMain.handle('open-file-location', async (event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
  } catch (error) {
    console.error('❌ Could not show file in folder:', error);
  }
});

ipcMain.handle('open-file', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    console.log('✅ File opened in default app:', path.basename(filePath));
  } catch (error) {
    console.error('❌ Could not open file:', error);
  }
});

ipcMain.handle('copy-summary', async (event, summary) => {
  try {
    const { clipboard } = require('electron');
    clipboard.writeText(summary);
    return true;
  } catch (error) {
    console.error('❌ Could not copy to clipboard:', error);
    return false;
  }
});

console.log('📄 InsightMint enhanced main.js loaded');