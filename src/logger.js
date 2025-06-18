// src/logger.js - Enhanced Logging System
const fs = require('fs');
const path = require('path');
const os = require('os');

class Logger {
    constructor(options = {}) {
        this.options = {
            logDir: path.join(__dirname, '..', 'logs'),
            maxFileSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            dateFormat: 'YYYY-MM-DD HH:mm:ss',
            ...options
        };
        
        this.ensureLogDirectory();
    }
    
    ensureLogDirectory() {
        if (!fs.existsSync(this.options.logDir)) {
            try {
                fs.mkdirSync(this.options.logDir, { recursive: true });
                console.log(`📁 Created log directory: ${this.options.logDir}`);
            } catch (error) {
                console.error('❌ Failed to create log directory:', error);
            }
        }
    }
    
    formatTimestamp() {
        return new Date().toISOString().replace('T', ' ').slice(0, 19);
    }
    
    log(level, message, data = {}) {
        const timestamp = this.formatTimestamp();
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            message,
            user: os.userInfo().username,
            computer: os.hostname(),
            pid: process.pid,
            ...data
        };
        
        // Console output with colors
        const coloredLevel = this.colorizeLevel(level);
        console.log(`[${timestamp}] ${coloredLevel} ${message}`);
        
        // File output
        this.writeToFile(level, logEntry);
        
        return logEntry;
    }
    
    colorizeLevel(level) {
        const colors = {
            error: '\x1b[31m',   // Red
            warn: '\x1b[33m',    // Yellow
            info: '\x1b[36m',    // Cyan
            debug: '\x1b[35m',   // Magenta
            access: '\x1b[32m',  // Green
            reset: '\x1b[0m'     // Reset
        };
        
        const color = colors[level.toLowerCase()] || colors.info;
        return `${color}${level.toUpperCase()}${colors.reset}`;
    }
    
    writeToFile(level, logEntry) {
        const fileName = this.getLogFileName(level);
        const filePath = path.join(this.options.logDir, fileName);
        const logLine = JSON.stringify(logEntry) + '\n';
        
        try {
            // Check file size and rotate if needed
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                if (stats.size > this.options.maxFileSize) {
                    this.rotateLogFile(filePath);
                }
            }
            
            fs.appendFileSync(filePath, logLine);
        } catch (error) {
            console.error('❌ Failed to write to log file:', error);
        }
    }
    
    getLogFileName(level) {
        const date = new Date().toISOString().split('T')[0];
        return `${level}-${date}.log`;
    }
    
    rotateLogFile(filePath) {
        try {
            const ext = path.extname(filePath);
            const base = filePath.slice(0, -ext.length);
            
            // Rotate existing files
            for (let i = this.options.maxFiles - 1; i > 0; i--) {
                const oldFile = `${base}.${i}${ext}`;
                const newFile = `${base}.${i + 1}${ext}`;
                
                if (fs.existsSync(oldFile)) {
                    if (i === this.options.maxFiles - 1) {
                        fs.unlinkSync(oldFile); // Delete oldest
                    } else {
                        fs.renameSync(oldFile, newFile);
                    }
                }
            }
            
            // Move current file to .1
            fs.renameSync(filePath, `${base}.1${ext}`);
            
        } catch (error) {
            console.error('❌ Failed to rotate log file:', error);
        }
    }
    
    info(message, data) {
        return this.log('info', message, data);
    }
    
    error(message, data) {
        return this.log('error', message, data);
    }
    
    warn(message, data) {
        return this.log('warn', message, data);
    }
    
    debug(message, data) {
        return this.log('debug', message, data);
    }
    
    access(message, data) {
        return this.log('access', message, data);
    }
    
    // Clean old log files
    cleanup() {
        try {
            const files = fs.readdirSync(this.options.logDir);
            const now = Date.now();
            const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
            
            let cleaned = 0;
            files.forEach(file => {
                const filePath = path.join(this.options.logDir, file);
                const stats = fs.statSync(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath);
                    cleaned++;
                }
            });
            
            if (cleaned > 0) {
                this.info(`Cleaned up ${cleaned} old log files`);
            }
        } catch (error) {
            this.error('Failed to cleanup old logs', { error: error.message });
        }
    }
    
    // Get log statistics
    getStats() {
        try {
            const files = fs.readdirSync(this.options.logDir);
            let totalSize = 0;
            let fileCount = 0;
            
            files.forEach(file => {
                const filePath = path.join(this.options.logDir, file);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
                fileCount++;
            });
            
            return {
                fileCount,
                totalSize,
                totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
                logDir: this.options.logDir
            };
        } catch (error) {
            return { error: error.message };
        }
    }
}

// Global logger instance
const logger = new Logger();

// Specialized logging functions
function logFileAccess(fileInfo) {
    const logEntry = {
        user: os.userInfo().username,
        computer: os.hostname(),
        ...fileInfo
    };
    
    logger.access('File accessed', logEntry);
    
    // Also write to legacy file for backward compatibility
    const legacyLogFile = path.join(__dirname, '..', 'file_access.log');
    const legacyLogLine = `${new Date().toISOString()} - ${JSON.stringify(logEntry)}\n`;
    
    try {
        fs.appendFileSync(legacyLogFile, legacyLogLine);
    } catch (error) {
        logger.error('Failed to write to legacy log file', { error: error.message });
    }
}

function logAPICall(endpoint, method, status, duration, data = {}) {
    logger.info('API call', {
        endpoint,
        method,
        status,
        duration,
        ...data
    });
}

function logError(context, error, additionalData = {}) {
    logger.error(context, {
        error: error.message,
        stack: error.stack,
        ...additionalData
    });
}

function logFileProcessing(fileName, status, duration, metadata = {}) {
    logger.info('File processing', {
        fileName,
        status,
        duration,
        ...metadata
    });
}

function setupLogging() {
    // Redirect console errors to logger
    const originalConsoleError = console.error;
    console.error = (...args) => {
        originalConsoleError(...args);
        logger.error('Console error', { message: args.join(' ') });
    };
    
    // Log unhandled exceptions
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception', {
            error: error.message,
            stack: error.stack
        });
        
        // Don't exit in production, try to continue
        if (process.env.NODE_ENV !== 'production') {
            process.exit(1);
        }
    });
    
    // Log unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled promise rejection', {
            reason: reason?.message || reason,
            stack: reason?.stack
        });
    });
    
    // Cleanup old logs on startup
    logger.cleanup();
    
    // Schedule periodic cleanup (daily)
    setInterval(() => {
        logger.cleanup();
    }, 24 * 60 * 60 * 1000);
    
    logger.info('InsightMint logging system initialized');
    
    return logger;
}

// Performance timing helper
class Timer {
    constructor(name) {
        this.name = name;
        this.startTime = Date.now();
    }
    
    end(additionalData = {}) {
        const duration = Date.now() - this.startTime;
        logger.debug(`Timer: ${this.name}`, {
            duration,
            ...additionalData
        });
        return duration;
    }
}

function createTimer(name) {
    return new Timer(name);
}

module.exports = {
    logger,
    logFileAccess,
    logAPICall,
    logError,
    logFileProcessing,
    setupLogging,
    createTimer,
    Timer
};