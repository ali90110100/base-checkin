// Constants
const BASE_CHAIN_ID = 8453;
const STORAGE_KEY = 'base_checkins';

// State
let currentWallet = null;
let currentProvider = null;
let isConnected = false;
let farcasterSdk = null;
let isInFarcasterFrame = false;

// Detect if running inside Farcaster/Warpcast frame
function detectFarcasterFrame() {
  try {
    // Check if we're in an iframe (Warpcast embeds mini apps in iframes)
    if (window.self !== window.top) {
      return true;
    }
    // Check for Farcaster-specific URL params
    const params = new URLSearchParams(window.location.search);
    if (params.has('fc_frame') || params.has('fid')) {
      return true;
    }
  } catch (e) {
    // If we can't access window.top due to cross-origin, we're likely in a frame
    return true;
  }
  return false;
}

// Load Farcaster SDK safely - only when in frame
async function loadFarcasterSdk() {
  if (!isInFarcasterFrame) return null;
  if (farcasterSdk !== null) return farcasterSdk || null;
  try {
    const module = await import('https://esm.sh/@farcaster/frame-sdk');
    farcasterSdk = module.sdk || false;
    return farcasterSdk || null;
  } catch (e) {
    farcasterSdk = false;
    return null;
  }
}

// Safe Farcaster SDK access helpers
async function getFarcasterProvider() {
  if (!isInFarcasterFrame) return null;
  try {
    const sdk = await loadFarcasterSdk();
    if (!sdk) return null;
    
    // Try ethProvider first (newer SDK versions)
    if (sdk.wallet && sdk.wallet.ethProvider) {
      return sdk.wallet.ethProvider;
    }
    
    // Fallback to getEthereumProvider
    if (sdk.wallet && typeof sdk.wallet.getEthereumProvider === 'function') {
      const provider = await sdk.wallet.getEthereumProvider();
      return provider || null;
    }
    
    return null;
  } catch (e) {
    console.log('getFarcasterProvider error:', e);
    return null;
  }
}

// Get Farcaster user context (includes wallet address)
async function getFarcasterContext() {
  if (!isInFarcasterFrame) return null;
  try {
    const sdk = await loadFarcasterSdk();
    if (!sdk) return null;
    
    // Context might be a promise or direct object
    let context = sdk.context;
    if (typeof context === 'function') {
      context = await context();
    }
    if (context && typeof context.then === 'function') {
      context = await context;
    }
    
    console.log('Raw SDK context:', context);
    return context || null;
  } catch (e) {
    console.log('getFarcasterContext error:', e);
    return null;
  }
}

async function callFarcasterReady() {
  if (!isInFarcasterFrame) return;
  try {
    const sdk = await loadFarcasterSdk();
    if (!sdk || !sdk.actions) return;
    if (typeof sdk.actions.ready !== 'function') return;
    await sdk.actions.ready();
  } catch (e) {
    // Ignore
  }
}

async function callFarcasterOpenUrl(url) {
  if (!isInFarcasterFrame) return false;
  try {
    const sdk = await loadFarcasterSdk();
    if (!sdk || !sdk.actions) return false;
    if (typeof sdk.actions.openUrl !== 'function') return false;
    await sdk.actions.openUrl(url);
    return true;
  } catch (e) {
    return false;
  }
}

// Get wallet provider - MetaMask/Rabby first on localhost, then Farcaster
async function getProvider() {
  // On localhost or standalone browser, use MetaMask/Rabby directly
  if (!isInFarcasterFrame) {
    if (window.ethereum) {
      return window.ethereum;
    }
    throw new Error('Please install MetaMask or Rabby wallet.');
  }
  
  // In Farcaster frame, try Farcaster provider first
  const farcasterProvider = await getFarcasterProvider();
  if (farcasterProvider) {
    return farcasterProvider;
  }
  
  // Fallback to injected wallet in frame
  if (window.ethereum) {
    return window.ethereum;
  }
  
  throw new Error('No wallet found. Please try again in Warpcast.');
}

