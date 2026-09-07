const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('plcAPI', {
  connect: (config) => ipcRenderer.invoke('modbus:connect', config),
  disconnect: () => ipcRenderer.invoke('modbus:disconnect'),
  readOnce: () => ipcRenderer.invoke('modbus:readOnce'),
  startPolling: (config) => ipcRenderer.invoke('modbus:startPolling', config),
  stopPolling: () => ipcRenderer.invoke('modbus:stopPolling'),

  start: () => ipcRenderer.invoke('modbus:start'),
  stop: () => ipcRenderer.invoke('modbus:stop'),
  setQuantity: (value) => ipcRenderer.invoke('modbus:setQuantity', value),
  setFillingDirection: (direction) => ipcRenderer.invoke('modbus:setFillingDirection', direction),
  writeBit: (target, value) => ipcRenderer.invoke('modbus:writeBit', { target, value }),

  onData: (callback) => {
    ipcRenderer.removeAllListeners('modbus:data');
    ipcRenderer.on('modbus:data', (event, data) => callback(data));
  },
});
