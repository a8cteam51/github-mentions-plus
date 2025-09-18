/**
 * GitHub Mentions+ Extension - Main Content Script
 * Enhances GitHub's @mention autocomplete with custom user suggestions
 */

// State variables
let activeInput = null;
let mentionStartPos = null;
let isInitialized = false;
let settings = null;
let cachedUsers = [];

/**
 * Initialize the extension
 */
async function initialize() {
  if (isInitialized) return;
  
  try {
    // Check if utilities are available
    if (!window.GitHubMentionsStorage || !window.GitHubMentionsDOM) {
      return;
    }

    // Load settings
    settings = await window.GitHubMentionsStorage.getSettings();
    
    // Create overlay
    window.GitHubMentionsDOM.createOverlay();
    
    // Load cached users if available
    cachedUsers = await window.GitHubMentionsStorage.getCachedUsers();
    
    // If we have an endpoint and no cached users, try to load from endpoint
    if (settings?.endpointUrl && cachedUsers.length === 0) {
      await loadUsersFromEndpoint();
    }

    // Start scanning for inputs
    scanInputs();
    setInterval(scanInputs, 1000);

    isInitialized = true;
  } catch (error) {
    // Silently handle initialization errors
  }
}

/**
 * Load users from endpoint and cache them
 * @returns {Promise<boolean>} Success status
 */