// DOM Elements
const connectScreen = document.getElementById('connect-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const profileScreen = document.getElementById('profile-screen');
const connectBtn = document.getElementById('connect-btn');
const checkinBtn = document.getElementById('checkin-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const shareBtn = document.getElementById('share-btn');
const streakValue = document.getElementById('streak-value');
const totalValue = document.getElementById('total-value');
const statusCard = document.getElementById('status-card');
const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');
const walletAddress = document.getElementById('wallet-address');
const calendarGrid = document.getElementById('calendar-grid');
const streakCardModal = document.getElementById('streak-card-modal');
const streakCardCanvas = document.getElementById('streak-card-canvas');
const copyCardBtn = document.getElementById('copy-card-btn');
const downloadCardBtn = document.getElementById('download-card-btn');
const openCardBtn = document.getElementById('open-card-btn');
const shareCardBtn = document.getElementById('share-card-btn');
const closeModalBtn = document.getElementById('close-modal-btn');

// Initialize app
async function init() {
  try {
    // Detect environment first
    isInFarcasterFrame = detectFarcasterFrame();
    console.log('Running in Farcaster frame:', isInFarcasterFrame);
    
    // Initialize Farcaster SDK (only if in frame)
    await callFarcasterReady();
    
    // Check for profile view mode
    const urlParams = new URLSearchParams(window.location.search);
    const profileUser = urlParams.get('user');
    
    if (profileUser) {
      showProfileScreen(profileUser);
      return;
    }

    // Setup event listeners
    setupEventListeners();
    
    // Try to restore session from localStorage first
    const savedWallet = localStorage.getItem('connected_wallet');
    if (savedWallet) {
      currentWallet = savedWallet;
      try {
        currentProvider = await getProvider();
      } catch (e) {
        console.log('Could not restore provider');
      }
      showDashboard();
      return;
    }
    
    // In Farcaster, try to auto-connect from context
    if (isInFarcasterFrame) {
      const context = await getFarcasterContext();
      console.log('Farcaster context on init:', context);
      
      if (context && context.user) {
        const address = context.user.connectedAddress || 
                       (context.user.verifiedAddresses && context.user.verifiedAddresses[0]);
        if (address) {
          currentWallet = address;
          try {
            currentProvider = await getProvider();
          } catch (e) {
            console.log('Could not get provider');
          }
          localStorage.setItem('connected_wallet', currentWallet);
          isConnected = true;
          showDashboard();
          return;
        }
      }
    }
  } catch (error) {
    console.error('Failed to initialize:', error);
  }
}

// Event Listeners
function setupEventListeners() {
  connectBtn.addEventListener('click', handleConnect);
  checkinBtn.addEventListener('click', handleCheckIn);
  disconnectBtn.addEventListener('click', handleDisconnect);
  shareBtn.addEventListener('click', showStreakCard);
  copyCardBtn.addEventListener('click', handleCopyImage);
  downloadCardBtn.addEventListener('click', downloadStreakCard);
  openCardBtn.addEventListener('click', openImageInNewTab);
  shareCardBtn.addEventListener('click', shareOnFarcaster);
  closeModalBtn.addEventListener('click', closeModal);
  
  // Touch support
  document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('touchstart', () => {}, { passive: true });
  });
}

// Connect wallet
async function handleConnect() {
  connectBtn.classList.add('loading');
  connectBtn.disabled = true;
  
  try {
    // In Farcaster, try to get address from context first
    if (isInFarcasterFrame) {
      const context = await getFarcasterContext();
      console.log('Farcaster context:', context);
      
      // Check if we have a connected address in context
      if (context && context.user && context.user.connectedAddress) {
        currentWallet = context.user.connectedAddress;
        currentProvider = await getProvider();
        localStorage.setItem('connected_wallet', currentWallet);
        isConnected = true;
        showDashboard();
        return;
      }
      
      // Try verifiedAddresses if connectedAddress not available
      if (context && context.user && context.user.verifiedAddresses && context.user.verifiedAddresses.length > 0) {
        currentWallet = context.user.verifiedAddresses[0];
        currentProvider = await getProvider();
        localStorage.setItem('connected_wallet', currentWallet);
        isConnected = true;
        showDashboard();
        return;
      }
    }
    
    // Fallback: Request accounts via provider
    const provider = await getProvider();
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    
    if (accounts && accounts.length > 0) {
      currentWallet = accounts[0];
      currentProvider = provider;
      localStorage.setItem('connected_wallet', currentWallet);
      isConnected = true;
      showDashboard();
    }
  } catch (error) {
    console.error('Connection failed:', error);
    let msg = 'Failed to connect wallet.';
    if (error && typeof error.message === 'string') {
      msg = error.message;
    }
    if (!window.ethereum && !isInFarcasterFrame) {
      msg = 'Please install MetaMask or Rabby wallet to continue.';
    }
    alert(msg);
  } finally {
    connectBtn.classList.remove('loading');
    connectBtn.disabled = false;
  }
}

// Disconnect wallet
function handleDisconnect() {
  currentWallet = null;
  currentProvider = null;
  isConnected = false;
  localStorage.removeItem('connected_wallet');
  showScreen('connect');
}

