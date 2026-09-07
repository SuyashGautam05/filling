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

  lastUpdate.textContent = `Last update: ${new Date(result.timestamp).toLocaleTimeString()}`;
});