async function loadUsersFromEndpoint() {
  if (!settings?.endpointUrl) {
    return false;
  }

  try {
    // Check if API utilities are available
    if (!window.GitHubMentionsAPI) {
      return false;
    }
    
    // Fetch users from endpoint
    const users = await window.GitHubMentionsAPI.fetchUsersFromEndpoint(settings.endpointUrl);
    
    // Enhance with GitHub avatars for users without avatars
    const enhancedUsers = await window.GitHubMentionsAPI.enhanceUsersWithAvatars(users);
    
    // Cache the enhanced users
    await window.GitHubMentionsStorage.setCachedUsers(enhancedUsers);
    cachedUsers = enhancedUsers;
    
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get users for suggestions (from cache, endpoint, or direct JSON)
 * @returns {Promise<Array>} Array of user data
 */
async function getUsersForSuggestions() {
  // Check if storage utilities are available
  if (!window.GitHubMentionsStorage) {
    return [];
  }
  
  // If we have cached users, use them
  if (cachedUsers.length > 0) {
    return cachedUsers;
  }
  
  // Get current settings to determine data source
  const currentSettings = await window.GitHubMentionsStorage.getSettings();
  if (!currentSettings) {
    return [];
  }
  
  // Handle direct JSON data source
  if (currentSettings.dataSource === 'direct' && currentSettings.directJsonData) {
    try {
      const directUsers = JSON.parse(currentSettings.directJsonData);
      if (Array.isArray(directUsers) && directUsers.length > 0) {
        // Validate and cache the direct users
        const validUsers = directUsers.filter(user => 
          user && typeof user === 'object' &&
          typeof user.username === 'string' &&
          typeof user.name === 'string' &&
          (user.avatar === undefined || typeof user.avatar === 'string')
        );
        
        if (validUsers.length > 0) {
          // Cache the valid users
          await window.GitHubMentionsStorage.setCachedUsers(validUsers);
          cachedUsers = validUsers;
          return validUsers;
        }
      }
    } catch (error) {
      console.error('Failed to parse direct JSON data:', error);
    }
  }
  
  // Handle HTTP endpoint data source
  if (currentSettings.dataSource === 'endpoint' && currentSettings.endpointUrl) {
    // If cache is expired and we have an endpoint, try to load fresh data
    if (await window.GitHubMentionsStorage.isCacheExpired()) {
      await loadUsersFromEndpoint();
      return cachedUsers;
    }
  }
  
  return [];
}

/**
 * Insert a mention into the active input
 * @param {string} username - Username to insert
 */
function insertMention(username) {
  if (!activeInput) return;

  try {
    const val = activeInput.value;
    const cursor = activeInput.selectionStart;
    const before = val.substring(0, mentionStartPos);
    const after = val.substring(cursor);
    const mentionText = `@${username} `;

    activeInput.value = before + mentionText + after;
    const newCursorPos = before.length + mentionText.length;
    
    // Set cursor position
    activeInput.focus();
    activeInput.setSelectionRange(newCursorPos, newCursorPos);

    // Dispatch input event to notify React of the change
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (error) {
    // Silently handle insertion errors
  }
}

/**
 * Scan text for @@ mention trigger
 * @param {string} text - Text to scan
 * @param {number} pos - Cursor position
 * @returns {string|null} Username query or null
 */
function scanForTrigger(text, pos) {
  try {
    const slice = text.substring(0, pos);
    const match = slice.match(/@@([a-zA-Z0-9-_]*)$/);
    return match ? match[1] : null;
  } catch (error) {
    return null;
  }
}

/**
 * Scan text for ! command trigger
 * @param {string} text - Text to scan
 * @param {number} pos - Cursor position
 * @returns {Object|null} Command info {command: string, query: string} or null
 */
function scanForCommand(text, pos) {
  try {
    const slice = text.substring(0, pos);
    const match = slice.match(/!([a-zA-Z0-9-_]*)$/);
    return match ? { command: match[1], query: match[1] } : null;
  } catch (error) {
    return null;
  }
}

/**
 * Execute a command - simplified version
 * @param {string} command - Command to execute
 * @param {HTMLElement} input - Input element to insert result into
 */
async function executeCommand(command, input) {
  try {
    let result = '';
    
    // Handle built-in commands first
    if (command === 'lgtmrand') {
      try {
        // Send message to background script to fetch random LGTM
        const lgtmResult = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: 'fetchRandomLGTM' },
            (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            }
          );
        });
        
        if (lgtmResult && lgtmResult.success && lgtmResult.imageUrl) {
          result = `![LGTM](${lgtmResult.imageUrl})`;
        } else {
          result = '![LGTM](https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif)'; // fallback
        }
      } catch (error) {
        result = '![LGTM](https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif)'; // fallback
      }
    } else {
      // Get custom commands from settings (max 10)
      const customCommands = settings?.customCommands || {};
      
      if (customCommands[command]) {
        const commandData = customCommands[command];
        let commandContent = '';
        
        if (typeof commandData === 'object') {
          commandContent = commandData.content || '';
        } else {
          // Legacy format - just a string
          commandContent = commandData;
        }
        
        // Simple markdown template - just replace variables
        result = commandContent;
        
        // Replace basic variables
        result = result.replace(/\$\{timestamp\}/g, new Date().toISOString());
        result = result.replace(/\$\{date\}/g, new Date().toLocaleDateString());
        result = result.replace(/\$\{time\}/g, new Date().toLocaleTimeString());
      }
    }
    
    if (result) {
      // Insert the result
      const cursor = input.selectionStart;
      const text = input.value;
      const beforeCursor = text.substring(0, cursor);
      const afterCursor = text.substring(cursor);
      
      // Find the start position of the command
      const commandMatch = beforeCursor.match(/!([a-zA-Z0-9-_]*)$/);
      if (commandMatch) {
        const commandStart = cursor - commandMatch[0].length;
        const newText = text.substring(0, commandStart) + result + afterCursor;
        
        input.value = newText;
        input.selectionStart = input.selectionEnd = commandStart + result.length;
        
        // Trigger input event
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  } catch (error) {
    console.error('[GitHub Mentions+] Command execution error:', error);
  }
}

/**
 * Get available commands for suggestions
 * @returns {Array} Array of command objects
 */
function getAvailableCommands() {
  // Built-in commands
  const builtInCommands = [
    {
      command: 'lgtmrand',
      description: 'Insert a random LGTM GIF from GIPHY'
    }
  ];
  
  const customCommands = settings?.customCommands || {};
  
  
  const userCommands = Object.keys(customCommands).map(cmd => {
    const commandData = customCommands[cmd];
    let description = '';
    let emoji = null;
    
    if (typeof commandData === 'object') {
      description = (commandData.content || '').substring(0, 50) + '...';
      emoji = commandData.emoji;
    } else {
      // Legacy format - just a string
      description = commandData.substring(0, 50) + '...';
    }
    
    return {
      command: cmd,
      description: description,
      emoji: emoji
    };
  });
  
  // Combine built-in and user commands (max 10 total)
  return [...builtInCommands, ...userCommands].slice(0, 10);
}

/**
 * Filter commands based on query
 * @param {Array} commands - Available commands
 * @param {string} query - Search query
 * @returns {Array} Filtered commands
 */
function filterCommands(commands, query) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return [];
  }
  
  if (!query) {
    return commands.slice(0, 10); // Show all commands when no query (max 10)
  }
  
  const lowerQuery = query.toLowerCase();
  return commands.filter(cmd => 
    cmd.command.toLowerCase().includes(lowerQuery)
  ).slice(0, 10);
}

/**
 * Filter users based on query and exclude GitHub's current suggestions
 * @param {Array} users - User data array
 * @param {string} query - Search query
 * @returns {Array} Filtered users
 */
