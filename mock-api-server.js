const express = require('express');
const app = express();
const port = 8000;

app.use(express.json({ limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  next();
});

// Simple text summarization
function summarizeText(text) {
  // Remove extra whitespace and split into sentences
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[.!?]+/)
    .filter(sentence => sentence.trim().length > 10)
    .map(s => s.trim());

  if (sentences.length === 0) {
    return "No meaningful content found in the document.";
  }

  // Take first few sentences and some key points
  let summary = "";
  
  // Add document stats
  const wordCount = text.split(/\s+/).length;
  const charCount = text.length;
  
  summary += `📄 Document Summary (${wordCount} words, ${charCount} characters)\n\n`;
  
  // Add first 2-3 sentences
  const introSentences = sentences.slice(0, Math.min(3, sentences.length));
  summary += "Key Points:\n";
  introSentences.forEach((sentence, index) => {
    summary += `${index + 1}. ${sentence}.\n`;
  });
  
  // Add some random insights
  if (sentences.length > 3) {
    summary += `\n📊 This document contains ${sentences.length} sentences. `;
    summary += `Main topics appear to focus on ${extractKeywords(text).slice(0, 3).join(', ')}.`;
  }
  
  return summary;
}

function extractKeywords(text) {
  // Simple keyword extraction
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 4);
    
  const wordFreq = {};
  words.forEach(word => {
    wordFreq[word] = (wordFreq[word] || 0) + 1;
  });
  
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

// Summarization endpoint
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
    
    // Simulate some processing time
    setTimeout(() => {
      const summary = summarizeText(text);
      
      res.json({
        summary: summary,
        originalLength: text.length,
        summaryLength: summary.length,
        timestamp: new Date().toISOString()
      });
      
      console.log('Summary generated successfully');
    }, 1000); // 1 second delay to simulate processing
    
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
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 InsightMint API Server running at http://localhost:${port}`);
  console.log(`📋 Health check: http://localhost:${port}/health`);
  console.log(`📝 Summarization endpoint: POST http://localhost:${port}/summarize`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down API server...');
  process.exit(0);
});