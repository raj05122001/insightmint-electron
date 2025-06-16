window.insightAPI.onSummary(({ file, summary }) => {
  const fileNameElement = document.getElementById('file-name');
  const summaryElement = document.getElementById('summary-text');
  
  // Update file name
  fileNameElement.innerText = `Summary of ${file}`;
  
  // Update summary with better formatting
  if (summary) {
    // Check if it's an error message
    if (file === 'Error') {
      fileNameElement.innerText = '⚠️ Error';
      fileNameElement.style.color = '#ff6b6b';
      summaryElement.innerText = summary;
      summaryElement.style.color = '#ff6b6b';
    } else {
      fileNameElement.style.color = '#2c3e50';
      summaryElement.style.color = '#34495e';
      
      // Format the summary text
      const formattedSummary = summary
        .replace(/\n/g, '\n')
        .replace(/📄/g, '📄')
        .replace(/📊/g, '📊');
      
      summaryElement.innerText = formattedSummary;
    }
  } else {
    summaryElement.innerText = 'No summary available.';
  }
  
  // Auto-scroll to top
  summaryElement.scrollTop = 0;
  
  // Add click handler to close on click
  document.addEventListener('click', (e) => {
    if (e.target.className !== 'close') {
      window.close();
    }
  });
  
  // Add escape key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.close();
    }
  });
  
  console.log('Summary updated:', { file, summaryLength: summary?.length });
});