function filterUsers(users, query) {
  if (!Array.isArray(users) || users.length === 0) {
    return [];
  }

  if (!query) {
    return users;
  }

  const lowerQuery = query.toLowerCase();
  const matchingUsers = users.filter(user => 
    user.username.toLowerCase().includes(lowerQuery) ||
    user.name.toLowerCase().includes(lowerQuery)
  );
  
  return matchingUsers.slice(0, 10);
}

/**
 * Handle keyup events on input elements
 * @param {KeyboardEvent} e - Keyup event
 */
async function onKeyUp(e) {
  if (!activeInput || !settings?.enabled) {
    return;
  }


  const navigationKeys = ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'];
  if (navigationKeys.includes(e.key)) {
    return;
  }

  // Only respond to alphanumeric characters, @, !, and control keys
  const key = e.key;
  const isAlphanumeric = /^[a-zA-Z0-9-_]$/.test(key);
  const isAtSymbol = key === '@';
  const isExclamationSymbol = key === '!';
  const isBackspace = key === 'Backspace';
  const isDelete = key === 'Delete';
  const isEscape = key === 'Escape';
  const isEnter = key === 'Enter';
  
  // Ignore navigation keys, arrows, etc.
  if (!isAlphanumeric && !isAtSymbol && !isExclamationSymbol && !isBackspace && !isDelete && !isEscape && !isEnter) {
    return;
  }

  // If Escape was pressed, just hide overlay and don't process further
  if (isEscape) {
    if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.hideOverlay === 'function') {
      window.GitHubMentionsDOM.hideOverlay();
    }
    return;
  }

  try {
    const cursor = activeInput.selectionStart;
    const text = activeInput.value;
    
    // Check for @ mentions first
    const mentionQuery = scanForTrigger(text, cursor);
    // Check for / commands
    const commandInfo = scanForCommand(text, cursor);
    

    // Handle Enter key for command execution
    if (isEnter && commandInfo) {
      await executeCommand(commandInfo.command, activeInput);
      if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.hideOverlay === 'function') {
        window.GitHubMentionsDOM.hideOverlay();
      }
      return;
    }
  
    // Handle @ mentions
    if (mentionQuery !== null) {
      mentionStartPos = cursor - mentionQuery.length - 2; // position of the @@
    
      const users = await getUsersForSuggestions();
      const matches = filterUsers(users, mentionQuery);
  
      if (matches.length > 0) {
        // Check if DOM utilities are available
        if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.showOverlay === 'function') {
          window.GitHubMentionsDOM.showOverlay(matches, (user) => insertMention(user.username), activeInput);
        }
        return;
      }
    }
    
    // Handle ! commands
    if (commandInfo) {
      const commands = getAvailableCommands();
      const matches = filterCommands(commands, commandInfo.query);
      
      if (matches.length > 0) {
        if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.showOverlay === 'function') {
          // Transform commands to look like users for the overlay
          const commandItems = matches.map(cmd => ({
            username: cmd.command,
            name: cmd.description || cmd.command,
            isCommand: true,
            emoji: cmd.emoji || null
          }));
          window.GitHubMentionsDOM.showOverlay(commandItems, async (cmd) => {
            await executeCommand(cmd.username, activeInput);
          }, activeInput);
        }
        return;
      }
    }

    // Hide overlay if DOM utilities are available
    if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.hideOverlay === 'function') {
      window.GitHubMentionsDOM.hideOverlay();
    }
  } catch (error) {
    console.error('[GitHub Mentions+] Keyup processing error:', error);
    // Try to hide overlay even on error
    if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.hideOverlay === 'function') {
      window.GitHubMentionsDOM.hideOverlay();
    }
  }
}

/**
 * Handle input events on input elements
 * @param {Event} e - Input event
 */
function onInput(e) {
  if (!activeInput || !settings?.enabled) return;

  // Check contexts
  const cursor = activeInput.selectionStart;
  const text = activeInput.value;
  const mentionQuery = scanForTrigger(text, cursor);
  const commandInfo = scanForCommand(text, cursor);

  // If we're not in any valid context anymore, hide the overlay
  if (mentionQuery === null && !commandInfo) {
    if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.hideOverlay === 'function') {
      window.GitHubMentionsDOM.hideOverlay();
    }
  }
}

/**
 * Activate an input element for mentions
 * @param {HTMLElement} input - Input element to activate
 */
