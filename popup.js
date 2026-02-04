// State
let currentMarkdown = null;

// DOM Elements
const createBtn = document.getElementById('createBtn');
const copyBtn = document.getElementById('copyBtn');
const createCopyBtn = document.getElementById('createCopyBtn');
const preview = document.getElementById('preview');
const status = document.getElementById('status');

// Event Listeners
createBtn.addEventListener('click', () => createMarkdown(false));
copyBtn.addEventListener('click', copyMarkdown);
createCopyBtn.addEventListener('click', () => createMarkdown(true));

/**
 * Check if URL is restricted (cannot inject content scripts)
 */
function isRestrictedUrl(url) {
  if (!url) return true;
  
  const restrictedPatterns = [
    /^chrome:\/\//,
    /^chrome-extension:\/\//,
    /^edge:\/\//,
    /^about:/,
    /^view-source:/,
    /^file:\/\//,
    /^https:\/\/chrome\.google\.com\/webstore/,
    /^https:\/\/microsoftedge\.microsoft\.com\/addons/
  ];
  
  return restrictedPatterns.some(pattern => pattern.test(url));
}

/**
 * Set button disabled states
 */
function setButtonsDisabled(disabled) {
  createBtn.disabled = disabled;
  createCopyBtn.disabled = disabled;
  // Copy button has special handling - only enabled when there's content
  copyBtn.disabled = disabled || !currentMarkdown;
}

/**
 * Set status message with optional type
 */
function setStatus(message, type = '') {
  status.textContent = message;
  status.className = 'status' + (type ? ` ${type}` : '');
}

/**
 * Display markdown in preview area
 */
function displayMarkdown(markdown) {
  preview.textContent = markdown;
  preview.className = 'preview';
}

/**
 * Display error in preview area
 */
function displayError(message) {
  preview.textContent = `Error: ${message}`;
  preview.className = 'preview error';
}

/**
 * Display loading state
 */
function displayLoading() {
  preview.textContent = 'Extracting content...';
  preview.className = 'preview loading';
}

/**
 * Main function to create markdown from current tab
 */
async function createMarkdown(copyAfter = false) {
  setButtonsDisabled(true);
  setStatus('Processing...', 'loading');
  displayLoading();
  
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Check for restricted URLs
    if (isRestrictedUrl(tab.url)) {
      throw new Error('Cannot access this page. Chrome system pages, the Web Store, and local files are restricted.');
    }
    
    // Inject and execute content script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/turndown.js', 'content.js']
    });
    
    const result = results[0]?.result;
    
    if (!result) {
      throw new Error('Failed to extract content - no result returned');
    }
    
    if (!result.success) {
      throw new Error(result.error || 'Content extraction failed');
    }
    
    // Success - store and display markdown
    currentMarkdown = result.markdown;
    displayMarkdown(currentMarkdown);
    setStatus('Generated successfully', 'success');
    copyBtn.disabled = false;
    
    // Copy if requested
    if (copyAfter) {
      await copyMarkdown();
    }
    
  } catch (error) {
    console.error('Error creating markdown:', error);
    currentMarkdown = null;
    displayError(error.message);
    setStatus(error.message, 'error');
    copyBtn.disabled = true;
  } finally {
    createBtn.disabled = false;
    createCopyBtn.disabled = false;
  }
}

/**
 * Copy markdown to clipboard
 */
async function copyMarkdown() {
  if (!currentMarkdown) {
    setStatus('No content to copy', 'error');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    setStatus('Copied to clipboard!', 'success');
    
    // Visual feedback on copy button
    copyBtn.classList.add('copied');
    copyBtn.textContent = 'Copied!';
    
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.textContent = 'Copy';
    }, 1500);
    
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    setStatus('Failed to copy: ' + error.message, 'error');
  }
}
