const statusBadge = document.getElementById('statusBadge');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const errorMsg = document.getElementById('errorMsg');
const lastUpdate = document.getElementById('lastUpdate');

const startBtn = document.getElementById('startBtn');
const startDot = document.getElementById('startDot');
const stopBtn = document.getElementById('stopBtn');

const qtyInput = document.getElementById('qtyInput');
const qtySetBtn = document.getElementById('qtySetBtn');

const fillOneBtn = document.getElementById('fillOneBtn');
const fillTwoBtn = document.getElementById('fillTwoBtn');
const fillBothBtn = document.getElementById('fillBothBtn');
const fillDirValue = document.getElementById('fillDirValue');

const refillToggle = document.getElementById('refillToggle');
const fill1Toggle = document.getElementById('fill1Toggle');
const fill2Toggle = document.getElementById('fill2Toggle');

const stockValue = document.getElementById('stockValue');
const fill1Value = document.getElementById('fill1Value');
const fill2Value = document.getElementById('fill2Value');
const rfidValue = document.getElementById('rfidValue');
const statusValue = document.getElementById('statusValue');

const m57Indicator = document.getElementById('m57Indicator');
const captureLog = document.getElementById('captureLog');
const lastCaptureImg = document.getElementById('lastCaptureImg');
const cameraVideo = document.getElementById('cameraVideo');
const captureCanvas = document.getElementById('captureCanvas');

let captureCount = 0;
let cameraReady = false;

let isConnected = false;

// Local cache for the write-only bits (M153/154/155) so the toggle reflects
// what we last commanded, since these are write-only on the PLC side.
const bitState = { refill: false, fill1: false, fill2: false };

function getConfig() {
  return {
    ip: document.getElementById('ip').value.trim(),
    port: document.getElementById('port').value,
    slaveId: document.getElementById('slaveId').value,
    interval: document.getElementById('interval').value,
  };
}

function showError(message) {
  errorMsg.textContent = message || '';
}

function setConnectedUI(connected) {
  isConnected = connected;
  statusBadge.textContent = connected ? 'Connected' : 'Disconnected';
  statusBadge.className = `status ${connected ? 'connected' : 'disconnected'}`;
  connectBtn.disabled = connected;
  disconnectBtn.disabled = !connected;

  [startBtn, stopBtn, qtySetBtn, fillOneBtn, fillTwoBtn, fillBothBtn].forEach((btn) => {
    btn.disabled = !connected;
  });
  [refillToggle, fill1Toggle, fill2Toggle].forEach((toggle) => {
    toggle.disabled = !connected;
  });

  if (!connected) {
    startDot.classList.remove('blinking');
  }
}

// ---------------------------------------------------------------------------
// Connect / Disconnect
// ---------------------------------------------------------------------------
connectBtn.addEventListener('click', async () => {
  showError('');
  const config = getConfig();
  const result = await window.plcAPI.connect(config);
  if (result.ok) {
    setConnectedUI(true);
    await window.plcAPI.startPolling(config);
  } else {
    showError(`Connection failed: ${result.error}`);
    setConnectedUI(false);
  }
});

disconnectBtn.addEventListener('click', async () => {
  await window.plcAPI.stopPolling();
  await window.plcAPI.disconnect();
  setConnectedUI(false);
});

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------
startBtn.addEventListener('click', async () => {
  showError('');
  const result = await window.plcAPI.start();
  if (!result.ok) showError(`Start failed: ${result.error}`);
});

stopBtn.addEventListener('click', async () => {
  showError('');
  stopBtn.disabled = true;
  const result = await window.plcAPI.stop();
  stopBtn.disabled = !isConnected;
  if (!result.ok) showError(`Stop failed: ${result.error}`);
});

// ---------------------------------------------------------------------------
// Quantity (D0), range 1-5
// ---------------------------------------------------------------------------
qtySetBtn.addEventListener('click', async () => {
  showError('');
  const value = Number(qtyInput.value);
  const result = await window.plcAPI.setQuantity(value);
  if (!result.ok) showError(`Set quantity failed: ${result.error}`);
});

