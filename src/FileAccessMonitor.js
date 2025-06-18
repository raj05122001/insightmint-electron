// src/FileAccessMonitor.js - Enhanced File Access Monitoring
const { EventEmitter } = require('events');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class FileAccessMonitor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            targetExtensions: ['.pdf', '.doc', '.docx'],
            debugMode: true,
            scanInterval: 1000,
            handleInterval: 2000,
            recentInterval: 3000,
            maxProcessAge: 300000, // 5 minutes
            ...options
        };
        
        this.isMonitoring = false;
        this.processMap = new Map();
        this.fileWatchers = new Map();
        this.intervals = [];
        
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
        
        // Bind methods to preserve context
        this.quickProcessScan = this.quickProcessScan.bind(this);
        this.monitorFileHandles = this.monitorFileHandles.bind(this);
        this.monitorRecentFiles = this.monitorRecentFiles.bind(this);
    }

    log(message) {
        if (this.options.debugMode) {
            console.log(`[FileMonitor] ${message}`);
        }
    }

    error(message, error) {
        console.error(`[FileMonitor] ${message}`, error || '');
        this.emit('error', { message, error });
    }

    async startAdvancedMonitoring() {
        if (this.isMonitoring) {
            this.log('Monitoring already started');
            return;
        }

        console.log('🔍 Starting Advanced File Monitoring...');
        this.isMonitoring = true;

        try {
            // Method 1: Fast process scanning
            const processScanner = setInterval(() => {
                if (!this.isMonitoring) return;
                this.quickProcessScan();
            }, this.options.scanInterval);

            // Method 2: File system watchers
            this.setupDirectoryWatchers();

            // Method 3: File handle monitoring
            const handleMonitor = setInterval(() => {
                if (!this.isMonitoring) return;
                this.monitorFileHandles();
            }, this.options.handleInterval);

            // Method 4: Recent files monitoring
            const recentMonitor = setInterval(() => {
                if (!this.isMonitoring) return;
                this.monitorRecentFiles();
            }, this.options.recentInterval);

            // Method 5: Process cleanup
            const cleanupInterval = setInterval(() => {
                if (!this.isMonitoring) return;
                this.cleanupOldProcesses();
            }, 30000); // Every 30 seconds

            // Store intervals for cleanup
            this.intervals = [processScanner, handleMonitor, recentMonitor, cleanupInterval];

            this.log('All monitoring methods started successfully');
            
        } catch (error) {
            this.error('Failed to start monitoring', error);
            this.stop();
        }
    }

    cleanupOldProcesses() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [key, timestamp] of this.processMap.entries()) {
            if (now - timestamp > this.options.maxProcessAge) {
                this.processMap.delete(key);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            this.log(`Cleaned up ${cleaned} old process entries`);
        }
    }

    async quickProcessScan() {
        const command = `
            try {
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
                                StartTime = $proc.CreationDate
                            }
                        }
                    } catch { }
                } | ConvertTo-Json -Depth 2
            } catch {
                Write-Error "Process scan failed: $($_.Exception.Message)"
            }
        `;

        this.executeCommand(command, 'process-scan', (result) => {
            if (result && result.length > 0) {
                const processes = Array.isArray(result) ? result : [result];
                this.log(`Found ${processes.length} relevant processes`);
                
                processes.forEach(process => {
                    const key = `${process.Id}-${process.Name}`;
                    if (!this.processMap.has(key)) {
                        this.processMap.set(key, Date.now());
                        this.analyzeProcess(process);
                    }
                });
            }
        });
    }

    setupDirectoryWatchers() {
        const watchDirs = [
            path.join(os.homedir(), 'Documents'),
            path.join(os.homedir(), 'Desktop'), 
            path.join(os.homedir(), 'Downloads'),
            'C:\\Users\\Public\\Documents'
        ].filter(dir => fs.existsSync(dir));

        watchDirs.forEach(dir => {
            try {
                this.log(`Setting up watcher for: ${dir}`);
                
                const watcher = fs.watch(dir, { recursive: false }, (eventType, filename) => {
                    if (filename && eventType === 'change') {
                        this.handleFileSystemEvent(dir, filename);
                    }
                });
                
                watcher.on('error', (error) => {
                    this.error(`Watcher error for ${dir}`, error);
                });
                
                this.fileWatchers.set(dir, watcher);
                console.log(`👀 Watching: ${dir}`);
                
            } catch (error) {
                this.error(`Error setting up watcher for ${dir}`, error);
            }
        });
    }

    handleFileSystemEvent(dir, filename) {
        const ext = path.extname(filename).toLowerCase();
        
        if (this.options.targetExtensions.includes(ext)) {
            const fullPath = path.join(dir, filename);
            this.log(`File system event: ${filename}`);
            
            // Delay to ensure file operation is complete
            setTimeout(() => {
                this.checkFileAccess(fullPath, filename);
            }, 500);
        }
    }

    async checkFileAccess(filePath, fileName) {
        this.log(`Checking file access for: ${fileName}`);
        
        const command = `
            try {
                $fileName = "${fileName.replace(/"/g, '""')}"
                $processes = Get-Process | Where-Object { 
                    $_.MainWindowTitle -like "*$fileName*" -or
                    $_.ProcessName -match "(AcroRd32|Acrobat|WINWORD|chrome|firefox|msedge)"
                }
                $processes | ForEach-Object {
                    [PSCustomObject]@{
                        Name = $_.ProcessName
                        Id = $_.Id
                        Title = $_.MainWindowTitle
                        FilePath = "${filePath.replace(/\\/g, '\\\\')}"
                    }
                } | ConvertTo-Json -Depth 2
            } catch {
                Write-Error "File access check failed: $($_.Exception.Message)"
            }
        `;

        this.executeCommand(command, 'file-access', (result) => {
            if (result && result.length > 0) {
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
            }
        });
    }

    async monitorFileHandles() {
        const command = `
            try {
                $processes = Get-Process | Where-Object { 
                    $_.ProcessName -match "(AcroRd32|Acrobat|WINWORD|chrome|firefox|msedge)" 
                }
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
                } | ConvertTo-Json -Depth 2
            } catch {
                Write-Error "Handle monitor failed: $($_.Exception.Message)"
            }
        `;

        this.executeCommand(command, 'handle-monitor', (result) => {
            if (result && result.length > 0) {
                const processes = Array.isArray(result) ? result : [result];
                
                processes.forEach(proc => {
                    const key = `handle-${proc.ProcessId}`;
                    if (!this.processMap.has(key)) {
                        this.processMap.set(key, Date.now());
                        this.analyzeProcess(proc);
                    }
                });
            }
        });
    }

    async monitorRecentFiles() {
        const recentFolder = path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Recent');
        
        try {
            if (!fs.existsSync(recentFolder)) {
                return;
            }

            const files = fs.readdirSync(recentFolder);
            const now = Date.now();
            
            files.forEach(file => {
                if (file.endsWith('.lnk')) {
                    const filePath = path.join(recentFolder, file);
                    
                    try {
                        const stats = fs.statSync(filePath);
                        
                        // Check if file was accessed in last 10 seconds
                        if (now - stats.mtime.getTime() < 10000) {
                            this.log(`Recent file detected: ${file}`);
                            this.analyzeRecentFile(filePath, file);
                        }
                    } catch (error) {
                        // Ignore individual file errors
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
                Write-Error "Recent file analysis failed: $($_.Exception.Message)"
            }
        `;

        this.executeCommand(command, 'recent-file', (result) => {
            if (result && result.TargetPath) {
                const ext = path.extname(result.TargetPath).toLowerCase();
                
                if (this.options.targetExtensions.includes(ext)) {
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
            }
        });
    }

    executeCommand(command, context, callback) {
        exec(`powershell.exe -Command "${command}"`, (error, stdout, stderr) => {
            if (error) {
                this.log(`${context} error: ${error.message}`);
                return;
            }

            try {
                if (stdout.trim()) {
                    const result = JSON.parse(stdout);
                    callback(result);
                }
            } catch (parseError) {
                this.log(`${context} parse error: ${parseError.message}`);
            }
        });
    }

    analyzeProcess(processData) {
        this.log(`Analyzing process: ${processData.Name || processData.ProcessName} (${processData.Id || processData.ProcessId})`);
        
        // Analyze command line
        if (processData.CommandLine) {
            const filePaths = this.extractFilePaths(processData.CommandLine);
            this.log(`Found ${filePaths.length} file paths in command line`);
            
            filePaths.forEach(filePath => {
                const fileExt = path.extname(filePath).toLowerCase();
                
                if (this.options.targetExtensions.includes(fileExt)) {
                    this.reportFileOpened({
                        fileName: path.basename(filePath),
                        fullPath: filePath,
                        extension: fileExt,
                        readerApplication: this.getReaderName(processData.Name || processData.ProcessName),
                        processName: processData.Name || processData.ProcessName,
                        processId: processData.Id || processData.ProcessId,
                        windowTitle: processData.Title || processData.WindowTitle || 'N/A',
                        timestamp: new Date().toISOString(),
                        source: 'Process Analysis'
                    });
                }
            });
        }

        // Analyze window title
        const title = processData.Title || processData.WindowTitle;
        if (title) {
            const titleFiles = this.extractFileNamesFromTitle(title);
            titleFiles.forEach(fileName => {
                const ext = path.extname(fileName).toLowerCase();
                if (this.options.targetExtensions.includes(ext)) {
                    this.reportFileOpened({
                        fileName: fileName,
                        fullPath: 'Unknown (from window title)',
                        extension: ext,
                        readerApplication: this.getReaderName(processData.Name || processData.ProcessName),
                        processName: processData.Name || processData.ProcessName,
                        processId: processData.Id || processData.ProcessId,
                        windowTitle: title,
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
            /([A-Za-z]:\\[^\s"]*\.(pdf|doc|docx))/gi,  // Full Windows paths
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

    async testCurrentlyOpen() {
        console.log('\n🔍 Testing currently open files...');
        
        const command = `
            try {
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
                } | ConvertTo-Json -Depth 2
            } catch {
                Write-Error "Test scan failed: $($_.Exception.Message)"
            }
        `;

        return new Promise((resolve) => {
            this.executeCommand(command, 'test-scan', (result) => {
                if (result && result.length > 0) {
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
            });
        });
    }

    stop() {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        
        // Clear all intervals
        this.intervals.forEach(interval => clearInterval(interval));
        this.intervals = [];
        
        // Close file watchers
        this.fileWatchers.forEach((watcher, dir) => {
            try {
                watcher.close();
                this.log(`Closed watcher for: ${dir}`);
            } catch (error) {
                this.error(`Error closing watcher for ${dir}`, error);
            }
        });
        this.fileWatchers.clear();
        
        // Clear process map
        this.processMap.clear();
        
        console.log('✋ File monitoring stopped.');
    }

    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            processCount: this.processMap.size,
            watcherCount: this.fileWatchers.size,
            intervalCount: this.intervals.length
        };
    }
}

module.exports = FileAccessMonitor;