// Convert string to hex
function stringToHex(str) {
  let hex = '0x';
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

// Check in
async function handleCheckIn() {
  if (!currentWallet) return;
  
  const today = getTodayString();
  const userData = getUserData(currentWallet);
  
  // Check if already checked in today
  if (userData.dates.includes(today)) {
    alert('You have already checked in today!');
    return;
  }
  
  checkinBtn.classList.add('loading');
  checkinBtn.disabled = true;
  
  try {
    const provider = currentProvider || await getProvider();
    
    // Create message to sign
    const message = `Base Check-In | ${currentWallet} | ${today}`;
    const hexMessage = stringToHex(message);
    
    console.log('Signing message:', message);
    console.log('Wallet:', currentWallet);
    console.log('Provider:', provider);
    
    let signature = null;
    
    // Try Farcaster SDK signMessage first (if available)
    if (isInFarcasterFrame) {
      try {
        const sdk = await loadFarcasterSdk();
        if (sdk && sdk.actions && typeof sdk.actions.signMessage === 'function') {
          console.log('Using Farcaster signMessage');
          // Try different parameter formats
          let result = null;
          try {
            result = await sdk.actions.signMessage({ message: message });
          } catch (e1) {
            console.log('signMessage with object failed, trying direct:', e1);
            try {
              result = await sdk.actions.signMessage(message);
            } catch (e2) {
              console.log('signMessage direct failed:', e2);
            }
          }
          if (result) {
            signature = result.signature || result;
            console.log('Farcaster signMessage result:', result);
          }
        }
      } catch (e) {
        console.log('Farcaster signMessage failed:', e);
      }
    }
    
    // Fallback to provider personal_sign
    if (!signature && provider) {
      try {
        // Try with hex message first (Farcaster preference)
        console.log('Trying personal_sign with hex message');
        signature = await provider.request({
          method: 'personal_sign',
          params: [hexMessage, currentWallet]
        });
      } catch (e) {
        console.log('Hex sign failed, trying plain message:', e);
        // Fallback to plain message
        signature = await provider.request({
          method: 'personal_sign',
          params: [message, currentWallet]
        });
      }
    }
    
    if (signature) {
      console.log('Signature received:', signature);
      // Save check-in
      saveCheckIn(currentWallet, today, signature);
      updateDashboard();
      showStreakCard();
    } else {
      throw new Error('No signature received');
    }
  } catch (error) {
    console.error('Check-in failed:', error);
    alert('Check-in failed. Please try again.');
  } finally {
    checkinBtn.classList.remove('loading');
    checkinBtn.disabled = false;
  }
}

// Data management
function getUserData(wallet) {
  const allData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  return allData[wallet.toLowerCase()] || {
    dates: [],
    streak: 0,
    total: 0,
    lastDate: null,
    signatures: {}
  };
}

function saveCheckIn(wallet, date, signature) {
  const allData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  const walletKey = wallet.toLowerCase();
  const userData = allData[walletKey] || {
    dates: [],
    streak: 0,
    total: 0,
    lastDate: null,
    signatures: {}
  };
  
  // Add date
  if (!userData.dates.includes(date)) {
    userData.dates.push(date);
    userData.dates.sort();
  }
  
  // Save signature
  userData.signatures[date] = signature;
  
  // Update total
  userData.total = userData.dates.length;
  
  // Calculate streak
  userData.streak = calculateStreak(userData.dates);
  userData.lastDate = date;
  
  allData[walletKey] = userData;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(allData));
}

function calculateStreak(dates) {
  if (dates.length === 0) return 0;
  
  const sortedDates = [...dates].sort().reverse();
  const today = getTodayString();
  const yesterday = getYesterdayString();
  
  // Check if streak is still active
  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) {
    return 0;
  }
  
  let streak = 1;
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const current = new Date(sortedDates[i]);
    const next = new Date(sortedDates[i + 1]);
    const diffDays = Math.floor((current - next) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  
  return streak;
}

// Date utilities
function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function getYesterdayString() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

// Screen management
function showScreen(screen) {
  connectScreen.classList.remove('active');
  dashboardScreen.classList.remove('active');
  profileScreen.classList.remove('active');
  
  switch (screen) {
    case 'connect':
      connectScreen.classList.add('active');
      break;
    case 'dashboard':
      dashboardScreen.classList.add('active');
      break;
    case 'profile':
      profileScreen.classList.add('active');
      break;
  }
}

function showDashboard() {
  showScreen('dashboard');
  updateDashboard();
}

function updateDashboard() {
  if (!currentWallet) return;
  
  const userData = getUserData(currentWallet);
  const today = getTodayString();
  const checkedInToday = userData.dates.includes(today);
  
  // Update stats
  streakValue.textContent = userData.streak;
  totalValue.textContent = userData.total;
  
  // Update wallet address
  walletAddress.textContent = formatAddress(currentWallet);
  
  // Update status
  if (checkedInToday) {
    statusCard.classList.add('checked-in');
    statusIcon.textContent = '✓';
    statusText.textContent = 'Checked in today!';
    checkinBtn.textContent = 'Already Checked In';
    checkinBtn.disabled = true;
  } else {
    statusCard.classList.remove('checked-in');
    statusIcon.textContent = '○';
    statusText.textContent = 'Not checked in yet';
    checkinBtn.textContent = 'Check In Now';
    checkinBtn.disabled = false;
  }
  
  // Render calendar
  renderCalendar(calendarGrid, userData.dates);
}

