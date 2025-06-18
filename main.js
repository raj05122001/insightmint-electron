// main.js - InsightMint Enhanced File Association Version
const { app, BrowserWindow, Tray, Menu, dialog, shell, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FileAccessMonitor = require('./src/FileAccessMonitor');
const { createSummaryWindow, createTrayIcon } = require('./src/windowManager');
const { logFileAccess, setupLogging } = require('./src/logger');

// Configuration
const CONFIG = {
  SUPPORTED_EXTENSIONS: ['.pdf', '.docx', '.doc'],
  API_BASE_URL: 'http://127.0.0.1:8000',
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  API_TIMEOUT: 120000, // 2 minutes
  AUTO_HIDE_DELAY: 60000, // 1 minute
  ERROR_DISPLAY_DURATION: 8000 // 8 seconds
};

// Global state
let summaryWindow = null;
let tray = null;
let isAPIHealthy = false;
let fileMonitor = null;

// ─── 🔧 Utility Functions ──────────────────────────────────────────
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

function showError(message, duration = CONFIG.ERROR_DISPLAY_DURATION) {
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

// ─── 🔄 API Health Check ──────────────────────────────────────────
async function checkAPIHealth() {
  try {
    const response = await axios.get(`${CONFIG.API_BASE_URL}/health`, {
      timeout: 5000
    });
    
    if (response.status === 200) {
      isAPIHealthy = true;
      console.log('✅ API server is healthy');
      return true;
    }
  } catch (error) {
    isAPIHealthy = false;
    console.log('❌ API server is not responding');
  }
  return false;
}

// ─── 📄 File Processing Pipeline ──────────────────────────────────
async function processFile(filePath, metadata = {}) {
  const ext = path.extname(filePath).toLowerCase();
  
  // Validate file
  if (!CONFIG.SUPPORTED_EXTENSIONS.includes(ext)) {
    console.log('⏭️ Unsupported file type:', ext);
    return;
  }
  
  if (!fs.existsSync(filePath)) {
    console.warn('⚠️ File not found:', filePath);
    return;
  }
  
  // Check file size
  const stats = fs.statSync(filePath);
  if (stats.size > CONFIG.MAX_FILE_SIZE) {
    showError(`File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB\nMaximum size: 50MB`);
    return;
  }
  
  console.log(`🔄 Processing: ${path.basename(filePath)} (${(stats.size / 1024).toFixed(1)}KB)`);
  console.log(`📍 Source: ${metadata.source || 'Direct'}`);
  console.log(`📖 Detected by: ${metadata.detectedBy || 'File System'}`);
  
  // Ensure window is visible
  if (summaryWindow && !summaryWindow.isVisible()) {
    safelyShow();
  }
  
  try {
    // Check API health
    if (!isAPIHealthy) {
      console.log('🔍 Checking API health...');
      await checkAPIHealth();
      
      if (!isAPIHealthy) {
        showError('Summary service is not available.\nPlease start the API server on port 8000.');
        return;
      }
    }
    
    // Show processing indicator
    const processingMessage = createProcessingMessage(metadata);
    safelySend('show-summary', {
      file: path.basename(filePath),
      summary: processingMessage,
      isProcessing: true
    });
    
    // Process file
    const summary = await processFileWithAPI(filePath, ext);
    const enhancedSummary = addMetadataToSummary(summary, metadata);
    
    // Show results
    safelySend('show-summary', {
      file: path.basename(filePath),
      summary: enhancedSummary,
      filePath: filePath,
      fileSize: `${(stats.size / 1024).toFixed(1)}KB`,
      isSuccess: true
    });
    
    safelyShow();
    
    // Auto-hide timer
    setTimeout(() => {
      if (summaryWindow && summaryWindow.isVisible() && !summaryWindow.isFocused()) {
        summaryWindow.hide();
      }
    }, CONFIG.AUTO_HIDE_DELAY);
    
    console.log('✅ File processed successfully:', path.basename(filePath));
    
  } catch (error) {
    console.error('❌ Error processing file:', error);
    showError(formatProcessingError(error));
  }
}

function createProcessingMessage(metadata) {
  let message = '🔄 Processing document...\nPlease wait while we generate your summary.';
  
  if (metadata.detectedBy) {
    message += `\n\n📖 Opened in: ${metadata.detectedBy}`;
  }
  if (metadata.source) {
    message += `\n📍 Source: ${metadata.source}`;
  }
  
  return message;
}

async function processFileWithAPI(filePath, ext) {
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const fileName = path.basename(filePath);
  
  const response = await axios.post(
    `${CONFIG.API_BASE_URL}/summarize-file-base64`,
    {
      fileData: base64,
      fileName: fileName,
      fileType: ext
    },
    {
      timeout: CONFIG.API_TIMEOUT,
      headers: { 'Content-Type': 'application/json' }
    }
  );
  
  return response.data.summary || 'No summary was generated for this document.';
}

function addMetadataToSummary(summary, metadata) {
  if (!metadata.detectedBy && !metadata.source) {
    return summary;
  }
  
  let enhancedSummary = summary + '\n\n─────────────────────';
  
  if (metadata.detectedBy) {
    enhancedSummary += `\n📖 Opened in: ${metadata.detectedBy}`;
  }
  if (metadata.source) {
    enhancedSummary += `\n📍 Detected by: ${metadata.source}`;
  }
  if (metadata.processInfo) {
    enhancedSummary += `\n🔧 Process: ${metadata.processInfo}`;
  }
  
  return enhancedSummary;
}

function formatProcessingError(error) {
  if (error.response) {
    return error.response.data?.error || `API Error: ${error.response.status}`;
  } else if (error.code === 'ECONNREFUSED') {
    isAPIHealthy = false;
    return 'Cannot connect to summary service.\nPlease start the API server.';
  } else if (error.code === 'ECONNABORTED') {
    return 'Processing timeout.\nThe document might be too complex.';
  } else {
    return `Error: ${error.message}`;
  }
}

// ─── 🎯 File Monitor Integration ──────────────────────────────────
function setupFileMonitoring() {
  fileMonitor = new FileAccessMonitor();
  
  fileMonitor.on('fileOpened', (fileInfo) => {
    console.log('\n🎯 FILE ACCESS DETECTED!');
    console.log(`📄 File: ${fileInfo.fileName}`);
    console.log(`📖 Reader: ${fileInfo.readerApplication}`);
    console.log(`📍 Source: ${fileInfo.source}`);
    
    // Log the access
    logFileAccess(fileInfo);
    
    // Process the file if it has a valid path
    if (fileInfo.fullPath && fileInfo.fullPath !== 'Unknown (from window title)') {
      const metadata = {
        detectedBy: fileInfo.readerApplication,
        source: fileInfo.source,
        processInfo: `${fileInfo.processName} (${fileInfo.processId})`
      };
      
      // Delay processing slightly to ensure file is fully opened
      setTimeout(() => {
        processFile(fileInfo.fullPath, metadata);
      }, 1000);
    }
  });
  
  fileMonitor.on('error', (error) => {
    console.error('❌ File monitoring error:', error);
  });
  
  // Start monitoring
  fileMonitor.startAdvancedMonitoring();
  console.log('🔍 File monitoring started');
}

// ─── 📱 IPC Handlers ──────────────────────────────────────────────
function setupIPC() {
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
}

// ─── 🚀 Application Lifecycle ────────────────────────────────────
app.whenReady().then(async () => {
  console.log('🚀 InsightMint is starting...');
  
  // Setup logging
  setupLogging();
  
  // Create windows and tray
  summaryWindow = createSummaryWindow();
  tray = createTrayIcon(summaryWindow);
  
  // Setup IPC
  setupIPC();
  
  // Check API health
  await checkAPIHealth();
  
  // Setup file monitoring
  setupFileMonitoring();
  
  // Handle file associations and command line arguments
  handleFileAssociations();
  
  console.log('✅ InsightMint is ready!');
});

// Handle file associations
function handleFileAssociations() {
  // Handle command line arguments
  const args = process.argv.slice(1);
  const fileToOpen = args.find(arg => 
    CONFIG.SUPPORTED_EXTENSIONS.some(ext => arg.toLowerCase().endsWith(ext))
  );
  
  if (fileToOpen) {
    setTimeout(() => {
      processFile(fileToOpen, { source: 'File Association' });
    }, 2000);
  }
}

// Handle second instance
app.on('second-instance', (event, commandLine, workingDirectory) => {
  // Show window if someone tried to run another instance
  if (summaryWindow) {
    if (summaryWindow.isMinimized()) summaryWindow.restore();
    summaryWindow.focus();
  }
  
  // Handle file from second instance
  const fileToOpen = commandLine.find(arg => 
    CONFIG.SUPPORTED_EXTENSIONS.some(ext => arg.toLowerCase().endsWith(ext))
  );
  
  if (fileToOpen) {
    processFile(fileToOpen, { source: 'Second Instance' });
  }
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('⚠️ Another instance is already running. Exiting...');
  app.quit();
}

// Handle app events
app.on('window-all-closed', (event) => {
  // Prevent app from quitting when all windows are closed (keep in tray)
  event.preventDefault();
});

app.on('before-quit', () => {
  // Cleanup
  if (fileMonitor) {
    fileMonitor.stop();
  }
  
  if (tray) {
    tray.destroy();
  }
  
  console.log('👋 InsightMint is shutting down...');
});

// Handle protocol for file associations (Windows)
app.setAsDefaultProtocolClient('insightmint');

// Export for testing
module.exports = {
  processFile,
  checkAPIHealth,
  CONFIG
};