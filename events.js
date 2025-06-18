const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const os = require('os');

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