function activateInput(input) {

  try {
    activeInput = input;
    input.dataset.mentionEnhanced = 'true';
    
    // Add event listeners
    input.addEventListener('keyup', onKeyUp);
    input.addEventListener('input', onInput);
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.hideOverlay === 'function') {
          window.GitHubMentionsDOM.hideOverlay();
        }
      }, 100);
    });
  } catch (error) {
    // Silently handle activation errors
  }
}

/**
 * Scan page for input elements that need mention functionality
 */
function scanInputs() {
  try {
    const inputs = document.querySelectorAll('textarea, [contenteditable="true"]');
    const activeInput = document.activeElement;
    inputs.forEach(input => {
      if(input.id === activeInput.id) {
        activateInput(input);
      } else {
        input.dataset.mentionEnhanced = 'false';
      }
    });
  } catch (error) {
    // Silently handle scanning errors
  }
}

/**
 * Handle page visibility changes
 */
function handleVisibilityChange() {
  if (document.hidden) {
    if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.hideOverlay === 'function') {
      window.GitHubMentionsDOM.hideOverlay();
    }
  }
}

/**
 * Handle window resize
 */
function handleResize() {
  if (activeInput && window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.isOverlayVisible === 'function') {
    if (window.GitHubMentionsDOM.isOverlayVisible()) {
      if (typeof window.GitHubMentionsDOM.updateOverlayPosition === 'function') {
        window.GitHubMentionsDOM.updateOverlayPosition(activeInput);
      }
    }
  }
}

/**
 * Cleanup function
 */
function cleanup() {
  try {
    // Extra defensive check - ensure window exists
    if (typeof window !== 'undefined' && window.GitHubMentionsDOM) {
      // Check if the object and function exist
      if (typeof window.GitHubMentionsDOM.removeOverlay === 'function') {
        try {
          window.GitHubMentionsDOM.removeOverlay();
        } catch (overlayError) {
          // Silently handle overlay removal errors
        }
      }
    }
    
    // Fallback: manually remove any overlay elements we might have created
    try {
      const overlay = document.getElementById('github-mentions-overlay');
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    } catch (fallbackError) {
      // Silently handle fallback removal errors
    }
    
    // Reset state variables
    activeInput = null;
    mentionStartPos = null;
    isInitialized = false;
  } catch (error) {
    // Silently handle cleanup errors
  }
}

/**
 * Handle messages from popup
 * @param {Object} message - Message object
 * @param {Object} sender - Sender information
 * @param {Function} sendResponse - Response function
 */
async function handleMessage(message, sender, sendResponse) {
  try {
    // Check if utilities are available
    if (!window.GitHubMentionsAPI || !window.GitHubMentionsStorage) {
      sendResponse({ success: false, message: 'Extension utilities not available' });
      return;
    }
    
    switch (message.action || message.type) {
      case 'SETTINGS_UPDATED':
        // Handle settings update from popup
        settings = message.settings;
        
        // Reload cached users if needed
        cachedUsers = await window.GitHubMentionsStorage.getCachedUsers();
        
        // Force refresh any active command dropdown
        if (activeInput) {
          const cursor = activeInput.selectionStart;
          const text = activeInput.value;
          const commandInfo = scanForCommand(text, cursor);
          
          if (commandInfo) {
            const commands = getAvailableCommands();
            const matches = filterCommands(commands, commandInfo.query);
            
            if (matches.length > 0 && window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.showOverlay === 'function') {
              const commandItems = matches.map(cmd => ({
                username: cmd.command,
                name: cmd.description || cmd.command,
                isCommand: true,
                emoji: cmd.emoji || null
              }));
              window.GitHubMentionsDOM.showOverlay(commandItems, async (cmd) => {
                await executeCommand(cmd.username, activeInput);
              }, activeInput);
            } else if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.hideOverlay === 'function') {
              window.GitHubMentionsDOM.hideOverlay();
            }
          }
        }
        
        // No need to sendResponse for fire-and-forget messages
        return;
        
      case 'testEndpoint':
        const testResult = await window.GitHubMentionsAPI.testEndpoint(message.endpointUrl);
        sendResponse(testResult);
        break;
        
      case 'refreshUsers':
        // Get current settings to determine data source
        const currentSettings = await window.GitHubMentionsStorage.getSettings();
        
        if (currentSettings?.dataSource === 'direct' && currentSettings?.directJsonData) {
          // Handle direct JSON refresh
          try {
            const directUsers = JSON.parse(currentSettings.directJsonData);
            if (Array.isArray(directUsers) && directUsers.length > 0) {
              const validUsers = directUsers.filter(user => 
                user && typeof user === 'object' &&
                typeof user.username === 'string' &&
                typeof user.name === 'string' &&
                (user.avatar === undefined || typeof user.avatar === 'string')
              );
              
              if (validUsers.length > 0) {
                await window.GitHubMentionsStorage.setCachedUsers(validUsers);
                cachedUsers = validUsers;
                sendResponse({
                  success: true,
                  message: `Successfully loaded ${validUsers.length} users from direct JSON`,
                  userCount: validUsers.length
                });
              } else {
                sendResponse({
                  success: false,
                  message: 'No valid user data found in direct JSON'
                });
              }
            } else {
              sendResponse({
                success: false,
                message: 'Direct JSON data is invalid or empty'
              });
            }
          } catch (error) {
            sendResponse({
              success: false,
              message: `Failed to parse direct JSON: ${error.message}`
            });
          }
        } else if (currentSettings?.dataSource === 'endpoint' && currentSettings?.endpointUrl) {
          // Handle endpoint refresh (existing logic)
          settings = { ...settings, endpointUrl: currentSettings.endpointUrl };
          await window.GitHubMentionsStorage.setSettings(settings);
          
          const success = await loadUsersFromEndpoint();
          if (success) {
            sendResponse({
              success: true,
              message: `Successfully loaded ${cachedUsers.length} users`,
              userCount: cachedUsers.length
            });
          } else {
            sendResponse({
              success: false,
              message: 'Failed to load users from endpoint'
            });
          }
        } else {
          sendResponse({
            success: false,
            message: 'No valid data source configured'
          });
        }
        break;
        
      default:
        sendResponse({ success: false, message: 'Unknown action' });
    }
  } catch (error) {
    sendResponse({ success: false, message: error.message });
  }
}

