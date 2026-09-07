const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const ModbusRTU = require('modbus-serial');

let mainWindow;
const client = new ModbusRTU();

let pollTimer = null;
let stopPulseTimer = null;

// ---------------------------------------------------------------------------
// Address map. This PLC exposes M (bit) and D (word) areas directly, and the
// hardware's own element number IS the 0-based Modbus protocol address:
//   M100 -> Coil address 100        (FC01 read / FC05 write)
//   D2   -> Holding register 2      (FC03 read / FC06 write)
// (Confirmed against the AS-series address table: hex base for both M and D
// areas is 0000, so element number == protocol address.)
// ---------------------------------------------------------------------------
const ADDR = {
  START_M100: 100, // Start, blinks while running
  STOP_M101: 101, // Stop, NC contact -> normally 1, pulse to 0 for 1s to stop
  QTY_D0: 0, // Quantity, software-set, 1-5
  FILL_DIR_D2: 2, // Filling One = -1, Filling Two = +1
  STOCK_D11: 11, // Container stock, read-only
  FILL1_D12: 12, // Filling one level, read-only
  FILL2_D13: 13, // Filling two level, read-only
  REFILL_M153: 153, // Stock refill bit, write-only 0/1
  FILL1_BIT_M154: 154, // Filling one bit, write-only 0/1
  FILL2_BIT_M155: 155, // Filling two bit, write-only 0/1
  STATUS_D1000: 1000, // Status text, read-only
  RFID_D50: 50, // RFID tag, read-only
};

