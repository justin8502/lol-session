const {
  contextBridge,
  ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld(
  "api", {
    invoke: (channel, data) => {
      let validChannels = ["reset", "updateValues", "updateQueue", "electronStoreGet", "electronStoreSet", "updateStorageLocation"];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data); 
      }
    },
    mainSendOnce: (callback) => ipcRenderer.on('main-send-once', (_event, value) => callback(value)),
    mainSendOnceLoL: (callback) => ipcRenderer.on('main-send-once-lol', (_event, value) => callback(value)),
    mainSendTextReset: (callback) => ipcRenderer.on('main-send-text-reset', (_event, value) => callback(value)),
    mainSendConnectionReset: (callback) => ipcRenderer.on('main-send-connection-reset', (_event, value) => callback(value)),
    
  },
);