/**
 * Handle clicks outside the overlay
 * @param {MouseEvent} e - Click event
 */
function handleClickOutside(e) {
  if (!window.GitHubMentionsDOM || typeof window.GitHubMentionsDOM.isOverlayVisible !== 'function') {
    return;
  }

  // Only handle if overlay is visible
  if (!window.GitHubMentionsDOM.isOverlayVisible()) {
    return;
  }

  // Check if click is outside our overlay
  const overlay = window.GitHubMentionsDOM.getOverlay();
  if (overlay && !overlay.contains(e.target)) {
    window.GitHubMentionsDOM.hideOverlay();
  }
}

/**
 * Handle keyboard navigation
 * @param {KeyboardEvent} e 
 */
function handleKeyNavigation(e) {
  if (!activeInput || !settings?.enabled) {
    return;
  }

  // First check if overlay handles the key
  if (window.GitHubMentionsDOM && typeof window.GitHubMentionsDOM.handleKeyNavigation === 'function') {
    const handled = window.GitHubMentionsDOM.handleKeyNavigation(e);
    if (handled === true) {
      return; // Navigation keys were handled
    } else if (handled && typeof handled === 'object') {
      // Enter was pressed and returned selected item
      const cursor = activeInput.selectionStart;
      const text = activeInput.value;
      const mentionQuery = scanForTrigger(text, cursor);
      const commandInfo = scanForCommand(text, cursor);
      
      if (mentionQuery !== null) {
        // Handle mention selection
        insertMention(handled.username);
      } else if (commandInfo && handled.isCommand) {
        // Handle command selection
        setTimeout(async () => {
          await executeCommand(handled.username, activeInput);
        }, 0);
      }
      
      window.GitHubMentionsDOM.hideOverlay();
      return;
    }
  }
  
  // Fallback handling for when overlay is not visible
  if (e.key === 'Enter' && activeInput && settings?.enabled) {
    const cursor = activeInput.selectionStart;
    const text = activeInput.value;
    const commandInfo = scanForCommand(text, cursor);
    
    if (commandInfo) {
      e.preventDefault();
      setTimeout(async () => {
        await executeCommand(commandInfo.command, activeInput);
      }, 0);
    }
  }
}

// Event listeners
document.addEventListener('visibilitychange', handleVisibilityChange);
window.addEventListener('resize', handleResize);
document.addEventListener('click', handleClickOutside);
document.addEventListener('keydown', handleKeyNavigation);

// Message listener for popup communication
chrome.runtime.onMessage.addListener(handleMessage);

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

// Cleanup on page unload - with extra safety
window.addEventListener('beforeunload', () => {
  // Only cleanup if we've actually initialized
  if (isInitialized) {
    cleanup();
  }
});

// Also cleanup on page hide for extra safety
window.addEventListener('pagehide', () => {
  if (isInitialized) {
    cleanup();
  }
});

// Export for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initialize,
    loadUsersFromEndpoint,
    insertMention,
    scanForTrigger,
    filterUsers
  };
}
  