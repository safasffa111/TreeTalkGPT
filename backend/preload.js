const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopShell', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  close: () => ipcRenderer.invoke('window:close'),
  onWindowStateChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('window:state-changed', handler);
    return () => ipcRenderer.removeListener('window:state-changed', handler);
  },
  meta: () => ipcRenderer.invoke('app:meta'),
  aiChat: (payload) => ipcRenderer.invoke('ai:chat', payload),
  readLearningSession: () => ipcRenderer.invoke('learning-session:read-current'),
  writeLearningSession: (payload) => ipcRenderer.invoke('learning-session:write-current', payload),
  clearLearningSession: () => ipcRenderer.invoke('learning-session:clear-current'),
  listLearningSessions: () => ipcRenderer.invoke('learning-session:list'),
  clearAllLearningSessions: (payload) => ipcRenderer.invoke('learning-session:clear-all', payload),
  readLearningSessionById: (sessionId) => ipcRenderer.invoke('learning-session:read-by-id', sessionId),
  writeLearningSessionById: (sessionId, payload) => ipcRenderer.invoke('learning-session:write-by-id', sessionId, payload),
  saveAttachment: (payload) => ipcRenderer.invoke('attachment:save-local', payload),
  openLocalAttachment: (payload) => ipcRenderer.invoke('attachment:open-local', payload),
  deleteAttachments: (payload) => ipcRenderer.invoke('attachment:delete-local', payload)
});
