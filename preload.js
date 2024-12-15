// boilerplate code for electron...
const {
  contextBridge,
  ipcRenderer
} = require("electron");

// end boilerplate code, on to your stuff..

/**
* HERE YOU WILL EXPOSE YOUR 'myfunc' FROM main.js
* TO THE FRONTEND.
* (remember in main.js, you're putting preload.js
* in the electron window? your frontend js will be able
* to access this stuff as a result.
*/
contextBridge.exposeInMainWorld(
  "api", {
    invoke: (channel, data) => {
      let validChannels = ["reset", "updateValues", "updateQueue", "electronStoreGet", "electronStoreSet", "updateStorageLocation"]; // list of ipcMain.handle channels you want access in frontend to
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data); 
      }
    },
    mainSendOnce: (callback) => ipcRenderer.on('main-send-once', (_event, value) => callback(value)),
    mainSendOnceLoL: (callback) => ipcRenderer.on('main-send-once-lol', (_event, value) => callback(value)),
    mainSendTextReset: (callback) => ipcRenderer.on('main-send-text-reset', (_event, value) => callback(value)),
    
  },
);