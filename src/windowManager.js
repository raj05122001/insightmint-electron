// src/windowManager.js - Window and Tray Management
const { BrowserWindow, Tray, Menu, app, shell } = require('electron');
const path = require('path');

function createSummaryWindow() {
  const window = new BrowserWindow({
    width: 500,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  });

  // Load the renderer HTML
  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Window event handlers
  window.on('blur', () => {
    // Auto-hide when window loses focus (after a delay)
    setTimeout(() => {
      if (window && !window.isDestroyed() && !window.isFocused()) {
        window.hide();
      }
    }, 3000);
  });

  window.on('closed', () => {
    // Prevent the window from being destroyed, just hide it
    if (!app.isQuiting) {
      window.hide();
      return false;
    }
  });

  // Development tools
  if (process.env.NODE_ENV === 'development') {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  console.log('✅ Summary window created');
  return window;
}

function createTrayIcon(summaryWindow) {
  // Try to load tray icon
  const iconPath = getTrayIconPath();
  
  try {
    const tray = new Tray(iconPath);
    
    // Tray tooltip
    tray.setToolTip('InsightMint - Document Summary Assistant');
    
    // Tray context menu
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'InsightMint',
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Show Summary Window',
        click: () => {
          if (summaryWindow && !summaryWindow.isDestroyed()) {
            summaryWindow.show();
            summaryWindow.focus();
          }
        }
      },
      {
        label: 'Test File Monitor',
        click: () => {
          testFileMonitor();
        }
      },
      { type: 'separator' },
      {
        label: 'Open Log File',
        click: () => {
          const logPath = path.join(__dirname, '..', 'file_access.log');
          shell.openPath(logPath).catch(() => {
            console.log('Log file not found');
          });
        }
      },
      {
        label: 'About',
        click: () => {
          showAboutDialog();
        }
      },
      { type: 'separator' },
      {
        label: 'Quit InsightMint',
        click: () => {
          app.isQuiting = true;
          app.quit();
        }
      }
    ]);
    
    tray.setContextMenu(contextMenu);
    
    // Tray click events
    tray.on('click', () => {
      if (summaryWindow && !summaryWindow.isDestroyed()) {
        if (summaryWindow.isVisible()) {
          summaryWindow.hide();
        } else {
          summaryWindow.show();
          summaryWindow.focus();
        }
      }
    });
    
    tray.on('double-click', () => {
      if (summaryWindow && !summaryWindow.isDestroyed()) {
        summaryWindow.show();
        summaryWindow.focus();
      }
    });
    
    console.log('✅ Tray icon created');
    return tray;
    
  } catch (error) {
    console.error('❌ Failed to create tray icon:', error);
    return null;
  }
}

function getTrayIconPath() {
  // Try different icon paths based on platform
  const platform = process.platform;
  const assetsDir = path.join(__dirname, '..', 'assets');
  
  let iconName;
  if (platform === 'win32') {
    iconName = 'icon.ico';
  } else if (platform === 'darwin') {
    iconName = 'icon.icns';
  } else {
    iconName = 'icon.png';
  }
  
  const iconPath = path.join(assetsDir, iconName);
  
  // Fallback to a simple icon if assets don't exist
  if (!require('fs').existsSync(iconPath)) {
    // Create a simple 16x16 icon programmatically if needed
    return path.join(__dirname, '..', 'assets', 'icon.png');
  }
  
  return iconPath;
}

function testFileMonitor() {
  console.log('🧪 Testing file monitor...');
  
  // Emit a test event to check if monitoring is working
  const testEvent = {
    fileName: 'test-document.pdf',
    fullPath: path.join(require('os').homedir(), 'Documents', 'test-document.pdf'),
    extension: '.pdf',
    readerApplication: 'Test Application',
    processName: 'test.exe',
    processId: 12345,
    windowTitle: 'Test Document - Test Application',
    timestamp: new Date().toISOString(),
    source: 'Manual Test'
  };
  
  // Note: This would typically emit through the file monitor
  console.log('Test event:', testEvent);
}

function showAboutDialog() {
  const { dialog } = require('electron');
  
  dialog.showMessageBox({
    type: 'info',
    title: 'About InsightMint',
    message: 'InsightMint',
    detail: `Version: 1.0.0
    
Document Summary Assistant

InsightMint automatically detects when you open PDF or Word documents and provides instant AI-powered summaries.

Features:
• Automatic file detection
• AI-powered summaries
• Multiple reader support
• Background monitoring
• Tray integration

© 2024 InsightMint`,
    buttons: ['OK'],
    defaultId: 0
  });
}

// Window positioning utilities
function centerWindow(window) {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  const windowBounds = window.getBounds();
  const x = Math.round((width - windowBounds.width) / 2);
  const y = Math.round((height - windowBounds.height) / 2);
  
  window.setPosition(x, y);
}

function positionWindowNearCursor(window) {
  const { screen } = require('electron');
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  
  const windowBounds = window.getBounds();
  const workArea = display.workArea;
  
  // Position window near cursor but ensure it stays within work area
  let x = cursorPoint.x + 20;
  let y = cursorPoint.y + 20;
  
  // Adjust if window would go off screen
  if (x + windowBounds.width > workArea.x + workArea.width) {
    x = cursorPoint.x - windowBounds.width - 20;
  }
  
  if (y + windowBounds.height > workArea.y + workArea.height) {
    y = cursorPoint.y - windowBounds.height - 20;
  }
  
  // Ensure minimum position
  x = Math.max(workArea.x, x);
  y = Math.max(workArea.y, y);
  
  window.setPosition(x, y);
}

// Window state management
function saveWindowState(window) {
  const bounds = window.getBounds();
  const isMaximized = window.isMaximized();
  
  // Save to electron-store or localStorage equivalent
  return { bounds, isMaximized };
}

function restoreWindowState(window, savedState) {
  if (savedState && savedState.bounds) {
    const { x, y, width, height } = savedState.bounds;
    
    // Validate bounds are within current screen setup
    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    const validDisplay = displays.find(display => {
      const area = display.workArea;
      return x >= area.x && y >= area.y && 
             x < area.x + area.width && y < area.y + area.height;
    });
    
    if (validDisplay) {
      window.setBounds({ x, y, width, height });
      
      if (savedState.isMaximized) {
        window.maximize();
      }
    } else {
      centerWindow(window);
    }
  } else {
    centerWindow(window);
  }
}

module.exports = {
  createSummaryWindow,
  createTrayIcon,
  centerWindow,
  positionWindowNearCursor,
  saveWindowState,
  restoreWindowState,
  showAboutDialog
};