// Profile screen
function showProfileScreen(wallet) {
  showScreen('profile');
  
  const userData = getUserData(wallet);
  
  document.getElementById('profile-wallet').textContent = wallet;
  document.getElementById('profile-streak').textContent = userData.streak;
  document.getElementById('profile-total').textContent = userData.total;
  document.getElementById('profile-last-date').textContent = userData.lastDate || 'Never';
  
  renderCalendar(document.getElementById('profile-calendar'), userData.dates);
}

// Calendar rendering
function renderCalendar(container, checkedDates) {
  container.innerHTML = '';
  
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 34); // Show last 35 days
  
  for (let i = 0; i < 35; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day';
    dayEl.textContent = date.getDate();
    
    if (checkedDates.includes(dateStr)) {
      dayEl.classList.add('checked');
    }
    
    if (dateStr === getTodayString()) {
      dayEl.classList.add('today');
    }
    
    container.appendChild(dayEl);
  }
}

// Streak card
function showStreakCard() {
  if (!currentWallet) return;
  
  const userData = getUserData(currentWallet);
  generateStreakCard(userData);
  streakCardModal.classList.add('active');
}

function generateStreakCard(userData) {
  const ctx = streakCardCanvas.getContext('2d');
  const width = 600;
  const height = 400;
  
  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0052FF');
  gradient.addColorStop(1, '#0040CC');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Add subtle pattern
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 50 + 20, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Title
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = 'bold 32px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Base Check-In', width / 2, 60);
  
  // Checkmark icon
  ctx.fillStyle = 'white';
  ctx.font = 'bold 80px Arial';
  ctx.fillText('✓', width / 2, 160);
  
  // Streak
  ctx.fillStyle = 'white';
  ctx.font = 'bold 72px JetBrains Mono, monospace';
  ctx.fillText(`${userData.streak}`, width / 2, 260);
  
  ctx.font = '24px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fillText('DAY STREAK', width / 2, 295);
  
  // Wallet
  ctx.font = '16px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillText(formatAddress(currentWallet), width / 2, 350);
  
  // Date
  ctx.fillText(getTodayString(), width / 2, 380);
}

function downloadStreakCard() {
  const filename = 'base-checkin-' + getTodayString() + '.png';
  
  try {
    // Get PNG data URL
    const dataUrl = streakCardCanvas.toDataURL('image/png');
    
    // Validate it's actually a PNG
    if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
      throw new Error('Invalid image data');
    }
    
    // Create and trigger download
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log('Download triggered:', filename);
  } catch (e) {
    console.error('Download error:', e);
    // Fallback: open in new tab for manual save
    openImageInNewTab();
  }
}

function openImageInNewTab() {
  try {
    const dataUrl = streakCardCanvas.toDataURL('image/png');
    const newTab = window.open();
    if (newTab) {
      newTab.document.write('<html><head><title>Base Check-In Card</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000;"><img src="' + dataUrl + '" style="max-width:100%;"/></body></html>');
      newTab.document.close();
      alert('Image opened in new tab. Right-click and "Save image as..." to download.');
    } else {
      alert('Please allow popups to save the image.');
    }
  } catch (e) {
    alert('Could not open image. Please use Copy instead.');
  }
}

async function copyImageToClipboard() {
  try {
    const blob = await new Promise(resolve => {
      streakCardCanvas.toBlob(resolve, 'image/png');
    });
    
    if (blob && navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      return true;
    }
  } catch (e) {
    console.log('Clipboard copy failed:', e);
  }
  return false;
}

async function handleCopyImage() {
  const copied = await copyImageToClipboard();
  if (copied) {
    alert('Image copied to clipboard!');
  } else {
    alert('Could not copy image. Please use Save Image instead.');
  }
}

async function shareOnFarcaster() {
  try {
    const userData = getUserData(currentWallet);
    const text = `Just checked in on Base! 🔵\n\n🔥 ${userData.streak} day streak\n📅 ${userData.total} total days\n\nProof of human, every day.`;
    
    const shareUrl = `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}`;
    
    // Try Farcaster SDK first, fallback to window.open
    const opened = await callFarcasterOpenUrl(shareUrl);
    if (!opened) {
      window.open(shareUrl, '_blank');
    }
    
    closeModal();
  } catch (error) {
    console.error('Share failed');
  }
}

function closeModal() {
  streakCardModal.classList.remove('active');
}

// Close modal when clicking outside content
streakCardModal.addEventListener('click', function(e) {
  if (e.target === streakCardModal) {
    closeModal();
  }
});

// Utilities
function formatAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