// How many consecutive 16-bit registers to pull for multi-register values.
const STATUS_REG_COUNT = 8; // D1000 status text (ASCII, word order reversed, bytes swapped)
const RFID_REG_COUNT = 1; // D50 RFID tag - single register, plain 4-digit number

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    resizable: true,
    backgroundColor: '#173681',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopPolling();
  if (client.isOpen) client.close(() => {});
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
ipcMain.handle('modbus:connect', async (event, config) => {
  const { ip, port, slaveId } = config;
  try {
    if (client.isOpen) {
      await new Promise((resolve) => client.close(resolve));
    }
    await client.connectTCP(ip, { port: Number(port) || 502 });
    client.setID(Number(slaveId) || 1);
    client.setTimeout(2000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('modbus:disconnect', async () => {
  stopPolling();
  if (stopPulseTimer) clearTimeout(stopPulseTimer);
  try {
    if (client.isOpen) {
      await new Promise((resolve) => client.close(resolve));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------------------
// Polling (read-only values + status bits)
// ---------------------------------------------------------------------------
ipcMain.handle('modbus:readOnce', async () => readAll());

ipcMain.handle('modbus:startPolling', async (event, config) => {
  stopPolling();
  const intervalMs = Number(config.interval) || 800;

  pollTimer = setInterval(async () => {
    const result = await readAll();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('modbus:data', result);
    }
  }, intervalMs);

  return { ok: true };
});

ipcMain.handle('modbus:stopPolling', async () => {
  stopPolling();
  return { ok: true };
});

async function readAll() {
  if (!client.isOpen) {
    return { ok: false, error: 'Not connected to PLC' };
  }

  try {
    const [
      startRes,
      stopRes,
      qtyRes,
      fillDirRes,
      stockRes,
      fill1Res,
      fill2Res,
      statusRes,
      rfidRes,
    ] = await Promise.all([
      client.readCoils(ADDR.START_M100, 1),
      client.readCoils(ADDR.STOP_M101, 1),
      client.readHoldingRegisters(ADDR.QTY_D0, 1),
      client.readHoldingRegisters(ADDR.FILL_DIR_D2, 1),
      client.readHoldingRegisters(ADDR.STOCK_D11, 1),
      client.readHoldingRegisters(ADDR.FILL1_D12, 1),
      client.readHoldingRegisters(ADDR.FILL2_D13, 1),
      client.readHoldingRegisters(ADDR.STATUS_D1000, STATUS_REG_COUNT),
      client.readHoldingRegisters(ADDR.RFID_D50, RFID_REG_COUNT),
    ]);

    return {
      ok: true,
      running: !!startRes.data[0],
      stopContact: !!stopRes.data[0],
      quantity: qtyRes.data[0],
      fillDirection: toSigned16(fillDirRes.data[0]),
      containerStock: stockRes.data[0],
      fillingOneLevel: fill1Res.data[0],
      fillingTwoLevel: fill2Res.data[0],
      statusText: registersToAscii(statusRes.data),
      rfidTag: registersToDecimal(rfidRes.data),
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Start: set M100 = 1. The PLC itself blinks it; the UI mirrors that state.
ipcMain.handle('modbus:start', async () => writeCoilSafe(ADDR.START_M100, true));

// Stop: M101 is a Normally-Closed contact (rests at 1). Pulse it to 0 for
// exactly 1 second, then release it back to 1, to trigger a stop.
ipcMain.handle('modbus:stop', async () => {
  if (!client.isOpen) return { ok: false, error: 'Not connected to PLC' };
  try {
    await client.writeCoil(ADDR.STOP_M101, false);
    await new Promise((resolve) => {
      stopPulseTimer = setTimeout(resolve, 1000);
    });
    await client.writeCoil(ADDR.STOP_M101, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Quantity: D0, software sets 1-5.
ipcMain.handle('modbus:setQuantity', async (event, value) => {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 1 || qty > 5) {
    return { ok: false, error: 'Quantity must be an integer between 1 and 5' };
  }
  return writeRegisterSafe(ADDR.QTY_D0, qty);
});

// Filling direction: D2. Filling One = -1, Filling Two = +1, Both = 2.
ipcMain.handle('modbus:setFillingDirection', async (event, direction) => {
  const map = { one: -1, two: 1, both: 2 };
  const value = map[direction];
  if (value === undefined) {
    return { ok: false, error: "direction must be 'one', 'two', or 'both'" };
  }
  return writeRegisterSafe(ADDR.FILL_DIR_D2, toUnsigned16(value));
});

// Bit writes: M153 (stock refill), M154 (filling one), M155 (filling two).
// Each accepts only 0 or 1.
ipcMain.handle('modbus:writeBit', async (event, { target, value }) => {
  const map = {
    refill: ADDR.REFILL_M153,
    fill1: ADDR.FILL1_BIT_M154,
    fill2: ADDR.FILL2_BIT_M155,
  };
  const address = map[target];
  if (address === undefined) {
    return { ok: false, error: `Unknown bit target: ${target}` };
  }
  if (value !== 0 && value !== 1) {
    return { ok: false, error: 'Value must be 0 or 1' };
  }
  return writeCoilSafe(address, !!value);
});

async function writeCoilSafe(address, boolValue) {
  if (!client.isOpen) return { ok: false, error: 'Not connected to PLC' };
  try {
    await client.writeCoil(address, boolValue);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function writeRegisterSafe(address, value) {
  if (!client.isOpen) return { ok: false, error: 'Not connected to PLC' };
  try {
    await client.writeRegister(address, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toSigned16(value) {
  if (value === undefined) return 0;
  return value > 0x7fff ? value - 0x10000 : value;
}

function toUnsigned16(value) {
  return value < 0 ? 0x10000 + value : value;
}

function registersToAscii(registers) {
  // Confirmed from an actual jumbled reading: "BATCH COMPLETE" was coming
  // out as "ETPMEL HOCABCT" — every 2-character register was byte-swapped
  // (BA->AB, TC->CT, H_-> _H, etc.) with NO word/register reordering
  // needed. So: keep registers in their natural address order, and just
  // swap the low/high byte within each register.
  let text = '';
  registers.forEach((reg) => {
    const hi = (reg >> 8) & 0xff;
    const lo = reg & 0xff;
    [lo, hi].forEach((code) => {
      if (code >= 32 && code <= 126) text += String.fromCharCode(code);
    });
  });
  return text.trim();
}

function registersToDecimal(registers) {
  // RFID tag is a single register holding a plain 4-digit decimal number.
  const value = registers[0] ?? 0;
  return String(value).padStart(4, '0');
}