// ---------------------------------------------------------------------------
// Filling direction (D2): One = -1, Two = +1
// ---------------------------------------------------------------------------
fillOneBtn.addEventListener('click', async () => {
  showError('');
  const result = await window.plcAPI.setFillingDirection('one');
  if (!result.ok) showError(`Filling One failed: ${result.error}`);
});

fillTwoBtn.addEventListener('click', async () => {
  showError('');
  const result = await window.plcAPI.setFillingDirection('two');
  if (!result.ok) showError(`Filling Two failed: ${result.error}`);
});

fillBothBtn.addEventListener('click', async () => {
  showError('');
  const result = await window.plcAPI.setFillingDirection('both');
  if (!result.ok) showError(`Filling Both failed: ${result.error}`);
});

// ---------------------------------------------------------------------------
// Bit controls (M153 / M154 / M155) — write-only 0/1
// ---------------------------------------------------------------------------
function bindBitToggle(toggleEl, target) {
  toggleEl.addEventListener('change', async () => {
    showError('');
    const value = toggleEl.checked ? 1 : 0;
    const result = await window.plcAPI.writeBit(target, value);
    if (!result.ok) {
      showError(`Write ${target} failed: ${result.error}`);
      toggleEl.checked = !toggleEl.checked; // revert on failure
      return;
    }
    bitState[target] = !!value;
  });
}

bindBitToggle(refillToggle, 'refill');
bindBitToggle(fill1Toggle, 'fill1');
bindBitToggle(fill2Toggle, 'fill2');

// ---------------------------------------------------------------------------
// Camera: request the webcam once at startup, keep the <video> element fed.
// ---------------------------------------------------------------------------
async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    cameraVideo.srcObject = stream;
    await new Promise((resolve) => {
      cameraVideo.onloadedmetadata = resolve;
    });
    cameraReady = true;
    captureLog.textContent = 'Camera ready. Waiting for M57 trigger...';
  } catch (err) {
    cameraReady = false;
    captureLog.textContent = `Camera failed to start: ${err.message}`;
    showError(`Camera unavailable: ${err.message}`);
  }
}

async function captureImage() {
  if (!cameraReady || !cameraVideo.videoWidth) {
    captureLog.textContent = 'M57 triggered, but camera was not ready — no image captured.';
    showError('Camera not ready — cannot capture image.');
    return;
  }
  captureCanvas.width = cameraVideo.videoWidth;
  captureCanvas.height = cameraVideo.videoHeight;
  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(cameraVideo, 0, 0, captureCanvas.width, captureCanvas.height);
  const dataUrl = captureCanvas.toDataURL('image/png');

  const result = await window.plcAPI.saveImage(dataUrl);
  captureCount += 1;

  lastCaptureImg.src = dataUrl;
  lastCaptureImg.classList.add('visible');

  if (result.ok) {
    captureLog.textContent = `Capture #${captureCount} saved: ${result.path}`;
  } else {
    captureLog.textContent = `Capture #${captureCount} taken, but save failed: ${result.error}`;
  }
}

initCamera();

// ---------------------------------------------------------------------------
// Live data from polling
// ---------------------------------------------------------------------------
window.plcAPI.onData((result) => {
  if (!result.ok) {
    showError(`Error: ${result.error}`);
    return;
  }
  showError('');

  startDot.classList.toggle('blinking', result.running);
  stockValue.textContent = result.containerStock ?? '--';
  fill1Value.textContent = result.fillingOneLevel ?? '--';
  fill2Value.textContent = result.fillingTwoLevel ?? '--';
  rfidValue.textContent = result.rfidTag || '--';
  statusValue.textContent = result.statusText || '--';
  fillDirValue.textContent = result.fillDirection ?? '--';

  m57Indicator.textContent = result.cameraTriggerHigh ? 'HIGH' : 'LOW';
  m57Indicator.className = `pill ${result.cameraTriggerHigh ? 'on' : 'off'}`;

  if (result.fireCapture) {
    captureImage();
  }

  lastUpdate.textContent = `Last update: ${new Date(result.timestamp).toLocaleTimeString()}`;
});