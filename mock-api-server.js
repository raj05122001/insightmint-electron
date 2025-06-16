const express = require('express');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const port = 8000;

app.use(express.json({ limit: '50mb' })); // Increased limit for base64 files

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  next();
});

// Text extraction function with better error handling
async function extractTextFromBase64(base64Data, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  let text = '';

  try {
    // Convert base64 to buffer
    const fileBuffer = Buffer.from(base64Data, 'base64');
    console.log(`📄 File buffer size: ${fileBuffer.length} bytes`);
    
    if (ext === '.pdf') {
      console.log('Processing PDF file...');
      
      // Try different PDF parsing options
      const options = {
        normalizeWhitespace: false,
        disableCombineTextItems: false,
        max: 0 // Process all pages
      };
      
      const pdfData = await pdf(fileBuffer, options);
      text = pdfData.text;
      
      console.log(`📊 PDF Info: ${pdfData.numpages} pages, ${text.length} characters`);
      console.log(`📝 First 200 chars: "${text.substring(0, 200)}"`);
      
      // If main text is empty, try metadata or other properties
      if (text.trim().length < 50 && pdfData.info) {
        console.log('🔍 Trying PDF metadata...');
        const metadata = JSON.stringify(pdfData.info, null, 2);
        text = `PDF Metadata:\n${metadata}\n\nExtracted Text:\n${text}`;
      }
      
    } else if (ext === '.docx' || ext === '.doc') {
      console.log('Processing Word document...');
      const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
      text = value;
      console.log(`📝 Word doc extracted: ${text.length} characters`);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    console.log(`✅ Final extracted text length: ${text.length} characters`);
    return text;
  } catch (error) {
    console.error('❌ Error extracting text:', error.message);
    console.error('📋 Error details:', error);
    throw new Error(`Failed to extract text from ${fileName}: ${error.message}`);
  }
}

// Enhanced text summarization
function summarizeText(text, filename) {
  console.log(`🤖 Summarizing text of length: ${text.length}`);
  
  // Handle very short text
  if (text.trim().length < 20) {
    return `📄 Document: ${filename}\n❗ Very short content detected (${text.length} characters).\n\nContent:\n${text.trim()}`;
  }
  
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[.!?]+/)
    .filter(sentence => sentence.trim().length > 5) // Reduced minimum length
    .map(s => s.trim());

  if (sentences.length === 0) {
    return `📄 Document: ${filename}\n❗ No readable sentences found.\n\nRaw content (first 500 chars):\n${text.substring(0, 500)}`;
  }

  let summary = "";
  const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
  const charCount = text.length;
  
  summary += `📄 Document Summary: ${filename}\n`;
  summary += `📊 Stats: ${wordCount} words, ${charCount} characters, ${sentences.length} sentences\n\n`;
  
  // Add content based on length
  if (text.length < 200) {
    summary += "📝 Full Content:\n";
    summary += text.trim();
  } else {
    const introSentences = sentences.slice(0, Math.min(5, sentences.length)); // Increased to 5
    summary += "📋 Key Points:\n";
    introSentences.forEach((sentence, index) => {
      summary += `${index + 1}. ${sentence}.\n`;
    });
    
    if (sentences.length > 5) {
      summary += `\n🔍 Analysis: This document contains ${sentences.length} sentences. `;
      const keywords = extractKeywords(text);
      if (keywords.length > 0) {
        summary += `Main topics appear to focus on: ${keywords.slice(0, 5).join(', ')}.`;
      }
    }
  }
  
  return summary;
}

function extractKeywords(text) {
  try {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3) // Reduced minimum length
      .filter(word => !['this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 'said', 'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other'].includes(word));
      
    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    
    return Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  } catch (error) {
    console.error('Error extracting keywords:', error);
    return [];
  }
}

// Base64 file processing endpoint with enhanced error handling
app.post('/summarize-file-base64', async (req, res) => {
  try {
    const { fileData, fileName, fileType } = req.body;
    
    console.log(`\n🔄 === Processing Request ===`);
    console.log(`📄 File: ${fileName}`);
    console.log(`🔍 Type: ${fileType}`);
    console.log(`📊 Data length: ${fileData ? fileData.length : 'undefined'} chars`);
    
    if (!fileData || !fileName) {
      console.error('❌ Missing file data or filename');
      return res.status(400).json({ 
        error: 'Missing file data or filename.',
        received: {
          hasFileData: !!fileData,
          hasFileName: !!fileName,
          fileDataLength: fileData ? fileData.length : 0
        }
      });
    }

    // Extract text from base64 file
    let text;
    try {
      text = await extractTextFromBase64(fileData, fileName);
    } catch (extractError) {
      console.error('❌ Text extraction failed:', extractError.message);
      return res.status(400).json({ 
        error: `Text extraction failed: ${extractError.message}`,
        fileName: fileName,
        fileType: fileType
      });
    }

    console.log(`📝 Extracted text length: ${text.length}`);
    console.log(`📋 Text preview: "${text.substring(0, 100)}..."`);

    // Generate summary (don't reject short texts, process them)
    console.log('🤖 Generating summary...');
    const summary = summarizeText(text, fileName);
    
    const response = {
      summary: summary,
      filename: fileName,
      originalLength: text.length,
      summaryLength: summary.length,
      processingTime: new Date().toISOString(),
      success: true,
      debug: {
        extractedChars: text.length,
        hasContent: text.trim().length > 0
      }
    };

    res.json(response);
    console.log(`✅ Summary generated successfully for ${fileName}`);
    console.log(`📊 Response length: ${summary.length} characters`);
    
  } catch (error) {
    console.error('❌ Unexpected error in file summarization:', error);
    console.error('📋 Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Internal server error during file processing.',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Original text summarization endpoint
app.post('/summarize', (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid input. Text is required.' 
      });
    }
    
    if (text.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Empty text provided.' 
      });
    }
    
    console.log(`Received text for summarization: ${text.length} characters`);
    
    setTimeout(() => {
      const summary = summarizeText(text, 'Direct Text Input');
      
      res.json({
        summary: summary,
        originalLength: text.length,
        summaryLength: summary.length,
        timestamp: new Date().toISOString()
      });
      
      console.log('Summary generated successfully');
    }, 1000);
    
  } catch (error) {
    console.error('Error in summarization:', error);
    res.status(500).json({ 
      error: 'Internal server error during summarization.' 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'InsightMint API Server is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      '/summarize-file-base64': 'POST - Upload and summarize files via base64',
      '/summarize': 'POST - Summarize raw text',
      '/health': 'GET - Health check'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🚨 Unhandled middleware error:', error);
  res.status(500).json({ 
    error: 'Something went wrong!',
    details: error.message 
  });
});

// Start server
app.listen(port, () => {
  console.log(`\n🚀 InsightMint API Server running at http://localhost:${port}`);
  console.log(`📋 Health check: http://localhost:${port}/health`);
  console.log(`📝 Text summarization: POST http://localhost:${port}/summarize`);
  console.log(`📄 File summarization: POST http://localhost:${port}/summarize-file-base64`);
  console.log(`📁 Supported file types: PDF, DOCX, DOC`);
  console.log(`🔧 Debug mode: Detailed logging enabled\n`);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down API server...');
  process.exit(0);
});