window.insightAPI.onSummary(({ file, summary }) => {
  document.getElementById('file-name').innerText = `Summary of ${file}`;
  document.getElementById('summary-text').innerText = summary;
});
