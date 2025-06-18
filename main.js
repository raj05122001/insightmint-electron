// main.js - InsightMint Enhanced File Association Version with File Access Monitor
const { app, BrowserWindow, Tray, Menu, dialog, shell, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const { spawn, exec } = require('child_process');
const EventEmitter = require('events');
const os = require('os');

// Supported document extensions
const SUPPORTED = ['.pdf', '.docx', '.doc'];
const API_BASE_URL = 'http://127.0.0.1:8000';

// Globals
let summaryWindow = null;
let isAPIHealthy = false;


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


// ─── 🔄 Enhanced File Processing Pipeline ──────────────────────────
async function processFile(filePath, metadata = {}) {
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
  if (metadata.source) {
    console.log(`📍 Source: ${metadata.source}`);
  }
  if (metadata.detectedBy) {
    console.log(`📖 Detected by: ${metadata.detectedBy}`);
  }
  
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
    
    // Create processing message
    let processingMessage = '🔄 Processing document...\nPlease wait while we generate your summary.';
    if (metadata.detectedBy) {
      processingMessage += `\n\n📖 Opened in: ${metadata.detectedBy}`;
    }
    if (metadata.source) {
      processingMessage += `\n📍 Source: ${metadata.source}`;
    }
    
    // Show processing indicator
    safelySend('show-summary', {
      file: path.basename(filePath),
      summary: processingMessage,
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
    
    let summary = response.data.summary || 'No summary was generated for this document.';
    
    // Add metadata to summary if available
    if (metadata.detectedBy || metadata.source) {
      summary += '\n\n─────────────────────';
      if (metadata.detectedBy) {
        summary += `\n📖 Opened in: ${metadata.detectedBy}`;
      }
      if (metadata.source) {
        summary += `\n📍 Detected by: ${metadata.source}`;
      }
      if (metadata.processInfo) {
        summary += `\n🔧 Process: ${metadata.processInfo}`;
      }
    }
    
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

console.log('📄 InsightMint enhanced main.js with File Access Monitor loaded');

class FileAccessMonitor extends EventEmitter {
    constructor() {
        super();
        this.isMonitoring = false;
        this.targetExtensions = ['.pdf', '.doc', '.docx'];
        this.processMap = new Map();
        this.fileWatchers = new Map();
        this.debugMode = true; // Enable debug logging
        this.readerApps = {
            'AcroRd32.exe': 'Adobe Acrobat Reader',
            'Acrobat.exe': 'Adobe Acrobat', 
            'AcroRd32': 'Adobe Acrobat Reader',
            'Acrobat': 'Adobe Acrobat',
            'WINWORD.EXE': 'Microsoft Word',
            'WINWORD': 'Microsoft Word',
            'chrome.exe': 'Google Chrome',
            'chrome': 'Google Chrome',
            'firefox.exe': 'Mozilla Firefox',
            'firefox': 'Mozilla Firefox',
            'msedge.exe': 'Microsoft Edge',
            'msedge': 'Microsoft Edge',
            'FoxitReader.exe': 'Foxit Reader',
            'SumatraPDF.exe': 'SumatraPDF',
            'POWERPNT.EXE': 'Microsoft PowerPoint',
            'EXCEL.EXE': 'Microsoft Excel',
            'notepad.exe': 'Notepad',
            'Code.exe': 'Visual Studio Code'
        };
    }

    log(message) {
        if (this.debugMode) {
            console.log(`[DEBUG] ${message}`);
        }
    }

    async startAdvancedMonitoring() {
        console.log('🔍 Starting Advanced File Monitoring...');
        this.isMonitoring = true;

        // Method 1: Fast process scanning (every 1 second)
        const fastScanner = setInterval(() => {
            if (!this.isMonitoring) {
                clearInterval(fastScanner);
                return;
            }
            this.quickProcessScan();
        }, 1000);

        // Method 2: File system watchers for common directories
        this.setupDirectoryWatchers();

        // Method 3: Windows handles monitoring
        const handleMonitor = setInterval(() => {
            if (!this.isMonitoring) {
                clearInterval(handleMonitor);
                return;
            }
            this.monitorFileHandles();
        }, 2000);

        // Method 4: Recent files monitoring
        const recentMonitor = setInterval(() => {
            if (!this.isMonitoring) {
                clearInterval(recentMonitor);
                return;
            }
            this.monitorRecentFiles();
        }, 3000);

        return { fastScanner, handleMonitor, recentMonitor };
    }

    async quickProcessScan() {
        // Simplified and faster process scanning
        const command = `
            Get-Process | Where-Object { 
                $_.ProcessName -match "(AcroRd32|Acrobat|WINWORD|chrome|firefox|msedge|Foxit|Sumatra)" -and 
                $_.MainWindowTitle -ne "" 
            } | ForEach-Object {
                try {
                    $proc = Get-WmiObject Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue
                    if ($proc -and $proc.CommandLine) {
                        [PSCustomObject]@{
                            Name = $_.ProcessName
                            Id = $_.Id
                            Title = $_.MainWindowTitle
                            CommandLine = $proc.CommandLine
                        }
                    }
                } catch { }
            } | ConvertTo-Json
        `;

        exec(`powershell.exe -Command "${command}"`, (error, stdout, stderr) => {
            if (error) {
                this.log(`Process scan error: ${error.message}`);
                return;
            }

            try {
                if (stdout.trim()) {
                    const processes = JSON.parse(stdout);
                    const processArray = Array.isArray(processes) ? processes : [processes];
                    
                    this.log(`Found ${processArray.length} relevant processes`);
                    
                    processArray.forEach(process => {
                        const key = `${process.Id}-${process.Name}`;
                        if (!this.processMap.has(key)) {
                            this.processMap.set(key, Date.now());
                            this.analyzeProcess(process);
                        }
                    });
                }
            } catch (parseError) {
                this.log(`JSON parse error: ${parseError.message}`);
            }
        });
    }

    setupDirectoryWatchers() {
        const watchDirs = [
            path.join(os.homedir(), 'Documents'),
            path.join(os.homedir(), 'Desktop'), 
            path.join(os.homedir(), 'Downloads'),
            'C:\\Users\\Public\\Documents'
        ];

        watchDirs.forEach(dir => {
            if (fs.existsSync(dir)) {
                try {
                    this.log(`Setting up watcher for: ${dir}`);
                    const watcher = fs.watch(dir, { recursive: false }, (eventType, filename) => {
                        if (filename && eventType === 'change') {
                            const fullPath = path.join(dir, filename);
                            const ext = path.extname(filename).toLowerCase();
                            
                            if (this.targetExtensions.includes(ext)) {
                                this.log(`File system event: ${eventType} - ${filename}`);
                                setTimeout(() => {
                                    this.checkFileAccess(fullPath, filename);
                                }, 500);
                            }
                        }
                    });
                    
                    this.fileWatchers.set(dir, watcher);
                    console.log(`👀 Watching: ${dir}`);
                } catch (error) {
                    this.log(`Error setting up watcher for ${dir}: ${error.message}`);
                }
            }
        });
    }

    async checkFileAccess(filePath, fileName) {
        this.log(`Checking file access for: ${fileName}`);
        
        // Use handle utility or process search to find which process opened the file
        const command = `
            $fileName = "${fileName}"
            $processes = Get-Process | Where-Object { $_.MainWindowTitle -like "*$fileName*" }
            $processes | ForEach-Object {
                [PSCustomObject]@{
                    Name = $_.ProcessName
                    Id = $_.Id
                    Title = $_.MainWindowTitle
                    FilePath = "${filePath}"
                }
            } | ConvertTo-Json
        `;

        exec(`powershell.exe -Command "${command}"`, (error, stdout, stderr) => {
            if (!error && stdout.trim()) {
                try {
                    const result = JSON.parse(stdout);
                    const processes = Array.isArray(result) ? result : [result];
                    
                    processes.forEach(proc => {
                        this.reportFileOpened({
                            fileName: fileName,
                            fullPath: filePath,
                            extension: path.extname(fileName),
                            readerApplication: this.getReaderName(proc.Name),
                            processName: proc.Name,
                            processId: proc.Id,
                            windowTitle: proc.Title,
                            timestamp: new Date().toISOString(),
                            source: 'File System Monitor'
                        });
                    });
                } catch (parseError) {
                    this.log(`Error parsing file access result: ${parseError.message}`);
                }
            }
        });
    }

    async monitorFileHandles() {
        // Monitor file handles using PowerShell
        const command = `
            $processes = Get-Process | Where-Object { $_.ProcessName -match "(AcroRd32|Acrobat|WINWORD|chrome|firefox|msedge)" }
            foreach ($proc in $processes) {
                try {
                    $wmiProc = Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)" -ErrorAction SilentlyContinue
                    if ($wmiProc -and $wmiProc.CommandLine -and $wmiProc.CommandLine -match "\\.(pdf|doc|docx)") {
                        [PSCustomObject]@{
                            ProcessName = $proc.ProcessName
                            ProcessId = $proc.Id
                            WindowTitle = $proc.MainWindowTitle
                            CommandLine = $wmiProc.CommandLine
                        }
                    }
                } catch { }
            } | ConvertTo-Json
        `;

        exec(`powershell.exe -Command "${command}"`, (error, stdout, stderr) => {
            if (!error && stdout.trim()) {
                try {
                    const result = JSON.parse(stdout);
                    const processes = Array.isArray(result) ? result : [result];
                    
                    processes.forEach(proc => {
                        const key = `handle-${proc.ProcessId}`;
                        if (!this.processMap.has(key)) {
                            this.processMap.set(key, Date.now());
                            this.analyzeProcess(proc);
                        }
                    });
                } catch (parseError) {
                    this.log(`Handle monitor parse error: ${parseError.message}`);
                }
            }
        });
    }

    async monitorRecentFiles() {
        const recentFolder = path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Recent');
        
        try {
            const files = fs.readdirSync(recentFolder);
            const now = Date.now();
            
            files.forEach(file => {
                if (file.endsWith('.lnk')) {
                    const filePath = path.join(recentFolder, file);
                    const stats = fs.statSync(filePath);
                    
                    // Check if file was accessed in last 5 seconds
                    if (now - stats.mtime.getTime() < 5000) {
                        this.log(`Recent file detected: ${file}`);
                        this.analyzeRecentFile(filePath, file);
                        processFile(filePath, file)
                    }
                }
            });
        } catch (error) {
            this.log(`Recent files monitor error: ${error.message}`);
        }
    }

    analyzeRecentFile(linkPath, fileName) {
        const command = `
            try {
                $shell = New-Object -ComObject WScript.Shell
                $shortcut = $shell.CreateShortcut("${linkPath.replace(/\\/g, '\\\\')}")
                $targetPath = $shortcut.TargetPath
                if ($targetPath -match "\\.(pdf|doc|docx)$") {
                    @{
                        TargetPath = $targetPath
                        Arguments = $shortcut.Arguments
                    } | ConvertTo-Json
                }
            } catch {
                Write-Error $_.Exception.Message
            }
        `;

        exec(`powershell.exe -Command "${command}"`, (error, stdout, stderr) => {
            if (!error && stdout.trim()) {
                try {
                    const result = JSON.parse(stdout);
                    const ext = path.extname(result.TargetPath).toLowerCase();
                    
                    if (this.targetExtensions.includes(ext)) {
                        this.reportFileOpened({
                            fileName: path.basename(result.TargetPath),
                            fullPath: result.TargetPath,
                            extension: ext,
                            readerApplication: 'Recently Accessed',
                            processName: 'System',
                            processId: 'Recent',
                            timestamp: new Date().toISOString(),
                            source: 'Recent Files Monitor'
                        });
                    }
                } catch (parseError) {
                    this.log(`Recent file parse error: ${parseError.message}`);
                }
            }
        });
    }

    analyzeProcess(processData) {
        this.log(`Analyzing process: ${processData.Name} (${processData.Id})`);
        
        if (processData.CommandLine) {
            const filePaths = this.extractFilePaths(processData.CommandLine);
            this.log(`Found ${filePaths.length} file paths in command line`);
            
            filePaths.forEach(filePath => {
                const fileExt = path.extname(filePath).toLowerCase();
                
                if (this.targetExtensions.includes(fileExt)) {
                    this.reportFileOpened({
                        fileName: path.basename(filePath),
                        fullPath: filePath,
                        extension: fileExt,
                        readerApplication: this.getReaderName(processData.Name),
                        processName: processData.Name,
                        processId: processData.Id,
                        windowTitle: processData.Title || 'N/A',
                        timestamp: new Date().toISOString(),
                        source: 'Process Analysis'
                    });
                }
            });
        }

        // Also check window title for file names
        if (processData.Title) {
            const titleFiles = this.extractFileNamesFromTitle(processData.Title);
            titleFiles.forEach(fileName => {
                const ext = path.extname(fileName).toLowerCase();
                if (this.targetExtensions.includes(ext)) {
                    this.reportFileOpened({
                        fileName: fileName,
                        fullPath: 'Unknown (from window title)',
                        extension: ext,
                        readerApplication: this.getReaderName(processData.Name),
                        processName: processData.Name,
                        processId: processData.Id,
                        windowTitle: processData.Title,
                        timestamp: new Date().toISOString(),
                        source: 'Window Title Analysis'
                    });
                }
            });
        }
    }

    extractFileNamesFromTitle(title) {
        const files = [];
        const regex = /([^\\\/]*\.(pdf|doc|docx))/gi;
        let match;
        
        while ((match = regex.exec(title)) !== null) {
            files.push(match[1]);
        }
        
        return files;
    }

    getReaderName(processName) {
        return this.readerApps[processName] || 
               this.readerApps[processName + '.exe'] || 
               processName;
    }

    extractFilePaths(commandLine) {
        if (!commandLine) return [];
        
        const paths = [];
        const patterns = [
            /"([^"]*\.(pdf|doc|docx))"/gi,  // Quoted paths
            /([A-Za-z]:\\[^\s"]*\.(pdf|doc|docx))/gi,  // Full paths
            /([^\s"]*\.(pdf|doc|docx))/gi   // Simple paths
        ];
        
        patterns.forEach(regex => {
            let match;
            while ((match = regex.exec(commandLine)) !== null) {
                const filePath = match[1];
                if (filePath && !paths.includes(filePath)) {
                    paths.push(filePath);
                }
            }
        });
        
        return paths;
    }

    reportFileOpened(fileInfo) {
        console.log('\n🎯 FILE OPENED DETECTED!');
        console.log(`📄 File: ${fileInfo.fileName}`);
        console.log(`📁 Path: ${fileInfo.fullPath}`);
        console.log(`📖 Reader: ${fileInfo.readerApplication}`);
        console.log(`🔧 Process: ${fileInfo.processName} (${fileInfo.processId})`);
        console.log(`🪟 Window: ${fileInfo.windowTitle}`);
        console.log(`⏰ Time: ${fileInfo.timestamp}`);
        console.log(`📊 Source: ${fileInfo.source}`);
        console.log('═'.repeat(60));

        this.emit('fileOpened', fileInfo);
    }

    // Manual test function
    async testCurrentlyOpen() {
        console.log('\n🔍 Testing currently open files...');
        
        const command = `
            Get-Process | Where-Object { 
                $_.MainWindowTitle -ne "" -and 
                ($_.ProcessName -match "(AcroRd32|Acrobat|WINWORD|chrome|firefox|msedge|Foxit|Sumatra)" -or
                 $_.MainWindowTitle -match "\\.(pdf|doc|docx)")
            } | ForEach-Object {
                [PSCustomObject]@{
                    Name = $_.ProcessName
                    Id = $_.Id
                    Title = $_.MainWindowTitle
                    HasWindow = $_.MainWindowHandle -ne 0
                }
            } | ConvertTo-Json
        `;

        return new Promise((resolve) => {
            exec(`powershell.exe -Command "${command}"`, (error, stdout, stderr) => {
                if (error) {
                    console.log('❌ Test error:', error.message);
                    resolve([]);
                    return;
                }

                try {
                    if (stdout.trim()) {
                        const result = JSON.parse(stdout);
                        const processes = Array.isArray(result) ? result : [result];
                        
                        console.log(`🔍 Found ${processes.length} processes with windows:`);
                        processes.forEach((proc, index) => {
                            console.log(`${index + 1}. ${proc.Name} (${proc.Id})`);
                            console.log(`   Title: ${proc.Title}`);
                            console.log(`   Has Window: ${proc.HasWindow}`);
                        });
                        
                        resolve(processes);
                    } else {
                        console.log('📄 No relevant processes found');
                        resolve([]);
                    }
                } catch (parseError) {
                    console.log('❌ Parse error:', parseError.message);
                    resolve([]);
                }
            });
        });
    }

    stop() {
        this.isMonitoring = false;
        
        // Close file watchers
        this.fileWatchers.forEach((watcher, dir) => {
            watcher.close();
            this.log(`Closed watcher for: ${dir}`);
        });
        this.fileWatchers.clear();
        
        console.log('✋ All monitoring stopped.');
    }
}

// Log function
function logFileAccess(fileInfo) {
    const logEntry = {
        user: os.userInfo().username,
        computer: os.hostname(),
        ...fileInfo
    };
    
    const logFile = path.join(__dirname, 'file_access.log');
    const logLine = `${new Date().toISOString()} - ${JSON.stringify(logEntry)}\n`;
    
    try {
        fs.appendFileSync(logFile, logLine);
        console.log('💾 Logged to file_access.log');
    } catch (error) {
        console.log('❌ Error writing to log file:', error.message);
    }
}

// Main function
async function main() {
    const monitor = new FileAccessMonitor();

    monitor.on('fileOpened', (fileInfo) => {
        logFileAccess(fileInfo);
    });

    console.log('🚀 Starting Enhanced File Access Monitor...');
    console.log('📋 Monitoring: PDF, DOC, DOCX files');
    console.log('⚡ Multiple detection methods enabled');
    console.log('🛑 Press Ctrl+C to stop\n');

    // Start enhanced monitoring
    await monitor.startAdvancedMonitoring();

    // Test currently open files immediately
    setTimeout(async () => {
        await monitor.testCurrentlyOpen();
    }, 2000);

    // Test again after 10 seconds
    setTimeout(async () => {
        console.log('\n🔄 Re-checking for open files...');
        await monitor.testCurrentlyOpen();
    }, 10000);

    // Graceful shutdown
    process.on('SIGINT', () => {
        monitor.stop();
        console.log('\n👋 Monitor stopped. Goodbye!');
        process.exit(0);
    });
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}