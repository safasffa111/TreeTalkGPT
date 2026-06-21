// Local JSON persistence for the current learning workspace.
//
// This module intentionally stays outside renderers/controllers. It watches the
// central store, serializes the stable learning workspace into a JSON document,
// and restores it on startup. The schema is designed to be extended into a
// future multi-session knowledge repository.
(function () {
  const schemaVersion = 1;
  const localStorageFallbackKey = 'ai-learning-stack.current-session.v1';
  const localStorageIndexKey = 'ai-learning-stack.sessions-index.v1';

  const clone = (value) => {
    if (value === undefined || value === null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_) {}
    }
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };

  const sanitizeAttachmentForJson = (attachment = {}) => ({
    id: attachment.id || '',
    name: attachment.name || attachment.filename || '未命名附件',
    type: attachment.type || 'application/octet-stream',
    size: Number(attachment.size || 0),
    kind: attachment.kind || 'file',
    text: attachment.text || '',
    extractedText: attachment.extractedText || attachment.parsedText || '',
    extractedTextPreview: attachment.extractedTextPreview || '',
    extractedTextPath: attachment.extractedTextPath || '',
    extractedTextFullPath: attachment.extractedTextFullPath || '',
    extractedTextRelativePath: attachment.extractedTextRelativePath || '',
    extractedTextFullRelativePath: attachment.extractedTextFullRelativePath || '',
    extractedChunksPath: attachment.extractedChunksPath || '',
    extractedChunksRelativePath: attachment.extractedChunksRelativePath || '',
    contentHash: attachment.contentHash || '',
    extractionStatus: attachment.extractionStatus || attachment.extraction?.status || '',
    extractionParser: attachment.extractionParser || attachment.extraction?.parser || '',
    extractionMessage: attachment.extractionMessage || attachment.extraction?.message || '',
    extractionWarnings: attachment.extractionWarnings || attachment.extraction?.warnings || [],
    extractionHeadings: attachment.extractionHeadings || attachment.extraction?.headings || [],
    extractionChunkCount: attachment.extractionChunkCount || attachment.extraction?.chunkCount || 0,
    extraction: attachment.extraction || null,
    // Keep image previews/API image input, but avoid storing large binary data for
    // generic files once they have been persisted to the local attachment folder.
    dataUrl: attachment.kind === 'image' ? (attachment.dataUrl || '') : '',
    localPath: attachment.localPath || '',
    localRelativePath: attachment.localRelativePath || '',
    fileUrl: attachment.fileUrl || '',
    storage: attachment.storage || '',
    savedAt: attachment.savedAt || '',
    localSaveError: attachment.localSaveError || '',
    createdAt: attachment.createdAt || attachment.addedAt || '',
  });

  const sanitizeNodeForJson = (node = {}) => {
    const answer = String(node.answer || '');
    const displayed = String(node.displayedAnswer || (node.isTyping ? '' : answer));
    const isTyping = Boolean(node.isTyping && answer && displayed.length < answer.length);
    const status = node.status === 'requesting'
      ? (answer ? 'answered' : 'pending')
      : (node.status || (answer || displayed ? 'answered' : 'pending'));
    return {
      id: node.id || '',
      parentId: node.parentId || null,
      question: String(node.question || ''),
      status,
      stackStatus: node.stackStatus || 'active',
      answer: answer || displayed,
      displayedAnswer: isTyping ? displayed : (answer || displayed),
      isTyping,
      answerMeta: node.answerMeta || '',
      systemMessage: node.systemMessage || '',
      errorMessage: node.errorMessage || '',
      loadingText: '',
      loadingMeta: '',
      parentTextContext: node.parentTextContext || '',
      selectedTextContext: node.selectedTextContext || '',
      selectedPositionContext: node.selectedPositionContext || '',
      selectionSourceKind: node.selectionSourceKind || '',
      selectionRange: node.selectionRange || null,
      selectionRenderRange: node.selectionRenderRange || null,
      selectionLocator: node.selectionLocator || null,
      attachments: Array.isArray(node.attachments) ? node.attachments.map(sanitizeAttachmentForJson) : [],
      annotations: Array.isArray(node.annotations) ? clone(node.annotations) : [],
      children: Array.isArray(node.children) ? [...node.children] : [],
      completedAt: node.completedAt || null,
      createdAt: node.createdAt || null,
    };
  };

  const compactTitle = (nodes = []) => {
    const root = nodes.find((node) => !node.parentId) || nodes[0];
    const title = String(root?.question || '未命名学习会话').replace(/\s+/g, ' ').trim();
    return title.length > 48 ? `${title.slice(0, 48)}…` : title;
  };

  const countAttachments = (nodes = [], selectedAttachments = []) => {
    const nodeAttachmentCount = nodes.reduce((sum, node) => sum + (node.attachments?.length || 0), 0);
    return nodeAttachmentCount + selectedAttachments.length;
  };

  const createFallbackBridge = () => ({
    async readLearningSession() {
      const text = window.localStorage?.getItem(localStorageFallbackKey) || '';
      return { ok: true, data: text ? JSON.parse(text) : null, filePath: `localStorage:${localStorageFallbackKey}` };
    },
    async writeLearningSession(payload) {
      window.localStorage?.setItem(localStorageFallbackKey, JSON.stringify(payload));
      const sessionId = payload?.metadata?.sessionId || '';
      const nodes = Array.isArray(payload?.learning?.nodes) ? payload.learning.nodes : [];
      if (sessionId && nodes.length) {
        const key = `ai-learning-stack.session.${sessionId}`;
        window.localStorage?.setItem(key, JSON.stringify(payload));
        const root = nodes.find((node) => !node.parentId) || nodes[0] || {};
        const activeStack = Array.isArray(payload.learning.questionStack) ? payload.learning.questionStack.filter(Boolean) : [];
        const solved = Boolean(nodes.length && activeStack.length === 0 && nodes.every((node) => node.stackStatus === 'done'));
        const item = {
          sessionId,
          title: payload.metadata?.title || root.question || '未命名学习会话',
          rootQuestion: root.question || payload.metadata?.title || '未命名学习会话',
          rootQuestionId: root.id || 'Q0',
          status: solved ? 'done' : 'active',
          solved,
          activeQuestionId: payload.learning.activeQuestionId || root.id || null,
          nodeCount: Number(payload.metadata?.nodeCount || nodes.length || 0),
          messageCount: Number(payload.metadata?.messageCount || 0),
          attachmentCount: Number(payload.metadata?.attachmentCount || 0),
          createdAt: payload.metadata?.createdAt || payload.metadata?.updatedAt || new Date().toISOString(),
          updatedAt: payload.metadata?.updatedAt || new Date().toISOString(),
          filePath: `localStorage:${key}`,
        };
        const current = JSON.parse(window.localStorage?.getItem(localStorageIndexKey) || '[]').filter((entry) => entry.sessionId !== sessionId);
        current.unshift(item);
        current.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        window.localStorage?.setItem(localStorageIndexKey, JSON.stringify(current));
      }
      return { ok: true, filePath: `localStorage:${localStorageFallbackKey}`, savedAt: new Date().toISOString() };
    },
    async writeLearningSessionById(sessionId = '', payload = {}) {
      const safeId = String(sessionId || payload?.metadata?.sessionId || '').trim() || `session-${Date.now()}`;
      const key = `ai-learning-stack.session.${safeId}`;
      const normalizedPayload = {
        ...payload,
        metadata: {
          ...(payload.metadata || {}),
          sessionId: safeId,
          savedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      window.localStorage?.setItem(key, JSON.stringify(normalizedPayload));
      await this.writeLearningSession(normalizedPayload);
      return { ok: true, filePath: `localStorage:${key}`, savedAt: normalizedPayload.metadata.updatedAt };
    },
    async clearLearningSession() {
      window.localStorage?.removeItem(localStorageFallbackKey);
      return { ok: true, filePath: `localStorage:${localStorageFallbackKey}` };
    },
    async clearAllLearningSessions() {
      const prefix = 'ai-learning-stack.session.';
      const keys = [];
      for (let index = 0; index < (window.localStorage?.length || 0); index += 1) {
        const key = window.localStorage?.key(index);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => window.localStorage?.removeItem(key));
      window.localStorage?.removeItem(localStorageFallbackKey);
      window.localStorage?.removeItem(localStorageIndexKey);
      return { ok: true, filePath: `localStorage:${localStorageIndexKey}`, sessions: [] };
    },
    async listLearningSessions() {
      const text = window.localStorage?.getItem(localStorageIndexKey) || '';
      const sessions = text ? JSON.parse(text) : [];
      return { ok: true, sessions, filePath: `localStorage:${localStorageIndexKey}` };
    },
    async readLearningSessionById(sessionId) {
      const key = `ai-learning-stack.session.${sessionId}`;
      const text = window.localStorage?.getItem(key) || '';
      return { ok: Boolean(text), data: text ? JSON.parse(text) : null, filePath: `localStorage:${key}`, error: text ? '' : '没有找到该历史学习会话' };
    },
  });

  const createLearningSessionPersistence = ({
    appStore,
    stackState,
    renderWorkbenchTree,
    renderWorkbenchGraph,
    renderActiveNodePage,
    renderAttachmentTray,
    syncRichContextUi,
    syncPromptPlaceholder,
    syncSendState,
    scheduleFingerprintReflow,
  } = {}) => {
    const bridge = window.desktopShell?.readLearningSession && window.desktopShell?.writeLearningSession
      ? window.desktopShell
      : createFallbackBridge();

    let sessionId = '';
    let createdAt = '';
    let lastSavedAt = '';
    let lastSavePath = '';
    let lastError = '';
    let saveTimer = 0;
    let saveInFlight = false;
    let pendingSave = false;
    let hydrationFinished = false;
    let unsubscribe = null;
    const runtimeInFlight = new Map();
    const runtimeTyping = new Map();
    const inFlightListeners = new Set();

    const makeRuntimeKey = (targetSessionId = '', nodeId = '') => `${String(targetSessionId || '').trim()}::${String(nodeId || '').trim()}`;

    const emitInFlightChange = () => {
      const snapshot = getInFlightSnapshot();
      inFlightListeners.forEach((listener) => {
        try { listener(snapshot); } catch (error) { console.warn?.('in-flight listener failed', error); }
      });
    };

    const addNodeToSnapshot = (snapshot, targetSessionId, nodeId) => {
      const safeSessionId = String(targetSessionId || '').trim();
      const safeNodeId = String(nodeId || '').trim();
      if (!safeSessionId || !safeNodeId) return snapshot;
      snapshot[safeSessionId] = snapshot[safeSessionId] || [];
      if (!snapshot[safeSessionId].includes(safeNodeId)) snapshot[safeSessionId].push(safeNodeId);
      return snapshot;
    };

    const getInFlightSnapshot = () => {
      const snapshot = Array.from(runtimeInFlight.entries()).reduce((acc, [targetSessionId, nodeIds]) => {
        (nodeIds || new Set()).forEach((nodeId) => addNodeToSnapshot(acc, targetSessionId, nodeId));
        return acc;
      }, {});
      runtimeTyping.forEach((typing) => addNodeToSnapshot(snapshot, typing.sessionId, typing.nodeId));
      return snapshot;
    };

    const ensureSessionId = () => {
      if (!sessionId) sessionId = `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (!createdAt) createdAt = new Date().toISOString();
      return sessionId;
    };

    const getSessionId = () => sessionId || '';

    const markRequestInFlight = (targetSessionId = '', nodeId = '') => {
      const safeSessionId = String(targetSessionId || ensureSessionId()).trim();
      const safeNodeId = String(nodeId || '').trim();
      if (!safeSessionId || !safeNodeId) return getInFlightSnapshot();
      const set = runtimeInFlight.get(safeSessionId) || new Set();
      set.add(safeNodeId);
      runtimeInFlight.set(safeSessionId, set);
      emitInFlightChange();
      return getInFlightSnapshot();
    };

    const markRequestComplete = (targetSessionId = '', nodeId = '') => {
      const safeSessionId = String(targetSessionId || '').trim();
      const safeNodeId = String(nodeId || '').trim();
      if (!safeSessionId) return getInFlightSnapshot();
      const set = runtimeInFlight.get(safeSessionId);
      if (set && safeNodeId) set.delete(safeNodeId);
      if (!set || set.size === 0) runtimeInFlight.delete(safeSessionId);
      emitInFlightChange();
      return getInFlightSnapshot();
    };

    const getApiInFlightNodeIds = (targetSessionId = '') => Array.from(runtimeInFlight.get(String(targetSessionId || '').trim()) || []);

    const getTypingNodeIds = (targetSessionId = '') => {
      const safeSessionId = String(targetSessionId || '').trim();
      return Array.from(runtimeTyping.values())
        .filter((typing) => typing.sessionId === safeSessionId)
        .map((typing) => typing.nodeId);
    };

    const getInFlightNodeIds = (targetSessionId = '') => {
      const ids = [...getApiInFlightNodeIds(targetSessionId), ...getTypingNodeIds(targetSessionId)];
      return [...new Set(ids.filter(Boolean))];
    };

    const isSessionInFlight = (targetSessionId = '') => getInFlightNodeIds(targetSessionId).length > 0;

    const subscribeInFlight = (listener) => {
      if (typeof listener !== 'function') return () => {};
      inFlightListeners.add(listener);
      return () => inFlightListeners.delete(listener);
    };

    const getNodes = () => {
      const nodes = appStore?.getLearningNodes?.();
      if (Array.isArray(nodes)) return nodes;
      return Array.isArray(stackState?.nodes) ? stackState.nodes : [];
    };

    const getLearningData = () => appStore?.select?.('learningData', null) || null;

    const captureSnapshot = () => {
      const data = getLearningData() || {};
      const nodes = getNodes().map(sanitizeNodeForJson).filter((node) => node.id);
      const selectedAttachments = Array.isArray(data.selectedAttachments)
        ? data.selectedAttachments.map(sanitizeAttachmentForJson)
        : (Array.isArray(stackState?.selectedAttachments) ? stackState.selectedAttachments.map(sanitizeAttachmentForJson) : []);
      const graph = clone(appStore?.getGraphViewport?.() || stackState?.graph || {});
      const now = new Date().toISOString();

      ensureSessionId();
      if (!createdAt) createdAt = now;

      return {
        schemaVersion,
        kind: 'ai-learning-stack-current-session',
        metadata: {
          sessionId,
          title: compactTitle(nodes),
          createdAt,
          updatedAt: now,
          nodeCount: nodes.length,
          messageCount: Number((data.messages || stackState?.messages || []).length || 0),
          attachmentCount: countAttachments(nodes, selectedAttachments),
          inFlightNodeIds: getInFlightNodeIds(sessionId),
          inFlightCount: getInFlightNodeIds(sessionId).length,
        },
        learning: {
          hasMainQuestion: Boolean(data.hasMainQuestion ?? stackState?.hasMainQuestion ?? nodes.length),
          activeQuestionId: data.activeQuestionId ?? stackState?.activeQuestionId ?? null,
          nodeOrder: nodes.map((node) => node.id),
          nodes,
          questionStack: Array.isArray(data.questionStack) ? [...data.questionStack] : [...(stackState?.questionStack || [])],
          messages: clone(data.messages || stackState?.messages || []),
          activeSelection: clone(data.activeSelection || stackState?.activeSelection || null),
          selectedAttachments,
          richContextMode: Boolean(data.richContextMode ?? stackState?.richContextMode),
          nextQuestionIndex: Number(data.nextQuestionIndex ?? stackState?.nextQuestionIndex ?? nodes.length),
        },
        graph,
        attachments: {
          selectedAttachments,
          richContextMode: Boolean(data.richContextMode ?? stackState?.richContextMode),
        },
      };
    };

    const applyRestoredSession = (snapshot = {}) => {
      if (!snapshot || typeof snapshot !== 'object') return false;
      const learning = snapshot.learning || {};
      const nodes = Array.isArray(learning.nodes) ? learning.nodes : [];
      if (!nodes.length && !learning.hasMainQuestion) return false;
      sessionId = snapshot.metadata?.sessionId || sessionId || `session-${Date.now()}`;
      createdAt = snapshot.metadata?.createdAt || createdAt || new Date().toISOString();
      appStore?.restoreLearningSession?.(snapshot, { source: 'learning-session-persistence:restore' });
      return true;
    };

    const flushSave = async () => {
      if (!hydrationFinished) return null;
      if (saveInFlight) {
        pendingSave = true;
        return null;
      }
      saveInFlight = true;
      try {
        const snapshot = captureSnapshot();
        const result = await bridge.writeLearningSession(snapshot);
        if (!result?.ok) throw new Error(result?.error || '写入学习会话失败');
        lastError = '';
        lastSavedAt = result.savedAt || snapshot.metadata.updatedAt;
        lastSavePath = result.filePath || '';
        return result;
      } catch (error) {
        lastError = error?.message || String(error);
        try { console.warn?.('Learning session persistence failed', error); } catch (_) {}
        return { ok: false, error: lastError };
      } finally {
        saveInFlight = false;
        if (pendingSave) {
          pendingSave = false;
          scheduleSave(180);
        }
      }
    };

    const scheduleSave = (delay = 650) => {
      if (!hydrationFinished) return;
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = 0;
        flushSave();
      }, delay);
    };

    const writeSessionById = async (targetSessionId = '', snapshot = {}) => {
      const safeSessionId = String(targetSessionId || snapshot?.metadata?.sessionId || '').trim();
      if (!safeSessionId || !snapshot) return { ok: false, error: '缺少学习会话 ID' };
      if (bridge.writeLearningSessionById) {
        return bridge.writeLearningSessionById(safeSessionId, snapshot);
      }
      // Older bridges only know how to write the current session. As a fallback,
      // write the archive payload through that path; Electron v9+ uses the real
      // write-by-id bridge above, so normal current-session state will not be clobbered.
      return bridge.writeLearningSession?.({
        ...snapshot,
        metadata: { ...(snapshot.metadata || {}), sessionId: safeSessionId },
      });
    };

    const updateSessionSnapshotById = async (targetSessionId = '', updater = null) => {
      const safeSessionId = String(targetSessionId || '').trim();
      if (!safeSessionId || typeof updater !== 'function') return { ok: false, error: '缺少学习会话更新参数' };
      const result = await bridge.readLearningSessionById?.(safeSessionId);
      if (!result?.ok || !result.data) return { ok: false, error: result?.error || '没有找到该历史学习会话', filePath: result?.filePath || '' };
      const snapshot = clone(result.data);
      const updated = updater(snapshot) || snapshot;
      updated.metadata = {
        ...(updated.metadata || {}),
        sessionId: safeSessionId,
        updatedAt: new Date().toISOString(),
        savedAt: new Date().toISOString(),
      };
      return writeSessionById(safeSessionId, updated);
    };

    const patchBackgroundNode = async (targetSessionId = '', nodeId = '', patch = {}, metadataPatch = {}) => updateSessionSnapshotById(targetSessionId, (snapshot) => {
      const learning = snapshot.learning || {};
      const nodes = Array.isArray(learning.nodes) ? learning.nodes : [];
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (node) Object.assign(node, patch);
      snapshot.learning = learning;
      snapshot.metadata = {
        ...(snapshot.metadata || {}),
        ...metadataPatch,
      };
      return snapshot;
    });

    const stopBackgroundTyping = (targetSessionId = '', nodeId = '') => {
      const key = makeRuntimeKey(targetSessionId, nodeId);
      const typing = runtimeTyping.get(key);
      if (typing?.timer) window.clearTimeout(typing.timer);
      runtimeTyping.delete(key);
      emitInFlightChange();
      return Boolean(typing);
    };

    const startBackgroundTyping = ({ sessionId: targetSessionId = '', nodeId = '', answer = '' } = {}) => {
      const safeSessionId = String(targetSessionId || '').trim();
      const safeNodeId = String(nodeId || '').trim();
      const fullText = String(answer || '');
      if (!safeSessionId || !safeNodeId || !fullText) return null;

      stopBackgroundTyping(safeSessionId, safeNodeId);
      const key = makeRuntimeKey(safeSessionId, safeNodeId);
      const startedAt = performance.now?.() || Date.now();
      let lastSavedAt = 0;

      const typing = {
        sessionId: safeSessionId,
        nodeId: safeNodeId,
        answer: fullText,
        timer: 0,
      };
      runtimeTyping.set(key, typing);
      emitInFlightChange();

      const tick = async () => {
        if (!runtimeTyping.has(key)) return;
        const now = performance.now?.() || Date.now();
        const elapsed = now - startedAt;
        const nextLength = Math.min(fullText.length, Math.max(1, Math.floor(elapsed / 9)));
        const isDone = nextLength >= fullText.length;
        // Persist background typing only every ~220ms and at completion. The UI can
        // resume from the latest saved displayedAnswer without spamming disk writes.
        if (isDone || now - lastSavedAt >= 220) {
          lastSavedAt = now;
          await patchBackgroundNode(safeSessionId, safeNodeId, {
            status: 'answered',
            answer: fullText,
            displayedAnswer: fullText.slice(0, nextLength),
            isTyping: !isDone,
            loadingText: '',
            loadingMeta: '',
          }, {
            inFlightNodeIds: getInFlightNodeIds(safeSessionId).filter((id) => id !== safeNodeId || !isDone),
            inFlightCount: isDone ? Math.max(0, getInFlightNodeIds(safeSessionId).length - 1) : getInFlightNodeIds(safeSessionId).length,
          });
        }

        if (isDone) {
          runtimeTyping.delete(key);
          emitInFlightChange();
          return;
        }
        typing.timer = window.setTimeout(tick, 32);
      };

      typing.timer = window.setTimeout(tick, 0);
      return key;
    };

    const foregroundTypingForSession = (targetSessionId = '', nodeIds = []) => {
      const safeSessionId = String(targetSessionId || '').trim();
      const ids = Array.isArray(nodeIds) ? nodeIds : [];
      ids.forEach((nodeId) => stopBackgroundTyping(safeSessionId, nodeId));
    };

    const completeBackgroundRequest = async ({ sessionId: targetSessionId = '', nodeId = '', answer = '', providerName = '当前 API' } = {}) => {
      const safeSessionId = String(targetSessionId || '').trim();
      const safeNodeId = String(nodeId || '').trim();
      const normalizedAnswer = String(answer || '').trim() || 'AI 没有返回有效内容。';
      // The network request is done now. Keep the history spinner alive only if
      // the background typewriter is still revealing the already-received answer.
      markRequestComplete(safeSessionId, safeNodeId);
      const result = await updateSessionSnapshotById(safeSessionId, (snapshot) => {
        const learning = snapshot.learning || {};
        const nodes = Array.isArray(learning.nodes) ? learning.nodes : [];
        const node = nodes.find((candidate) => candidate.id === safeNodeId);
        if (node) {
          node.status = 'answered';
          node.answer = normalizedAnswer;
          node.displayedAnswer = '';
          node.isTyping = true;
          node.loadingText = '';
          node.loadingMeta = '';
          node.answerMeta = `${providerName} · 回复`;
          node.errorMessage = '';
        }
        learning.messages = Array.isArray(learning.messages) ? learning.messages : [];
        const existingAssistant = learning.messages.find((message) => message.role === 'assistant' && message.questionId === safeNodeId);
        if (existingAssistant) existingAssistant.content = normalizedAnswer;
        else learning.messages.push({ role: 'assistant', questionId: safeNodeId, content: normalizedAnswer });
        snapshot.learning = learning;
        snapshot.metadata = {
          ...(snapshot.metadata || {}),
          messageCount: learning.messages.length,
          inFlightNodeIds: getTypingNodeIds(safeSessionId),
          inFlightCount: getTypingNodeIds(safeSessionId).length,
        };
        return snapshot;
      });
      if (result?.ok !== false) {
        startBackgroundTyping({ sessionId: safeSessionId, nodeId: safeNodeId, answer: normalizedAnswer });
      }
      return result;
    };

    const failBackgroundRequest = async ({ sessionId: targetSessionId = '', nodeId = '', errorMessage = '' } = {}) => {
      const safeNodeId = String(nodeId || '').trim();
      const result = await updateSessionSnapshotById(targetSessionId, (snapshot) => {
        const learning = snapshot.learning || {};
        const nodes = Array.isArray(learning.nodes) ? learning.nodes : [];
        const node = nodes.find((candidate) => candidate.id === safeNodeId);
        if (node) {
          node.status = 'error';
          node.errorMessage = String(errorMessage || 'API 请求失败');
          node.loadingText = '';
          node.loadingMeta = '';
          node.isTyping = false;
        }
        snapshot.learning = learning;
        snapshot.metadata = {
          ...(snapshot.metadata || {}),
          inFlightNodeIds: getInFlightNodeIds(targetSessionId).filter((id) => id !== safeNodeId),
          inFlightCount: Math.max(0, getInFlightNodeIds(targetSessionId).length - 1),
        };
        return snapshot;
      });
      markRequestComplete(targetSessionId, safeNodeId);
      return result;
    };

    const didGraphChange = (change = {}) => {
      if (change.slice !== 'ui') return false;
      return !Object.is(change.previous?.graph, change.next?.graph);
    };

    const shouldPersistAction = (action = {}, changes = []) => {
      const ui = appStore?.select?.('ui', null) || {};
      if (ui.module === 'knowledge') return false;
      const type = String(action.type || '');
      if (!type) return false;
      if (action.meta?.source === 'learning-session-persistence:restore') return false;
      if (type.startsWith('learning/')) return true;
      if (type === appStore?.Action?.UI_GRAPH_CHANGED || type === appStore?.Action?.UI_GRAPH_RESET) return true;
      // Store batch emissions hide child action types, so use changed slices as
      // the persistence signal for batched node/request mutations. Plain shell
      // UI sync does not touch learningData and does not count as graph change.
      if (type === appStore?.Action?.BATCH || type === 'store/batch') {
        return changes.some((change) => change.slice === 'learningData' || didGraphChange(change));
      }
      return false;
    };

    const startAutoSave = () => {
      if (unsubscribe || !appStore?.subscribe) return;
      unsubscribe = appStore.subscribe((_nextState, action = {}, changes = []) => {
        if (shouldPersistAction(action, changes)) scheduleSave();
      });
      scheduleSave(900);
    };

    const hydrate = async (options = {}) => {
      try {
        const result = await bridge.readLearningSession();
        if (!result?.ok) throw new Error(result?.error || '读取学习会话失败');
        lastSavePath = result.filePath || '';
        const restored = options.restoreCurrent === false ? false : applyRestoredSession(result.data);
        hydrationFinished = true;
        if (restored) {
          renderWorkbenchTree?.();
          renderWorkbenchGraph?.();
          renderActiveNodePage?.({ reason: 'session-restored', scrollToTop: true });
          renderAttachmentTray?.();
          syncRichContextUi?.();
          syncPromptPlaceholder?.();
          syncSendState?.();
          scheduleFingerprintReflow?.([0, 80, 220]);
        }
        return { ok: true, restored, filePath: result.filePath || '' };
      } catch (error) {
        hydrationFinished = true;
        lastError = error?.message || String(error);
        try { console.warn?.('Learning session restore failed', error); } catch (_) {}
        return { ok: false, restored: false, error: lastError };
      }
    };

    const saveNow = async () => {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
      return flushSave();
    };

    const clear = async () => {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
      const result = await bridge.clearLearningSession?.();
      return result || { ok: true };
    };

    const clearAllSessions = async (options = {}) => {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
      pendingSave = false;
      sessionId = '';
      createdAt = '';
      lastSavedAt = '';
      runtimeInFlight.clear();
      runtimeTyping.forEach((typing) => window.clearTimeout(typing.timer));
      runtimeTyping.clear();
      emitInFlightChange();
      const result = await bridge.clearAllLearningSessions?.({
        preserveAttachmentIds: Array.isArray(options.preserveAttachmentIds) ? options.preserveAttachmentIds : [],
      });
      if (result?.ok === false) return result;
      if (!result && bridge.clearLearningSession) await bridge.clearLearningSession();
      return result || { ok: true, sessions: [] };
    };


    const listSessions = async () => {
      const result = await bridge.listLearningSessions?.();
      if (!result?.ok) return { ok: false, sessions: [], error: result?.error || '读取历史学习列表失败' };
      return { ok: true, sessions: Array.isArray(result.sessions) ? result.sessions : [], filePath: result.filePath || '' };
    };

    const restoreSnapshot = (snapshot = {}, options = {}) => {
      const restored = applyRestoredSession(snapshot);
      if (restored && options.render !== false) {
        renderWorkbenchTree?.();
        renderWorkbenchGraph?.();
        renderActiveNodePage?.({ reason: options.reason || 'session-restored', scrollToTop: true, force: true });
        renderAttachmentTray?.();
        syncRichContextUi?.();
        syncPromptPlaceholder?.();
        syncSendState?.();
        scheduleFingerprintReflow?.([0, 80, 220]);
      }
      return restored;
    };

    const loadSessionById = async (targetSessionId = '', options = {}) => {
      const result = await bridge.readLearningSessionById?.(targetSessionId);
      if (!result?.ok) return { ok: false, error: result?.error || '读取历史学习失败', filePath: result?.filePath || '' };
      const restored = restoreSnapshot(result.data, { ...options, reason: 'history-session-loaded' });
      return { ok: true, restored, data: result.data, filePath: result.filePath || '' };
    };

    const startNewSession = (options = {}) => {
      sessionId = '';
      createdAt = '';
      lastSavedAt = '';
      if (options.clearCurrent) {
        bridge.clearLearningSession?.();
      }
      return { ok: true };
    };

    const debug = () => ({
      schemaVersion,
      sessionId,
      createdAt,
      lastSavedAt,
      lastSavePath,
      lastError,
      hydrationFinished,
      hasAutoSave: Boolean(unsubscribe),
      inFlight: getInFlightSnapshot(),
      snapshot: captureSnapshot(),
    });

    return {
      hydrate,
      startAutoSave,
      scheduleSave,
      saveNow,
      clear,
      clearAllSessions,
      listSessions,
      loadSessionById,
      restoreSnapshot,
      startNewSession,
      captureSnapshot,
      getSessionId,
      ensureSessionId,
      markRequestInFlight,
      markRequestComplete,
      getApiInFlightNodeIds,
      getInFlightNodeIds,
      getInFlightSnapshot,
      isSessionInFlight,
      subscribeInFlight,
      foregroundTypingForSession,
      stopBackgroundTyping,
      completeBackgroundRequest,
      failBackgroundRequest,
      updateSessionSnapshotById,
      debug,
    };
  };

  window.LearningSessionPersistence = {
    createLearningSessionPersistence,
  };
}());
