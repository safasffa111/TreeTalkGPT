// Knowledge warehouse controller.
//
// This is the first MVP layer requested by the product flow:
// - side rail opens a knowledge module;
// - normal assist width shows a folder/file list;
// - folders/files can be created or renamed inline from the list;
// - files open into the shared learning content page so selection/follow-up keeps
//   working like the workbench;
// - arrow buttons switch between the knowledge list and the current file's
//   logic tree/graph without changing the content page.
(function () {
  const STORAGE_KEY = 'ai-learning-stack.knowledge-warehouse.v1';
  const ROOT_ID = 'root';
  const PANEL_LIST = 'list';
  const PANEL_SESSION = 'session';

  const clone = (value) => {
    if (value === undefined || value === null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_) {}
    }
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };

  const uid = (prefix = 'item') => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const normalizeName = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();



  const rebuildFolderTree = (store) => {
    const ids = new Set((store.items || []).map((item) => item.id));
    const nodes = {};
    (store.items || [])
      .filter((item) => item?.type !== 'file')
      .forEach((folder) => {
        const parentId = folder.id === ROOT_ID ? null : (ids.has(folder.parentId) ? folder.parentId : ROOT_ID);
        nodes[folder.id] = {
          id: folder.id,
          parentId,
          children: [],
        };
      });
    if (!nodes[ROOT_ID]) nodes[ROOT_ID] = { id: ROOT_ID, parentId: null, children: [] };
    Object.values(nodes).forEach((node) => {
      if (!node || node.id === ROOT_ID) return;
      const parentId = nodes[node.parentId] ? node.parentId : ROOT_ID;
      node.parentId = parentId;
      if (!nodes[parentId].children.includes(node.id)) nodes[parentId].children.push(node.id);
    });
    store.folderTree = { rootId: ROOT_ID, nodes };
    return store.folderTree;
  };

  const createEmptyStore = () => ({
    version: 1,
    currentFolderId: ROOT_ID,
    activeFileId: '',
    items: [
      {
        id: ROOT_ID,
        type: 'folder',
        parentId: null,
        name: '知识仓库',
        children: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });

  const ensureStoreShape = (raw = null) => {
    const store = raw && typeof raw === 'object' ? clone(raw) : createEmptyStore();
    store.version = Number(store.version || 1);
    store.currentFolderId = store.currentFolderId || ROOT_ID;
    store.activeFileId = store.activeFileId || '';
    store.items = Array.isArray(store.items) ? store.items : [];
    if (!store.items.some((item) => item.id === ROOT_ID)) {
      store.items.unshift({
        id: ROOT_ID,
        type: 'folder',
        parentId: null,
        name: '知识仓库',
        children: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    const ids = new Set(store.items.map((item) => item.id));
    store.items.forEach((item) => {
      item.type = item.type === 'file' ? 'file' : 'folder';
      item.name = normalizeName(item.name) || (item.type === 'file' ? '未命名文件' : '未命名文件夹');
      item.parentId = item.id === ROOT_ID ? null : (ids.has(item.parentId) ? item.parentId : ROOT_ID);
      item.children = Array.isArray(item.children) ? item.children.filter((id) => ids.has(id)) : [];
      item.updatedAt = item.updatedAt || item.createdAt || new Date().toISOString();
      item.createdAt = item.createdAt || item.updatedAt;
      if (item.type === 'file') {
        item.text = String(item.text || '');
        item.session = item.session && typeof item.session === 'object' ? item.session : null;
      }
    });
    const root = store.items.find((item) => item.id === ROOT_ID);
    root.children = store.items
      .filter((item) => item.id !== ROOT_ID && item.parentId === ROOT_ID)
      .map((item) => item.id)
      .filter((id, index, list) => list.indexOf(id) === index);
    store.items
      .filter((item) => item.type === 'folder' && item.id !== ROOT_ID)
      .forEach((folder) => {
        folder.children = store.items
          .filter((item) => item.parentId === folder.id)
          .map((item) => item.id)
          .filter((id, index, list) => list.indexOf(id) === index);
      });
    const folderTree = rebuildFolderTree(store);
    if (!folderTree.nodes[store.currentFolderId]) store.currentFolderId = ROOT_ID;
    const activeFile = store.activeFileId ? store.items.find((item) => item.id === store.activeFileId) : null;
    if (!activeFile || activeFile.type !== 'file') store.activeFileId = '';
    return store;
  };

  const readStore = () => {
    try {
      const text = window.localStorage?.getItem(STORAGE_KEY) || '';
      return ensureStoreShape(text ? JSON.parse(text) : null);
    } catch (_) {
      return createEmptyStore();
    }
  };

  const writeStore = (store) => {
    const normalized = ensureStoreShape(store);
    try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch (_) {}
    return normalized;
  };

  const makeFileSession = (file = {}) => {
    const now = new Date().toISOString();
    const title = normalizeName(file.name) || '未命名文件';
    const text = String(file.text || '').trim() || '这个知识文件还没有正文。';
    const rootNode = {
      id: 'Q0',
      parentId: null,
      question: title,
      status: 'answered',
      stackStatus: 'active',
      answer: text,
      displayedAnswer: text,
      isTyping: false,
      answerMeta: '知识文本',
      systemMessage: '',
      errorMessage: '',
      loadingText: '',
      loadingMeta: '',
      parentTextContext: '',
      selectedTextContext: '',
      selectionSourceKind: '',
      selectionRange: null,
      selectionRenderRange: null,
      selectionLocator: null,
      attachments: [],
      annotations: [],
      children: [],
      createdAt: now,
    };
    return {
      schemaVersion: 1,
      metadata: {
        sessionId: makeKnowledgeSessionId(file.id || uid('file')),
        title,
        createdAt: file.createdAt || now,
        updatedAt: now,
        source: 'knowledge-warehouse',
        knowledgeFileId: file.id || '',
      },
      learning: {
        sessionId: makeKnowledgeSessionId(file.id || ''),
        hasMainQuestion: true,
        activeQuestionId: 'Q0',
        nodes: [rootNode],
        questionStack: ['Q0'],
        messages: [
          { role: 'user', questionId: 'Q0', content: title },
          { role: 'assistant', questionId: 'Q0', content: text },
        ],
        activeSelection: null,
        selectedAttachments: [],
        richContextMode: false,
        nextQuestionIndex: 1,
      },
      graph: { scale: 1, x: 18, y: 18, positions: {}, manualPositions: {} },
    };
  };


  const makeKnowledgeSessionId = (fileId = '') => `knowledge-file:${String(fileId || '').trim() || uid('file')}`;

  const normalizeGraphForNodes = (graph = {}, nodeIds = new Set()) => {
    const source = graph && typeof graph === 'object' ? graph : {};
    const filterPositions = (positions = {}) => Object.entries(positions || {}).reduce((acc, [id, pos]) => {
      if (!nodeIds.has(id) || !pos || typeof pos !== 'object') return acc;
      const x = Number(pos.x);
      const y = Number(pos.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return acc;
      acc[id] = { x, y };
      return acc;
    }, {});
    return {
      scale: Number.isFinite(Number(source.scale)) ? Number(source.scale) : 1,
      x: Number.isFinite(Number(source.x)) ? Number(source.x) : 18,
      y: Number.isFinite(Number(source.y)) ? Number(source.y) : 18,
      positions: filterPositions(source.positions),
      manualPositions: filterPositions(source.manualPositions),
    };
  };

  const normalizeKnowledgeFileSession = (file = {}, rawSnapshot = null, { freezeTyping = true, forceActiveQuestionId = '', syncRootTitle = false } = {}) => {
    const now = new Date().toISOString();
    const snapshot = clone(rawSnapshot || file.session || makeFileSession(file));
    const sessionId = makeKnowledgeSessionId(file.id || snapshot?.metadata?.knowledgeFileId || '');
    const fileDisplayTitle = normalizeName(file.name || snapshot?.metadata?.title || '') || '知识文件';
    const learning = snapshot.learning && typeof snapshot.learning === 'object' ? snapshot.learning : {};
    const rawNodes = Array.isArray(learning.nodes) ? learning.nodes : [];
    const nodes = rawNodes.map((node) => {
      const next = clone(node || {});
      next.id = String(next.id || '');
      next.parentId = next.parentId ? String(next.parentId) : null;
      next.question = String(next.question || '未命名问题');
      next.answer = String(next.answer || next.displayedAnswer || '');
      if (freezeTyping) {
        next.displayedAnswer = next.answer || String(next.displayedAnswer || '');
        next.isTyping = false;
        if (next.status === 'requesting') next.status = next.answer ? 'answered' : 'draft';
        next.loadingText = '';
        next.loadingMeta = '';
      } else {
        next.displayedAnswer = String(next.displayedAnswer || '');
        next.isTyping = Boolean(next.isTyping);
      }
      next.children = Array.isArray(next.children) ? next.children.map(String) : [];
      return next.id ? next : null;
    }).filter(Boolean);

    const rootNode = nodes.find((node) => !node.parentId) || nodes[0] || null;
    if (syncRootTitle && rootNode) rootNode.question = fileDisplayTitle;

    const nodeIds = new Set(nodes.map((node) => node.id));
    nodes.forEach((node) => {
      if (node.parentId && !nodeIds.has(node.parentId)) node.parentId = null;
      node.children = [...new Set((node.children || []).filter((childId) => nodeIds.has(childId)))];
    });
    nodes.forEach((node) => {
      if (!node.parentId) return;
      const parent = nodes.find((candidate) => candidate.id === node.parentId);
      if (parent && !parent.children.includes(node.id)) parent.children.push(node.id);
    });

    const rootQuestionId = nodes.find((node) => !node.parentId)?.id || nodes[0]?.id || null;
    const requestedActiveQuestionId = forceActiveQuestionId || learning.activeQuestionId;
    const activeQuestionId = requestedActiveQuestionId && nodeIds.has(requestedActiveQuestionId)
      ? requestedActiveQuestionId
      : rootQuestionId;
    const questionStack = (Array.isArray(learning.questionStack) ? learning.questionStack : [])
      .map(String)
      .filter((id) => nodeIds.has(id));
    const messages = (Array.isArray(learning.messages) ? clone(learning.messages) : [])
      .map((message) => {
        if (!message || typeof message !== 'object') return null;
        const next = clone(message);
        if (next.questionId && !nodeIds.has(String(next.questionId))) return null;
        if (next.questionId) next.questionId = String(next.questionId);
        return next;
      })
      .filter(Boolean);

    return {
      schemaVersion: Number(snapshot.schemaVersion || 1),
      metadata: {
        ...(snapshot.metadata || {}),
        sessionId,
        title: fileDisplayTitle,
        source: snapshot.metadata?.source || 'knowledge-warehouse',
        knowledgeFileId: file.id || snapshot.metadata?.knowledgeFileId || '',
        updatedAt: now,
      },
      learning: {
        sessionId,
        hasMainQuestion: Boolean(nodes.length),
        activeQuestionId,
        nodes,
        questionStack: questionStack.length ? questionStack : (activeQuestionId ? [activeQuestionId] : []),
        messages: syncRootTitle && rootNode
          ? messages.map((message) => {
            if (!message || message.role !== 'user' || message.questionId !== rootNode.id) return message;
            return { ...message, content: fileDisplayTitle };
          })
          : messages,
        activeSelection: learning.activeSelection ? clone(learning.activeSelection) : null,
        selectedAttachments: Array.isArray(learning.selectedAttachments) ? clone(learning.selectedAttachments) : [],
        richContextMode: Boolean(learning.richContextMode),
        nextQuestionIndex: Number.isFinite(Number(learning.nextQuestionIndex))
          ? Number(learning.nextQuestionIndex)
          : nodes.length,
      },
      graph: normalizeGraphForNodes(snapshot.graph || {}, nodeIds),
    };
  };

  const createKnowledgeWarehouseController = ({
    shell,
    knowledgePanel,
    knowledgeList,
    knowledgeBreadcrumb,
    knowledgeFolderBackButton,
    knowledgeTitleText,
    knowledgeNewFolderButton,
    knowledgeDeleteModeButton,
    knowledgeWideNewButton,
    knowledgeSearchPanel,
    knowledgeSearchInput,
    knowledgeSearchClearButton,
    knowledgeSearchStatus,
    knowledgeSearchResults,
    knowledgePointMapPanel,
    knowledgePointMapStage,
    knowledgePointMapToLogicButton,
    treePanel,
    graphPanel,
    treeToggleButtons = [],
    appStore,
    stackState,
    persistence,
    stateMachine,
    clearContentStream,
    renderActiveNodePage,
    renderWorkbenchTree,
    renderWorkbenchGraph,
    renderAttachmentTray,
    syncRichContextUi,
    syncPromptPlaceholder,
    syncSendState,
    scheduleFingerprintReflow,
    focusPrompt,
    stopAllAnswerTypewriters,
  } = {}) => {
    let store = readStore();
    let renamingItemId = '';
    let isDeleteMode = false;
    let suppressBlurCommit = false;
    let isCommittingRename = false;
    let isSavingActiveFile = false;
    let unsubscribeStore = null;
    let folderTransitionQueue = Promise.resolve();
    let folderTransitionToken = 0;
    let mapFileOpenQueue = Promise.resolve();
    let mapFileOpenToken = 0;
    let deleteModeTransitionRunning = false;
    let pendingDeleteModeTarget = null;
    const enteringItemIds = new Set();
    const deletingItemIds = new Set();
    const knowledgeRuntimeInFlight = new Map();
    const knowledgeListItemCache = new Map();
    let knowledgeListEmptyState = null;
    let suspendedWorkbenchSnapshot = null;
    let knowledgeMapController = null;
    let knowledgeSearchController = null;



    const prefersReducedMotion = () => {
      try { return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true; } catch (_) { return false; }
    };

    const nextFrame = () => new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve());
      else window.setTimeout(resolve, 0);
    });

    const wait = (ms = 0) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const waitForTransition = (element, fallbackMs = 180) => new Promise((resolve) => {
      if (!element || prefersReducedMotion()) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        element.removeEventListener?.('transitionend', onEnd);
        window.clearTimeout(timer);
        resolve();
      };
      const onEnd = (event) => {
        if (event.target === element) finish();
      };
      const timer = window.setTimeout(finish, fallbackMs);
      element.addEventListener?.('transitionend', onEnd);
    });

    const waitForItemAnimation = (element, fallbackMs = 240) => new Promise((resolve) => {
      if (!element || prefersReducedMotion()) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        element.removeEventListener?.('animationend', onEnd);
        window.clearTimeout(timer);
        resolve();
      };
      const onEnd = (event) => {
        if (event.target === element) finish();
      };
      const timer = window.setTimeout(finish, fallbackMs);
      element.addEventListener?.('animationend', onEnd);
    });

    const scheduleClearItemEnter = (itemId) => {
      if (!itemId || prefersReducedMotion()) {
        enteringItemIds.delete(itemId);
        return;
      }
      window.setTimeout(() => {
        enteringItemIds.delete(itemId);
        const itemElement = knowledgeList?.querySelector?.(`[data-knowledge-item-id="${itemId}"]`);
        itemElement?.classList?.remove('is-item-entering');
      }, 300);
    };

    const isKnowledgeModule = () => shell?.dataset?.module === 'knowledge';
    const getPanelMode = () => shell?.dataset?.knowledgePanel || PANEL_LIST;
    const setPanelMode = (mode) => {
      if (!shell) return;
      shell.dataset.knowledgePanel = mode === PANEL_SESSION ? PANEL_SESSION : PANEL_LIST;
      syncActionButtons();
    };

    const syncKnowledgeFilePresence = () => {
      if (!shell) return;
      const hasActiveFile = Boolean(store.activeFileId && getItem(store.activeFileId)?.type === 'file');
      shell.dataset.knowledgeHasFile = hasActiveFile ? 'true' : 'false';
    };

    const getItem = (id) => store.items.find((item) => item.id === id) || null;
    const getFolderTree = () => {
      if (!store.folderTree?.nodes?.[ROOT_ID]) rebuildFolderTree(store);
      return store.folderTree || rebuildFolderTree(store);
    };
    const getFolderNode = (id) => getFolderTree().nodes?.[id] || null;
    const isFolderId = (id) => Boolean(getFolderNode(id));
    const getParentFolderId = (id) => {
      const node = getFolderNode(id);
      if (!node || node.id === ROOT_ID) return null;
      return getFolderNode(node.parentId)?.id || ROOT_ID;
    };
    const getActiveFile = () => getItem(store.activeFileId);
    const isKnowledgeSessionId = (sessionId = '') => String(sessionId || '').trim().startsWith('knowledge-file:');
    const getCurrentLearningData = () => appStore?.select?.('learningData', null) || {};
    const getCurrentLearningNodes = () => {
      const nodes = appStore?.getLearningNodes?.();
      if (Array.isArray(nodes)) return nodes;
      return Array.isArray(stackState?.nodes) ? stackState.nodes : [];
    };
    const getCurrentLearningSessionId = () => String(
      getCurrentLearningData()?.sessionId
      || stackState?.sessionId
      || ''
    ).trim();
    const getCurrentLearningNodeCount = () => getCurrentLearningNodes().length;

    const captureMountedLearningSnapshot = ({
      sessionId = getCurrentLearningSessionId(),
      title = '',
      source = 'runtime-snapshot',
      knowledgeFileId = '',
    } = {}) => {
      const learningData = getCurrentLearningData();
      const nodes = clone(getCurrentLearningNodes());
      const root = nodes.find((node) => !node?.parentId) || nodes[0] || {};
      const safeSessionId = String(sessionId || learningData.sessionId || stackState?.sessionId || `runtime-${Date.now()}`).trim();
      const now = new Date().toISOString();
      return {
        schemaVersion: 1,
        metadata: {
          sessionId: safeSessionId,
          title: normalizeName(title || root.question || '未命名学习会话'),
          source,
          ...(knowledgeFileId ? { knowledgeFileId } : {}),
          createdAt: learningData.createdAt || stackState?.createdAt || now,
          updatedAt: now,
        },
        learning: {
          sessionId: safeSessionId,
          hasMainQuestion: Boolean(learningData.hasMainQuestion ?? stackState?.hasMainQuestion ?? nodes.length),
          activeQuestionId: learningData.activeQuestionId ?? stackState?.activeQuestionId ?? null,
          nodes,
          questionStack: clone(learningData.questionStack ?? stackState?.questionStack ?? []),
          messages: clone(learningData.messages ?? stackState?.messages ?? []),
          activeSelection: clone(learningData.activeSelection ?? stackState?.activeSelection ?? null),
          selectedAttachments: clone(learningData.selectedAttachments ?? stackState?.selectedAttachments ?? []),
          richContextMode: Boolean(learningData.richContextMode ?? stackState?.richContextMode),
          nextQuestionIndex: Number(learningData.nextQuestionIndex ?? stackState?.nextQuestionIndex ?? nodes.length),
        },
        graph: clone(appStore?.getGraphViewport?.() || stackState?.graph || { scale: 1, x: 18, y: 18, positions: {}, manualPositions: {} }),
      };
    };

    const collectKnowledgeAttachmentIds = (items = store.items, target = new Set()) => {
      window.AttachmentReferences?.collectFromKnowledgeItems?.(items, target);
      return target;
    };

    const collectRuntimeAttachmentIds = (target = new Set()) => {
      window.AttachmentReferences?.collectFromSession?.(captureMountedLearningSnapshot(), target);
      return target;
    };

    const deleteUnreferencedLocalAttachments = async (candidateIds = [], preserveIds = []) => {
      const ids = [...new Set(Array.isArray(candidateIds) ? candidateIds : [])].filter(Boolean);
      if (!ids.length || !window.desktopShell?.deleteAttachments) return { ok: true, deletedIds: [] };
      try {
        const result = await window.desktopShell.deleteAttachments({
          attachmentIds: ids,
          preserveAttachmentIds: [...new Set(Array.isArray(preserveIds) ? preserveIds : [])].filter(Boolean),
        });
        if (result?.ok === false) {
          console.warn?.('[knowledge-warehouse] local attachment deletion incomplete', result.errors || result);
        }
        return result || { ok: true, deletedIds: [] };
      } catch (error) {
        console.warn?.('[knowledge-warehouse] local attachment deletion failed', error);
        return { ok: false, error: error?.message || String(error) };
      }
    };

    const suspendWorkbenchRuntimeForKnowledge = () => {
      const currentSessionId = getCurrentLearningSessionId();
      const currentNodes = getCurrentLearningNodes();
      if (isKnowledgeSessionId(currentSessionId) || !currentNodes.length) return false;
      suspendedWorkbenchSnapshot = captureMountedLearningSnapshot({
        sessionId: currentSessionId,
        source: 'knowledge-warehouse:suspend-workbench-runtime',
      });
      return true;
    };

    const renderRestoredLearningRuntime = (reason = 'knowledge-warehouse:restore-workbench-runtime') => {
      stateMachine?.refresh?.();
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      renderActiveNodePage?.({ force: true, animateEnter: true, scrollTop: true, reason });
      renderAttachmentTray?.();
      syncRichContextUi?.();
      syncPromptPlaceholder?.();
      syncSendState?.();
      scheduleFingerprintReflow?.([0, 80, 220]);
    };

    const restoreSuspendedWorkbenchRuntime = async (options = {}) => {
      const snapshot = suspendedWorkbenchSnapshot;
      suspendedWorkbenchSnapshot = null;
      if (snapshot?.learning?.nodes?.length) {
        stopAllAnswerTypewriters?.();
        appStore?.restoreLearningSession?.(snapshot, {
          source: 'knowledge-warehouse:restore-workbench-runtime',
          sessionId: snapshot.metadata?.sessionId || snapshot.learning?.sessionId || '',
        });
        renderRestoredLearningRuntime(options.reason || 'knowledge-warehouse:restore-workbench-runtime');
        return true;
      }

      if (options.clearWorkspace !== false && isActiveKnowledgeFileMounted()) {
        appStore?.resetLearningTree?.({}, { source: options.source || 'knowledge-warehouse:clear-unrestorable-knowledge-runtime' });
        appStore?.resetGraphViewport?.({ source: `${options.source || 'knowledge-warehouse:clear-unrestorable-knowledge-runtime'}-graph` });
        stateMachine?.refresh?.();
        await (clearContentStream?.({ animate: options.animateClear !== false }) || Promise.resolve());
        renderWorkbenchTree?.();
        renderWorkbenchGraph?.();
        renderAttachmentTray?.();
        syncRichContextUi?.();
        syncPromptPlaceholder?.();
        syncSendState?.();
        scheduleFingerprintReflow?.([0, 80, 220]);
        return true;
      }
      return false;
    };
    const getActiveKnowledgeSessionId = () => {
      const file = getActiveFile();
      if (!file || file.type !== 'file') return '';
      const snapshot = normalizeKnowledgeFileSession(file, file.session || makeFileSession(file), { freezeTyping: false });
      file.session = snapshot;
      return snapshot.metadata?.sessionId || makeKnowledgeSessionId(file.id);
    };
    const isActiveKnowledgeFileMounted = () => {
      if (!store.activeFileId || !getActiveFile()) return false;
      const expectedSessionId = getActiveKnowledgeSessionId();
      const currentSessionId = getCurrentLearningSessionId();
      return Boolean(expectedSessionId && currentSessionId === expectedSessionId && getCurrentLearningNodeCount() > 0);
    };
    const findFileBySessionId = (sessionId = '') => {
      const safeSessionId = String(sessionId || '').trim();
      if (!safeSessionId) return null;
      return store.items.find((item) => {
        if (!item || item.type !== 'file') return false;
        const expected = makeKnowledgeSessionId(item.id);
        const actual = item.session?.metadata?.sessionId || item.session?.learning?.sessionId || expected;
        return actual === safeSessionId || expected === safeSessionId;
      }) || null;
    };
    const getCurrentFolder = () => getItem(isFolderId(store.currentFolderId) ? store.currentFolderId : ROOT_ID) || getItem(ROOT_ID);
    const getChildren = (folderId = ROOT_ID) => store.items
      .filter((item) => item.parentId === folderId)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
      });

    const getKnowledgeMapController = () => {
      if (knowledgeMapController) return knowledgeMapController;
      knowledgeMapController = window.KnowledgeMap?.createKnowledgeMapController?.({
        shell,
        getStore: () => store,
        saveStore: () => saveStore(),
        renderList: (options = {}) => renderList(options),
        openFile: (fileId, options = {}) => openFile(fileId, options),
        enterFolder: (folderId) => enterFolder(folderId),
        moveItemsToFolder: (itemIds, targetFolderId) => moveKnowledgeItemsToFolder(itemIds, targetFolderId),
        deleteItems: (itemIds) => deleteKnowledgeItemsFromMap(itemIds),
        rootId: ROOT_ID,
      }) || null;
      return knowledgeMapController;
    };

    const getKnowledgeSearchController = () => {
      if (knowledgeSearchController) return knowledgeSearchController;
      knowledgeSearchController = window.KnowledgeSearch?.createKnowledgeSearchController?.({
        shell,
        panel: knowledgeSearchPanel,
        input: knowledgeSearchInput,
        clearButton: knowledgeSearchClearButton,
        status: knowledgeSearchStatus,
        results: knowledgeSearchResults,
        getStore: () => store,
        getMapController: getKnowledgeMapController,
        openFile: (fileId, options = {}) => openFile(fileId, options),
      }) || null;
      return knowledgeSearchController;
    };

    const syncKnowledgeMapView = (options = {}) => {
      const map = getKnowledgeMapController();
      if (!map) return;
      if (!isKnowledgeModule()) {
        map.hide?.();
        return;
      }

      if (store.activeFileId) {
        if (getPanelMode() !== PANEL_LIST || !knowledgePointMapStage) {
          map.hide?.();
          return;
        }
        const mountChanged = Boolean(map.mountIn?.(knowledgePointMapStage, 'assist'));
        map.show?.({
          focusFolderId: options.focusFolderId || store.currentFolderId || ROOT_ID,
          immediate: Boolean(options.immediate || mountChanged),
          forceFocus: Boolean(options.forceFocus || mountChanged),
        });
        return;
      }

      const mountChanged = Boolean(map.mountInWorkspace?.());
      map.show?.({
        focusFolderId: options.focusFolderId || store.currentFolderId || ROOT_ID,
        immediate: Boolean(options.immediate || mountChanged),
        forceFocus: Boolean(options.forceFocus || mountChanged),
      });
    };

    const collectDescendantIds = (itemId) => {
      const removed = new Set();
      const visit = (id) => {
        if (!id || removed.has(id)) return;
        removed.add(id);
        store.items
          .filter((item) => item.parentId === id)
          .forEach((child) => visit(child.id));
      };
      visit(itemId);
      return removed;
    };

    const syncDeleteModeUi = () => {
      if (shell) shell.dataset.knowledgeDeleteMode = isDeleteMode ? 'true' : 'false';
      if (knowledgeDeleteModeButton) {
        knowledgeDeleteModeButton.classList.toggle('is-active', isDeleteMode);
        knowledgeDeleteModeButton.classList.toggle('is-transitioning', deleteModeTransitionRunning);
        knowledgeDeleteModeButton.setAttribute('aria-pressed', isDeleteMode ? 'true' : 'false');
        knowledgeDeleteModeButton.title = isDeleteMode ? '退出删除状态' : '删除项目';
        knowledgeDeleteModeButton.setAttribute('aria-label', knowledgeDeleteModeButton.title);
      }
    };

    const applyDeleteModeTransition = async (targetState) => {
      const nextState = Boolean(targetState);
      if (isDeleteMode === nextState && !shell?.dataset?.knowledgeDeleteTransition) {
        syncDeleteModeUi();
        return;
      }

      deleteModeTransitionRunning = true;
      if (shell) {
        shell.dataset.knowledgeDeleteTransition = nextState ? 'entering' : 'leaving';
      }
      isDeleteMode = nextState;
      syncDeleteModeUi();

      // Keep the item DOM stable while icon buttons animate. The list is not
      // re-rendered here; otherwise exit animations would be cut off by
      // replaceChildren().
      await nextFrame();
      await wait(prefersReducedMotion() ? 0 : 260);

      if (shell?.dataset?.knowledgeDeleteTransition) delete shell.dataset.knowledgeDeleteTransition;
      deleteModeTransitionRunning = false;
      syncDeleteModeUi();
    };

    const requestDeleteMode = (targetState) => {
      pendingDeleteModeTarget = Boolean(targetState);
      if (deleteModeTransitionRunning) return;

      const drain = () => {
        if (pendingDeleteModeTarget === null) return;
        const target = pendingDeleteModeTarget;
        pendingDeleteModeTarget = null;
        applyDeleteModeTransition(target)
          .catch((error) => console.error('[knowledge-warehouse] delete mode transition failed', error))
          .finally(() => {
            if (pendingDeleteModeTarget !== null) drain();
          });
      };

      drain();
    };

    const saveStore = () => {
      store = writeStore(store);
      return store;
    };

    const captureCurrentLearningSnapshot = () => captureMountedLearningSnapshot({
      sessionId: makeKnowledgeSessionId(store.activeFileId),
      title: getActiveFile()?.name || '未命名文件',
      source: 'knowledge-warehouse',
      knowledgeFileId: store.activeFileId,
    });

    const saveActiveFileSession = (options = {}) => {
      if (!store.activeFileId || isSavingActiveFile) return false;
      const file = getActiveFile();
      if (!file || file.type !== 'file') return false;
      const expectedSessionId = getActiveKnowledgeSessionId();
      const currentSessionId = getCurrentLearningSessionId();
      const nodeCount = getCurrentLearningNodeCount();

      // Knowledge files are independent from the workbench history/current-session
      // store. Only capture the global learning tree while the active knowledge
      // file is actually mounted in that tree. Workbench resets, history clears,
      // or empty current-session writes must never overwrite the file snapshot.
      if (!options.force && (!expectedSessionId || currentSessionId !== expectedSessionId || nodeCount === 0)) {
        return false;
      }

      isSavingActiveFile = true;
      try {
        const snapshot = captureCurrentLearningSnapshot();
        if (!options.force && (!snapshot.learning?.nodes?.length || snapshot.learning.sessionId !== expectedSessionId)) {
          return false;
        }
        file.session = normalizeKnowledgeFileSession(file, snapshot, { freezeTyping: true });
        const root = file.session.learning.nodes.find((node) => !node.parentId) || file.session.learning.nodes[0];
        if (root?.answer) file.text = String(root.answer || file.text || '');
        file.updatedAt = new Date().toISOString();
        saveStore();
        return true;
      } finally {
        isSavingActiveFile = false;
      }
    };

    const isLearningRequestContextCurrent = (context = {}) => {
      if (context.mode !== 'knowledge') return false;
      const activeSessionId = getActiveKnowledgeSessionId();
      const currentStoreSessionId = appStore?.select?.('learningData', null)?.sessionId || stackState?.sessionId || '';
      return Boolean(
        isKnowledgeModule()
        && store.activeFileId
        && context.knowledgeFileId === store.activeFileId
        && activeSessionId
        && context.sessionId === activeSessionId
        && currentStoreSessionId === activeSessionId
        && appStore?.getLearningNode?.(context.nodeId)
      );
    };

    const markLearningRequestInFlight = (context = {}) => {
      if (context.mode !== 'knowledge' || !context.sessionId || !context.nodeId) return;
      const set = knowledgeRuntimeInFlight.get(context.sessionId) || new Set();
      set.add(context.nodeId);
      knowledgeRuntimeInFlight.set(context.sessionId, set);
    };

    const finishLearningRequestInFlight = (context = {}) => {
      if (context.mode !== 'knowledge' || !context.sessionId) return;
      const set = knowledgeRuntimeInFlight.get(context.sessionId);
      if (set && context.nodeId) set.delete(context.nodeId);
      if (!set || set.size === 0) knowledgeRuntimeInFlight.delete(context.sessionId);
    };

    const patchKnowledgeFileNodeBySession = ({ sessionId = '', nodeId = '', patch = {}, providerName = '', addAssistantMessage = false, errorMessage = '' } = {}) => {
      const file = findFileBySessionId(sessionId);
      if (!file || file.type !== 'file') return { ok: false, error: '没有找到对应知识文件' };
      const snapshot = normalizeKnowledgeFileSession(file, file.session || makeFileSession(file), { freezeTyping: false });
      const learning = snapshot.learning || {};
      const nodes = Array.isArray(learning.nodes) ? learning.nodes : [];
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return { ok: false, error: '没有找到对应知识节点' };
      Object.assign(node, patch);
      if (errorMessage) node.errorMessage = String(errorMessage);
      learning.messages = Array.isArray(learning.messages) ? learning.messages : [];
      if (addAssistantMessage && patch.answer) {
        const existing = learning.messages.find((message) => message.role === 'assistant' && message.questionId === nodeId);
        if (existing) existing.content = patch.answer;
        else learning.messages.push({ role: 'assistant', questionId: nodeId, content: patch.answer });
      }
      snapshot.learning = learning;
      snapshot.metadata = {
        ...(snapshot.metadata || {}),
        sessionId: makeKnowledgeSessionId(file.id),
        knowledgeFileId: file.id,
        updatedAt: new Date().toISOString(),
      };
      snapshot.learning.sessionId = snapshot.metadata.sessionId;
      file.session = normalizeKnowledgeFileSession(file, snapshot, { freezeTyping: false });
      const root = file.session.learning.nodes.find((candidate) => !candidate.parentId) || file.session.learning.nodes[0];
      if (root?.answer) file.text = String(root.answer || file.text || '');
      file.updatedAt = new Date().toISOString();
      saveStore();
      finishLearningRequestInFlight({ mode: 'knowledge', sessionId: snapshot.metadata.sessionId, nodeId });
      return { ok: true, fileId: file.id };
    };

    const completeBackgroundLearningRequest = async ({ sessionId = '', nodeId = '', answer = '', providerName = '当前 API' } = {}) => {
      const normalizedAnswer = String(answer || '').trim() || 'AI 没有返回有效内容。';
      return patchKnowledgeFileNodeBySession({
        sessionId,
        nodeId,
        providerName,
        addAssistantMessage: true,
        patch: {
          status: 'answered',
          answer: normalizedAnswer,
          displayedAnswer: normalizedAnswer,
          isTyping: false,
          loadingText: '',
          loadingMeta: '',
          answerMeta: `${providerName} · 回复`,
          errorMessage: '',
        },
      });
    };

    const failBackgroundLearningRequest = async ({ sessionId = '', nodeId = '', errorMessage = '' } = {}) => {
      return patchKnowledgeFileNodeBySession({
        sessionId,
        nodeId,
        errorMessage,
        patch: {
          status: 'error',
          isTyping: false,
          loadingText: '',
          loadingMeta: '',
          errorMessage: String(errorMessage || 'API 请求失败'),
        },
      });
    };

    const getLearningRequestContext = (node = {}) => {
      if (!isKnowledgeModule() || !store.activeFileId) return null;
      const sessionId = getActiveKnowledgeSessionId();
      if (!sessionId) return null;
      return {
        mode: 'knowledge',
        sessionId,
        knowledgeFileId: store.activeFileId,
        nodeId: node?.id || '',
        startedAt: new Date().toISOString(),
      };
    };

    const restoreFileToWorkspace = (file, options = {}) => {
      if (options.captureWorkbench !== false) suspendWorkbenchRuntimeForKnowledge();
      stopAllAnswerTypewriters?.();
      const forceActiveQuestionId = options.forceActiveQuestionId === false ? '' : (options.forceActiveQuestionId || 'Q0');
      const snapshot = normalizeKnowledgeFileSession(file, file.session || makeFileSession(file), { freezeTyping: true, forceActiveQuestionId });
      file.session = snapshot;
      file.updatedAt = new Date().toISOString();
      saveStore();
      appStore?.restoreLearningSession?.(snapshot, {
        source: 'knowledge-warehouse:open-file',
        sessionId: snapshot.metadata?.sessionId || '',
        knowledgeFileId: file.id || '',
      });
      stateMachine?.refresh?.();
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      const contentRenderResult = renderActiveNodePage?.({
        force: true,
        animateEnter: true,
        awaitTransition: Boolean(options.awaitContentTransition),
        scrollTop: true,
        reason: options.reason || 'knowledge-file-opened',
      });
      renderAttachmentTray?.();
      syncRichContextUi?.();
      syncPromptPlaceholder?.();
      syncSendState?.();
      const settleRestoredFile = () => {
        scheduleFingerprintReflow?.([0, 80, 220]);
        window.requestAnimationFrame?.(() => focusPrompt?.());
        return true;
      };
      if (options.awaitContentTransition && contentRenderResult?.then) {
        return contentRenderResult.then(settleRestoredFile);
      }
      return settleRestoredFile();
    };

    const ensureActiveKnowledgeFileMounted = (options = {}) => {
      const file = getActiveFile();
      if (!file || file.type !== 'file') return false;
      if (!options.force && isActiveKnowledgeFileMounted()) return true;
      restoreFileToWorkspace(file, {
        forceActiveQuestionId: options.forceActiveQuestionId,
        reason: options.reason || 'knowledge-file-remounted',
      });
      return true;
    };

    const suspendActiveFileSession = async (options = {}) => {
      if (!store.activeFileId) return false;
      saveActiveFileSession();
      if (options.clearWorkspace !== false) {
        await restoreSuspendedWorkbenchRuntime({
          ...options,
          source: 'knowledge-warehouse:suspend-active-file',
          reason: options.reason || 'knowledge-warehouse:suspend-active-file',
        });
      }
      return true;
    };

    const buildFolderPath = (folderId) => {
      const path = [];
      let current = getItem(folderId);
      const guard = new Set();
      while (current && !guard.has(current.id)) {
        guard.add(current.id);
        path.unshift(current);
        current = current.parentId ? getItem(current.parentId) : null;
      }
      return path.length ? path : [getItem(ROOT_ID)].filter(Boolean);
    };

    const uniqueFolderName = (parentId) => {
      const names = new Set(getChildren(parentId).filter((item) => item.type === 'folder').map((item) => item.name));
      let index = 1;
      while (names.has(`新建文件夹${index}`)) index += 1;
      return `新建文件夹${index}`;
    };

    const uniqueKnowledgeItemName = (item = null, requestedName = '') => {
      const parentId = item?.parentId || ROOT_ID;
      const fallback = item?.type === 'file' ? '未命名文件' : uniqueFolderName(parentId);
      const baseName = normalizeName(requestedName) || fallback;
      if (!item || item.id === ROOT_ID) return baseName;
      const siblingNames = new Set(getChildren(parentId)
        .filter((candidate) => candidate && candidate.id !== item.id && candidate.type === item.type)
        .map((candidate) => normalizeName(candidate.name))
        .filter(Boolean));
      if (!siblingNames.has(baseName)) return baseName;
      let index = 2;
      let candidateName = `${baseName} ${index}`;
      while (siblingNames.has(candidateName)) {
        index += 1;
        candidateName = `${baseName} ${index}`;
      }
      return candidateName;
    };

    const applyFileRenameToSession = (file = null, name = '') => {
      if (!file || file.type !== 'file') return;
      const normalizedTitle = normalizeName(name) || '未命名文件';
      if (!file.session || typeof file.session !== 'object') file.session = makeFileSession({ ...file, name: normalizedTitle });
      file.name = normalizedTitle;
      file.session = normalizeKnowledgeFileSession(file, file.session, {
        freezeTyping: true,
        forceActiveQuestionId: false,
        syncRootTitle: true,
      });
      file.session.metadata = {
        ...(file.session.metadata || {}),
        title: normalizedTitle,
        knowledgeFileId: file.id || file.session.metadata?.knowledgeFileId || '',
        sessionId: makeKnowledgeSessionId(file.id || file.session.metadata?.knowledgeFileId || ''),
        updatedAt: new Date().toISOString(),
      };
      if (file.session.learning) file.session.learning.sessionId = file.session.metadata.sessionId;
    };

    const refreshRenamedActiveFileUi = (file = null) => {
      if (!file || file.type !== 'file' || store.activeFileId !== file.id) return;
      syncKnowledgeFilePresence();
      const snapshot = normalizeKnowledgeFileSession(file, file.session || makeFileSession(file), {
        freezeTyping: true,
        forceActiveQuestionId: false,
        syncRootTitle: true,
      });
      file.session = snapshot;
      appStore?.restoreLearningSession?.(snapshot, {
        source: 'knowledge-warehouse:file-rename-active-sync',
        sessionId: snapshot.metadata?.sessionId || '',
        knowledgeFileId: file.id || '',
      });
      stateMachine?.refresh?.();
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      renderActiveNodePage?.({ force: true, animateEnter: false, scrollTop: false, reason: 'knowledge-file-renamed' });
      syncPromptPlaceholder?.();
      syncSendState?.();
      scheduleFingerprintReflow?.([0, 80, 220]);
    };

    const commitRename = (itemId, value = '') => {
      if (isCommittingRename) return;
      let item = getItem(itemId);
      if (!item || item.id === ROOT_ID) return;
      const itemType = item.type;
      isCommittingRename = true;
      suppressBlurCommit = true;
      try {
        if (itemType === 'file' && item.id === store.activeFileId) {
          // saveActiveFileSession normalizes and reassigns `store`, so any item
          // object captured before it becomes stale. Re-read the file before
          // applying the rename; otherwise the active file appears to rename in
          // the input but the list/content falls back to the old title.
          saveActiveFileSession();
          item = getItem(itemId);
          if (!item || item.id === ROOT_ID) return;
        }
        const name = uniqueKnowledgeItemName(item, value);
        const changed = item.name !== name;
        item.name = name;
        item.updatedAt = new Date().toISOString();
        if (item.type === 'file') applyFileRenameToSession(item, name);
        renamingItemId = '';
        saveStore();
        const committedItem = getItem(itemId) || item;
        renderList({ source: itemType === 'file' ? 'file-rename-commit' : 'folder-rename-commit' });
        getKnowledgeMapController()?.syncStore?.({ focusFolderId: store.currentFolderId || ROOT_ID });
        if (changed && itemType === 'file') refreshRenamedActiveFileUi(committedItem);
      } finally {
        window.setTimeout(() => {
          isCommittingRename = false;
          suppressBlurCommit = false;
        }, 0);
      }
    };

    const runFolderTransition = async (folderId) => {
      const targetId = isFolderId(folderId) ? folderId : ROOT_ID;
      const target = getItem(targetId);
      if (!target || target.type !== 'folder') return;
      const token = ++folderTransitionToken;
      if (store.currentFolderId === targetId) {
        renderList();
        return;
      }

      const shouldAnimate = Boolean(knowledgeList && knowledgeList.childElementCount && !prefersReducedMotion());
      knowledgeList?.classList?.remove('is-folder-entering', 'is-folder-settled');
      if (shouldAnimate) {
        knowledgeList.classList.add('is-folder-leaving');
        await waitForTransition(knowledgeList, 180);
      }
      if (token !== folderTransitionToken) return;

      store.currentFolderId = targetId;
      saveStore();

      if (shouldAnimate) knowledgeList.classList.add('is-folder-entering');
      knowledgeList?.classList?.remove('is-folder-leaving');
      renderList({ source: 'folder-transition' });

      if (shouldAnimate) {
        await nextFrame();
        if (token !== folderTransitionToken) return;
        knowledgeList.classList.remove('is-folder-entering');
        knowledgeList.classList.add('is-folder-settled');
        await waitForTransition(knowledgeList, 200);
        if (token !== folderTransitionToken) return;
        knowledgeList.classList.remove('is-folder-settled');
      } else {
        knowledgeList?.classList?.remove('is-folder-entering', 'is-folder-leaving', 'is-folder-settled');
      }
    };

    const enterFolder = (folderId) => {
      if (!isFolderId(folderId)) return Promise.resolve(false);
      folderTransitionQueue = folderTransitionQueue
        .catch(() => {})
        .then(() => runFolderTransition(folderId));
      return folderTransitionQueue;
    };

    const runOpenFile = async (fileId, options = {}) => {
      const file = getItem(fileId);
      if (!file || file.type !== 'file') return false;
      if (options.requestToken && options.requestToken !== mapFileOpenToken) return false;
      if (file.id === store.activeFileId && isActiveKnowledgeFileMounted()) return true;
      const previousFileId = store.activeFileId || '';
      const shouldAnimateFromMap = Boolean(
        options.animateMapTransition
        && isKnowledgeModule()
        && !store.activeFileId
      );
      if (shell) {
        shell.dataset.knowledgeFileTransition = previousFileId ? 'switching' : 'opening';
        shell.dataset.knowledgeFileTransitionTarget = file.id;
      }
      try {
        if (shouldAnimateFromMap) {
          await (getKnowledgeMapController()?.leaveForFileOpen?.({ fileId: file.id }) || Promise.resolve(false));
        }
        if (options.requestToken && options.requestToken !== mapFileOpenToken) return false;
        const latestFile = getItem(fileId);
        if (!latestFile || latestFile.type !== 'file') return false;
        saveActiveFileSession();
        store.activeFileId = latestFile.id;
        saveStore();
        syncKnowledgeFilePresence();
        if (!previousFileId) getKnowledgeMapController()?.hide?.();
        setPanelMode(PANEL_LIST);
        renderList();
        await Promise.resolve(restoreFileToWorkspace(latestFile, {
          awaitContentTransition: true,
          reason: options.reason || (shouldAnimateFromMap ? 'knowledge-map-file-opened' : 'knowledge-file-opened'),
        }));
        if (options.requestToken && options.requestToken !== mapFileOpenToken) return false;
        syncKnowledgeMapView({ focusFolderId: latestFile.parentId || store.currentFolderId || ROOT_ID });
        return true;
      } finally {
        if (!options.requestToken || options.requestToken === mapFileOpenToken) {
          if (shell?.dataset?.knowledgeFileTransition) delete shell.dataset.knowledgeFileTransition;
          if (shell?.dataset?.knowledgeFileTransitionTarget) delete shell.dataset.knowledgeFileTransitionTarget;
        }
      }
    };

    const openFile = (fileId, options = {}) => {
      const fromKnowledgeMap = Boolean(options.source === 'knowledge-map' || options.animateMapTransition);
      const requestToken = ++mapFileOpenToken;
      mapFileOpenQueue = mapFileOpenQueue
        .catch(() => {})
        .then(() => {
          if (requestToken !== mapFileOpenToken) return false;
          return runOpenFile(fileId, {
            ...options,
            requestToken,
            animateMapTransition: fromKnowledgeMap,
          });
        })
        .catch((error) => {
          console.error('[knowledge-warehouse] knowledge file transition failed', error);
          return false;
        });
      return mapFileOpenQueue;
    };

    const createFolder = () => {
      const parentId = isFolderId(store.currentFolderId) ? store.currentFolderId : ROOT_ID;
      const folder = {
        id: uid('folder'),
        type: 'folder',
        parentId,
        name: '',
        children: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.items.push(folder);
      const parent = getItem(parentId);
      if (parent) parent.children = [...new Set([...(parent.children || []), folder.id])];
      renamingItemId = folder.id;
      enteringItemIds.add(folder.id);
      saveStore();
      renderList();
      window.requestAnimationFrame?.(() => {
        const input = knowledgeList?.querySelector?.(`[data-knowledge-rename="${folder.id}"]`);
        input?.focus?.();
        input?.select?.();
        scheduleClearItemEnter(folder.id);
      });
    };

    const startRenameItem = (itemId) => {
      const item = getItem(itemId);
      if (!item || item.id === ROOT_ID) return false;
      if (item.type !== 'folder' && item.type !== 'file') return false;
      if (isDeleteMode) requestDeleteMode(false);
      renamingItemId = item.id;
      renderList({ source: item.type === 'file' ? 'file-rename-start' : 'folder-rename-start' });
      window.requestAnimationFrame?.(() => {
        const input = knowledgeList?.querySelector?.(`[data-knowledge-rename="${item.id}"]`);
        input?.focus?.();
        input?.select?.();
      });
      return true;
    };

    const startRenameFolder = (itemId) => {
      const item = getItem(itemId);
      if (!item || item.type !== 'folder') return false;
      return startRenameItem(itemId);
    };

    const startRenameFile = (itemId) => {
      const item = getItem(itemId);
      if (!item || item.type !== 'file') return false;
      return startRenameItem(itemId);
    };

    const removeKnowledgeItemFromStore = async (itemId) => {
      const item = getItem(itemId);
      if (!item || item.id === ROOT_ID) return false;
      const parentId = isFolderId(item.parentId) ? item.parentId : ROOT_ID;
      const removedIds = collectDescendantIds(item.id);
      const removedItems = store.items.filter((entry) => removedIds.has(entry.id));
      const removedSessionIds = new Set();
      removedItems.filter((entry) => entry.type === 'file').forEach((file) => {
        removedSessionIds.add(makeKnowledgeSessionId(file.id));
        const storedSessionId = String(file.session?.metadata?.sessionId || file.session?.learning?.sessionId || '').trim();
        if (storedSessionId) removedSessionIds.add(storedSessionId);
      });
      const currentSessionId = getCurrentLearningSessionId();
      const runtimeBelongsToRemovedFile = removedSessionIds.has(currentSessionId);
      const candidateAttachmentIds = collectKnowledgeAttachmentIds(removedItems);
      if (runtimeBelongsToRemovedFile) collectRuntimeAttachmentIds(candidateAttachmentIds);
      const activeFileDeleted = Boolean(store.activeFileId && removedIds.has(store.activeFileId));
      const currentFolderDeleted = Boolean(store.currentFolderId && removedIds.has(store.currentFolderId));
      store.items = store.items.filter((entry) => !removedIds.has(entry.id));
      store.items.forEach((entry) => {
        if (Array.isArray(entry.children)) entry.children = entry.children.filter((id) => !removedIds.has(id));
      });
      if (currentFolderDeleted) store.currentFolderId = isFolderId(parentId) ? parentId : ROOT_ID;
      if (activeFileDeleted) {
        store.activeFileId = '';
        setPanelMode(PANEL_LIST);
      }
      renamingItemId = '';
      saveStore();
      const preserveAttachmentIds = collectKnowledgeAttachmentIds(store.items);
      if (!runtimeBelongsToRemovedFile) collectRuntimeAttachmentIds(preserveAttachmentIds);
      window.AttachmentReferences?.collectFromSession?.(suspendedWorkbenchSnapshot, preserveAttachmentIds);
      renderList();
      if (activeFileDeleted) {
        syncKnowledgeFilePresence();
        await restoreSuspendedWorkbenchRuntime({
          source: 'knowledge-warehouse:delete-active-file',
          reason: 'knowledge-warehouse:delete-active-file',
          animateClear: false,
        });
        stateMachine?.refresh?.();
        await (clearContentStream?.({ animate: true }) || Promise.resolve());
        renderWorkbenchTree?.();
        renderWorkbenchGraph?.();
        renderAttachmentTray?.();
        syncRichContextUi?.();
        syncPromptPlaceholder?.();
        syncSendState?.();
        scheduleFingerprintReflow?.([0, 80, 220]);
      }
      await deleteUnreferencedLocalAttachments(
        window.AttachmentReferences?.toArray?.(candidateAttachmentIds) || [...candidateAttachmentIds],
        window.AttachmentReferences?.toArray?.(preserveAttachmentIds) || [...preserveAttachmentIds]
      );
      return true;
    };

    const deleteKnowledgeItem = async (itemId) => {
      const item = getItem(itemId);
      if (!item || item.id === ROOT_ID || deletingItemIds.has(item.id)) return false;

      deletingItemIds.add(item.id);
      const mapDeleteAnimation = getKnowledgeMapController()?.animateDeleteItems?.([item.id]) || Promise.resolve(false);
      const element = knowledgeList?.querySelector?.(`[data-knowledge-item-id="${item.id}"]`);
      const listDeleteAnimation = (async () => {
        if (element) {
          element.classList.remove('is-item-entering');
          element.classList.add('is-item-leaving');
          element.setAttribute('aria-hidden', 'true');
          await waitForItemAnimation(element, 280);
        } else {
          await wait(prefersReducedMotion() ? 0 : 120);
        }
      })();
      await Promise.all([listDeleteAnimation, mapDeleteAnimation]);

      enteringItemIds.delete(item.id);
      deletingItemIds.delete(item.id);
      return removeKnowledgeItemFromStore(item.id);
    };

    const moveKnowledgeItemsToFolder = async (itemIds = [], targetFolderId = ROOT_ID) => {
      const ids = [...new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).filter(Boolean))];
      const safeTargetId = isFolderId(targetFolderId) ? targetFolderId : ROOT_ID;
      let changed = false;
      ids.forEach((itemId) => {
        const item = getItem(itemId);
        if (!item || item.id === ROOT_ID) return;
        let nextParentId = safeTargetId;
        if (item.type === 'folder') {
          const descendants = collectDescendantIds(item.id);
          if (descendants.has(nextParentId) || nextParentId === item.id) nextParentId = ROOT_ID;
        }
        if (item.parentId === nextParentId) return;
        item.parentId = nextParentId;
        item.updatedAt = new Date().toISOString();
        changed = true;
      });
      if (!changed) {
        getKnowledgeMapController()?.requestRender?.();
        return false;
      }
      renamingItemId = '';
      saveStore();
      renderList({ source: 'knowledge-map-move' });
      getKnowledgeMapController()?.syncStore?.({ focusFolderId: store.currentFolderId || ROOT_ID });
      return true;
    };

    const deleteKnowledgeItemsFromMap = async (itemIds = []) => {
      const ids = [...new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).filter(Boolean))]
        .filter((id) => id && id !== ROOT_ID && getItem(id));
      if (!ids.length) return false;
      await (getKnowledgeMapController()?.animateDeleteItems?.(ids) || Promise.resolve(false));
      let changed = false;
      for (const id of ids) {
        if (!getItem(id)) continue;
        const ok = await removeKnowledgeItemFromStore(id);
        changed = Boolean(ok) || changed;
      }
      if (changed) {
        renderList({ source: 'knowledge-map-delete' });
        getKnowledgeMapController()?.syncStore?.({ focusFolderId: store.currentFolderId || ROOT_ID });
      }
      return changed;
    };

    const syncFolderHeader = () => {
      const folder = getCurrentFolder();
      const isRoot = !folder || folder.id === ROOT_ID;
      const parentId = isRoot ? ROOT_ID : (getParentFolderId(folder.id) || ROOT_ID);
      if (knowledgeBreadcrumb) {
        knowledgeBreadcrumb.replaceChildren();
        knowledgeBreadcrumb.hidden = true;
        knowledgeBreadcrumb.setAttribute('aria-hidden', 'true');
      }
      if (knowledgeTitleText) {
        // The module title stays stable. Folder navigation is expressed by the
        // title-adjacent back button and the animated list transition, instead
        // of showing breadcrumb rows inside the list.
        knowledgeTitleText.textContent = '知识仓库';
        knowledgeTitleText.title = isRoot ? '知识仓库' : `知识仓库 / ${folder.name || '未命名文件夹'}`;
      }
      if (shell) {
        shell.dataset.knowledgeCanGoUp = isRoot ? 'false' : 'true';
        shell.dataset.knowledgeCurrentFolderId = folder?.id || ROOT_ID;
        shell.dataset.knowledgeParentFolderId = parentId;
      }
      if (knowledgeFolderBackButton) {
        // Keep the button in the layout at all times and control its visibility
        // with CSS. Do not use the native disabled attribute here: if CSS/data
        // state makes the button visible while the DOM disabled flag is stale,
        // the browser will suppress click events. Use aria-disabled + CSS
        // pointer-events instead, and let the click handler re-check state.
        knowledgeFolderBackButton.hidden = false;
        knowledgeFolderBackButton.disabled = false;
        knowledgeFolderBackButton.dataset.targetFolderId = parentId;
        knowledgeFolderBackButton.dataset.currentFolderId = folder?.id || ROOT_ID;
        knowledgeFolderBackButton.classList.toggle('is-visible', !isRoot);
        knowledgeFolderBackButton.setAttribute('aria-hidden', isRoot ? 'true' : 'false');
        knowledgeFolderBackButton.setAttribute('aria-disabled', isRoot ? 'true' : 'false');
        knowledgeFolderBackButton.tabIndex = isRoot ? -1 : 0;
      }
    };

    const renderListItem = (item) => {
      const signature = `${item.type || ''}|${item.name || ''}|${renamingItemId === item.id ? 'rename' : 'label'}`;
      const cached = knowledgeListItemCache.get(item.id);
      if (cached?.signature === signature) {
        const cachedButton = cached.button;
        cachedButton.classList.toggle('is-active', item.id === store.activeFileId);
        cachedButton.classList.toggle('is-item-entering', enteringItemIds.has(item.id));
        cachedButton.classList.toggle('is-item-leaving', deletingItemIds.has(item.id));
        return cachedButton;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'knowledge-item';
      button.classList.toggle('is-folder', item.type === 'folder');
      button.classList.toggle('is-file', item.type === 'file');
      button.classList.toggle('is-active', item.id === store.activeFileId);
      button.classList.toggle('is-item-entering', enteringItemIds.has(item.id));
      button.classList.toggle('is-item-leaving', deletingItemIds.has(item.id));
      button.dataset.knowledgeItemId = item.id;

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'knowledge-item-delete';
      deleteButton.title = item.type === 'folder' ? '删除文件夹' : '删除文件';
      deleteButton.setAttribute('aria-label', deleteButton.title);
      deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteKnowledgeItem(item.id);
      });
      button.appendChild(deleteButton);

      const icon = document.createElement('span');
      icon.className = `knowledge-item-icon knowledge-item-icon--${item.type}`;
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);

      if (renamingItemId === item.id) {
        const input = document.createElement('input');
        input.className = 'knowledge-rename-input';
        input.dataset.knowledgeRename = item.id;
        input.value = item.name || '';
        input.placeholder = item.type === 'file' ? '未命名文件' : '新建文件夹';
        input.addEventListener('click', (event) => event.stopPropagation());
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            suppressBlurCommit = true;
            commitRename(item.id, input.value);
            window.setTimeout(() => { suppressBlurCommit = false; }, 0);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            commitRename(item.id, '');
          }
        });
        input.addEventListener('blur', () => {
          if (suppressBlurCommit || isCommittingRename || renamingItemId !== item.id) return;
          commitRename(item.id, input.value);
        });
        button.appendChild(input);
      } else {
        const title = document.createElement('span');
        title.className = 'knowledge-item-title';
        title.textContent = item.name || (item.type === 'file' ? '未命名文件' : '未命名文件夹');
        button.appendChild(title);
      }

      if (item.id !== ROOT_ID) {
        button.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          event.stopPropagation();
          startRenameItem(item.id);
        });
      }

      button.addEventListener('click', (event) => {
        if (renamingItemId === item.id) return;
        event.preventDefault();
        if (item.type === 'folder') enterFolder(item.id);
        else openFile(item.id);
      });
      knowledgeListItemCache.set(item.id, { button, signature });
      return button;
    };

    const replaceKnowledgeListChildren = (nodes = []) => {
      if (!knowledgeList) return;
      const previousSuppress = suppressBlurCommit;
      suppressBlurCommit = true;
      try {
        const desiredNodes = nodes.filter(Boolean);
        const desiredSet = new Set(desiredNodes);
        Array.from(knowledgeList.childNodes).forEach((child) => {
          if (!desiredSet.has(child) && child.parentNode === knowledgeList) knowledgeList.removeChild(child);
        });
        desiredNodes.forEach((node, index) => {
          const current = knowledgeList.childNodes[index];
          if (current !== node) knowledgeList.insertBefore(node, current || null);
        });
      } finally {
        suppressBlurCommit = previousSuppress;
      }
    };

    const renderList = (_options = {}) => {
      if (!knowledgeList) return;
      syncFolderHeader();
      const nodes = [];
      const children = getChildren(store.currentFolderId || ROOT_ID);
      if (!children.length) {
        const empty = knowledgeListEmptyState || document.createElement('div');
        empty.className = 'knowledge-list-empty';
        empty.textContent = '这个列表还是空的。点击右上角新建文件夹。';
        knowledgeListEmptyState = empty;
        nodes.push(empty);
      } else {
        children.forEach((item) => nodes.push(renderListItem(item)));
      }
      knowledgeListItemCache.forEach((_cached, itemId) => {
        if (!getItem(itemId)) knowledgeListItemCache.delete(itemId);
      });
      replaceKnowledgeListChildren(nodes);
      syncActionButtons();
      syncDeleteModeUi();
      if (isKnowledgeModule()) {
        getKnowledgeMapController()?.syncStore?.({
          focusFolderId: store.currentFolderId || ROOT_ID,
          forceFocus: _options?.source === 'folder-transition',
        });
        getKnowledgeSearchController()?.refresh?.();
      }
    };

    const syncActionButtons = () => {
      const hasActiveFile = Boolean(store.activeFileId && getActiveFile());
      syncKnowledgeFilePresence();
      const inSession = getPanelMode() === PANEL_SESSION;
      const nextLabel = inSession ? '返回知识列表' : (hasActiveFile ? '查看逻辑结构' : '新建文件夹');
      const glyph = inSession ? '←' : (hasActiveFile ? '→' : '＋');
      if (knowledgeNewFolderButton) {
        knowledgeNewFolderButton.textContent = glyph;
        knowledgeNewFolderButton.title = nextLabel;
        knowledgeNewFolderButton.setAttribute('aria-label', nextLabel);
        knowledgeNewFolderButton.classList.toggle('is-arrow', hasActiveFile || inSession);
      }
      if (knowledgeWideNewButton) {
        knowledgeWideNewButton.textContent = inSession ? '←' : (hasActiveFile ? '→' : '＋');
        knowledgeWideNewButton.title = inSession ? '返回知识列表' : (hasActiveFile ? '查看逻辑结构' : '新建');
        knowledgeWideNewButton.setAttribute('aria-label', knowledgeWideNewButton.title);
        knowledgeWideNewButton.classList.toggle('is-arrow', hasActiveFile || inSession);
      }
      if (knowledgePointMapToLogicButton) {
        knowledgePointMapToLogicButton.textContent = '←';
        knowledgePointMapToLogicButton.title = '切换到逻辑图';
        knowledgePointMapToLogicButton.setAttribute('aria-label', '切换到逻辑图');
        knowledgePointMapToLogicButton.disabled = !hasActiveFile;
        knowledgePointMapToLogicButton.setAttribute('aria-disabled', hasActiveFile ? 'false' : 'true');
      }
      syncDeleteModeUi();
      treeToggleButtons.forEach((button) => {
        if (!button) return;
        if (isKnowledgeModule()) {
          const shouldShowArrow = inSession || hasActiveFile;
          button.textContent = inSession ? '←' : (hasActiveFile ? '→' : '');
          button.title = inSession ? '返回知识列表' : '查看逻辑结构';
          button.setAttribute('aria-label', button.title);
          button.classList.toggle('is-arrow', shouldShowArrow);
        } else {
          button.textContent = '←';
          button.title = '返回历史学习列表';
          button.setAttribute('aria-label', '返回历史学习列表');
          button.classList.add('is-arrow');
        }
      });
    };

    const enterKnowledgeModule = async () => {
      suspendWorkbenchRuntimeForKnowledge();
      if (!isKnowledgeSessionId(getCurrentLearningSessionId())) {
        await persistence?.saveNow?.();
      }
      if (!store.activeFileId) {
        // Knowledge idle state is a UI state, not a destructive workspace reset.
        // Keep the workbench learning tree/request lifecycle intact so a user can
        // switch to the knowledge warehouse while AI is still answering and then
        // return to the workbench without losing the question or response.
        stateMachine?.refresh?.();
        await (clearContentStream?.({ animate: true }) || Promise.resolve());
      }
      shell && (shell.dataset.knowledgePanel = shell.dataset.knowledgePanel || PANEL_LIST);
      syncKnowledgeFilePresence();
      renderList();
      if (store.activeFileId) {
        ensureActiveKnowledgeFileMounted({ reason: 'knowledge-module-enter', forceActiveQuestionId: false });
      } else {
        // The same map instance lives in the workspace while browsing and moves
        // into the wide assist panel after a knowledge file is opened.
      }
      syncKnowledgeMapView({ focusFolderId: store.currentFolderId || ROOT_ID });
      syncActionButtons();
      if (store.activeFileId && getPanelMode() === PANEL_SESSION) {
        renderWorkbenchTree?.();
        renderWorkbenchGraph?.();
      }
      renderAttachmentTray?.();
      syncRichContextUi?.();
      syncPromptPlaceholder?.();
      syncSendState?.();
      scheduleFingerprintReflow?.([0, 80, 220]);
    };

    const togglePanel = () => {
      if (!isKnowledgeModule()) return false;
      if (getPanelMode() === PANEL_SESSION) {
        setPanelMode(PANEL_LIST);
        renderList();
        syncKnowledgeMapView({ focusFolderId: getActiveFile()?.parentId || store.currentFolderId || ROOT_ID });
        syncSendState?.();
        scheduleFingerprintReflow?.([0, 80, 220]);
        return true;
      }
      if (!store.activeFileId) {
        createFolder();
        return true;
      }
      ensureActiveKnowledgeFileMounted({ reason: 'knowledge-session-panel-open', forceActiveQuestionId: false });
      setPanelMode(PANEL_SESSION);
      syncKnowledgeMapView();
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      syncActionButtons();
      syncSendState?.();
      scheduleFingerprintReflow?.([0, 80, 220]);
      return true;
    };

    const exitCurrentFile = async () => {
      if (!isKnowledgeModule()) return false;
      saveActiveFileSession();
      store.activeFileId = '';
      saveStore();
      syncKnowledgeFilePresence();
      setPanelMode(PANEL_LIST);
      await restoreSuspendedWorkbenchRuntime({
        source: 'knowledge-warehouse:exit-file',
        reason: 'knowledge-warehouse:exit-file',
        animateClear: false,
      });
      stateMachine?.refresh?.();
      await (clearContentStream?.({ animate: true }) || Promise.resolve());
      renderList();
      syncKnowledgeMapView({ focusFolderId: store.currentFolderId || ROOT_ID });
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      renderAttachmentTray?.();
      syncRichContextUi?.();
      syncPromptPlaceholder?.();
      syncSendState?.();
      scheduleFingerprintReflow?.([0, 80, 220]);
      return true;
    };

    const handleNewFolderClick = (event) => {
      if (!isKnowledgeModule()) return;
      event.preventDefault();
      event.stopPropagation();
      if (store.activeFileId || getPanelMode() === PANEL_SESSION) togglePanel();
      else createFolder();
    };

    const handleDeleteModeClick = (event) => {
      if (!isKnowledgeModule()) return;
      event.preventDefault();
      event.stopPropagation();
      const hadRename = Boolean(renamingItemId);
      renamingItemId = '';
      if (hadRename) renderList();
      requestDeleteMode(!isDeleteMode);
    };

    const handleTreeToggleClick = (event) => {
      if (!isKnowledgeModule()) return;
      event.preventDefault();
      event.stopPropagation();
      if (!store.activeFileId && getPanelMode() !== PANEL_SESSION) {
        // The wide-assist title button is reserved for the next stage. For now,
        // it is intentionally a no-op until a file has been selected.
        return;
      }
      togglePanel();
    };

    const goUpFolder = () => {
      const current = getCurrentFolder();
      if (!current || current.id === ROOT_ID) return false;
      const parentId = getParentFolderId(current.id);
      if (!parentId || !isFolderId(parentId)) return false;
      enterFolder(parentId);
      return true;
    };

    const handleFolderBackClick = (event) => {
      if (!isKnowledgeModule()) return;
      if (event?.__knowledgeFolderBackHandled) return;
      if (event) event.__knowledgeFolderBackHandled = true;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      goUpFolder();
    };

    const handleDocumentPointerDown = (event) => {
      if (!renamingItemId) return;
      const target = event.target;
      if (target?.closest?.('.knowledge-rename-input, .knowledge-new-folder')) return;
      const input = knowledgeList?.querySelector?.(`[data-knowledge-rename="${renamingItemId}"]`);
      if (input) commitRename(renamingItemId, input.value);
    };

    const attachEvents = () => {
      knowledgeNewFolderButton?.addEventListener?.('click', handleNewFolderClick);
      knowledgeDeleteModeButton?.addEventListener?.('click', handleDeleteModeClick);
      knowledgeFolderBackButton?.addEventListener?.('click', handleFolderBackClick);
      // Capture pointerup as a fallback for the title-adjacent icon button. In
      // some Electron/CSS states the click can be swallowed by a transition, but
      // pointerup still reaches the element reliably. A delegated listener is
      // also installed so the button remains functional even if the header is
      // re-rendered or CSS transitions move the hit target.
      knowledgeFolderBackButton?.addEventListener?.('pointerup', handleFolderBackClick);
      document.addEventListener('click', (event) => {
        if (event.target?.closest?.('.knowledge-folder-back')) handleFolderBackClick(event);
      }, true);
      document.addEventListener('pointerup', (event) => {
        if (event.target?.closest?.('.knowledge-folder-back')) handleFolderBackClick(event);
      }, true);
      knowledgeWideNewButton?.addEventListener?.('click', handleTreeToggleClick);
      knowledgePointMapToLogicButton?.addEventListener?.('click', handleTreeToggleClick);
      treeToggleButtons.forEach((button) => button?.addEventListener?.('click', handleTreeToggleClick));
      document.addEventListener('pointerdown', handleDocumentPointerDown, true);
      getKnowledgeMapController();
      getKnowledgeSearchController()?.attachEvents?.();
      if (!unsubscribeStore) {
        unsubscribeStore = appStore?.subscribe?.((_state, action = {}, changes = []) => {
          if (!isKnowledgeModule() || !store.activeFileId) return;
          if (!isActiveKnowledgeFileMounted()) return;
          const type = String(action.type || '');
          const source = String(action.meta?.source || '');
          if (source.startsWith('knowledge-warehouse:') || source.startsWith('workbench-history:')) return;
          const shouldSave = type.startsWith('learning/') || changes.some((change) => change.slice === 'learningData' || change.slice === 'ui');
          if (!shouldSave) return;
          window.clearTimeout(attachEvents._saveTimer);
          attachEvents._saveTimer = window.setTimeout(() => saveActiveFileSession(), 350);
        }) || null;
      }
    };


    const uniqueFileName = (baseName = '知识文件', parentId = ROOT_ID) => {
      const base = normalizeName(baseName) || '知识文件';
      const names = new Set(getChildren(parentId).filter((item) => item.type === 'file').map((item) => item.name));
      if (!names.has(base)) return base;
      let index = 1;
      while (names.has(`${base}${index}`)) index += 1;
      return `${base}${index}`;
    };

    const collectLearningDescendantIds = (rootNodeId, nodeMap) => {
      const ids = new Set();
      const orderedIds = [];
      const visit = (nodeId) => {
        if (!nodeId || ids.has(nodeId)) return;
        const node = nodeMap.get(nodeId);
        if (!node) return;
        ids.add(nodeId);
        orderedIds.push(nodeId);

        const explicitChildren = Array.isArray(node.children) ? node.children : [];
        const inferredChildren = Array.from(nodeMap.values())
          .filter((child) => child?.parentId === nodeId)
          .map((child) => child.id);
        [...explicitChildren, ...inferredChildren]
          .filter((childId) => nodeMap.has(childId))
          .forEach(visit);
      };
      visit(rootNodeId);
      return { ids, orderedIds };
    };

    const createSubtreeIdMap = (orderedIds = []) => {
      const map = new Map();
      orderedIds.forEach((oldId, index) => {
        map.set(oldId, `Q${index}`);
      });
      return map;
    };

    const remapQuestionId = (value, idMap) => {
      if (!value) return value;
      return idMap.get(value) || value;
    };

    const remapLearningSubtreeNodes = (orderedIds, nodeMap, idMap, rootNodeId) => {
      return orderedIds
        .map((oldId) => {
          const node = nodeMap.get(oldId);
          if (!node) return null;
          const next = clone(node);
          const newId = idMap.get(oldId);
          next.id = newId;
          next.sourceNodeId = oldId;
          next.parentId = oldId === rootNodeId ? null : (idMap.get(node.parentId) || null);
          const explicitChildren = Array.isArray(node.children) ? node.children : [];
          const inferredChildren = Array.from(nodeMap.values())
            .filter((child) => child?.parentId === oldId)
            .map((child) => child.id);
          next.children = [...new Set([...explicitChildren, ...inferredChildren])]
            .filter((childId) => idMap.has(childId))
            .map((childId) => idMap.get(childId));
          next.annotations = Array.isArray(node.annotations)
            ? node.annotations
              .map((annotation) => {
                if (!annotation || typeof annotation !== 'object') return null;
                const mappedChildId = idMap.get(annotation.childId);
                if (!mappedChildId) return null;
                return {
                  ...clone(annotation),
                  childId: mappedChildId,
                  sourceChildId: annotation.sourceChildId || annotation.childId,
                };
              })
              .filter(Boolean)
            : [];
          return next;
        })
        .filter(Boolean);
    };

    const remapLearningMessages = (messages = [], idMap) => {
      return clone(messages)
        .map((message) => {
          if (!message?.questionId) return message;
          if (!idMap.has(message.questionId)) return null;
          return {
            ...message,
            questionId: idMap.get(message.questionId),
            sourceQuestionId: message.sourceQuestionId || message.questionId,
          };
        })
        .filter(Boolean);
    };

    const buildLearningSubtreeSnapshot = (rootNodeId) => {
      const allNodes = clone(appStore?.getLearningNodes?.() || stackState?.nodes || []);
      const nodeMap = new Map(allNodes.map((node) => [node.id, node]));
      const sourceRoot = nodeMap.get(rootNodeId);
      if (!sourceRoot) return null;

      const { ids: includedIds, orderedIds } = collectLearningDescendantIds(rootNodeId, nodeMap);
      if (!orderedIds.length) return null;
      const idMap = createSubtreeIdMap(orderedIds);
      const subtreeNodes = remapLearningSubtreeNodes(orderedIds, nodeMap, idMap, rootNodeId);
      if (!subtreeNodes.length) return null;

      const learningData = appStore?.select?.('learningData', null) || {};
      const sourceMessages = appStore?.getLearningMessages?.() || learningData.messages || stackState?.messages || [];
      const messages = remapLearningMessages(sourceMessages, idMap);
      const sourceQuestionStack = clone(learningData.questionStack ?? stackState?.questionStack ?? [])
        .filter((nodeId) => includedIds.has(nodeId));
      const questionStack = sourceQuestionStack.length
        ? sourceQuestionStack.map((nodeId) => idMap.get(nodeId)).filter(Boolean)
        : ['Q0'];
      // A saved subtree is a new knowledge file. The clicked problem becomes
      // the new root page, even if another descendant happened to be active in
      // the workbench at the moment of saving.
      const activeQuestionId = 'Q0';
      const rootForText = subtreeNodes[0] || sourceRoot;
      const now = new Date().toISOString();
      return {
        schemaVersion: 1,
        metadata: {
          sessionId: `knowledge-import:${rootNodeId}:${Date.now()}`,
          title: normalizeName(rootForText?.question || sourceRoot?.question) || '知识文件',
          source: 'workbench-subtree',
          sourceNodeId: rootNodeId,
          sourceIdMap: Object.fromEntries(idMap.entries()),
          createdAt: now,
          updatedAt: now,
        },
        learning: {
          sessionId: '',
          hasMainQuestion: true,
          activeQuestionId,
          nodes: subtreeNodes,
          questionStack: questionStack.length ? questionStack : ['Q0'],
          messages,
          activeSelection: null,
          selectedAttachments: [],
          richContextMode: false,
          nextQuestionIndex: subtreeNodes.length,
        },
        graph: { scale: 1, x: 18, y: 18, positions: {}, manualPositions: {} },
      };
    };

    const saveLearningSubtreeAsRootFile = (rootNodeId) => {
      const snapshot = buildLearningSubtreeSnapshot(rootNodeId);
      if (!snapshot?.learning?.nodes?.length) return false;
      const rootNode = snapshot.learning.nodes.find((node) => node.id === 'Q0') || snapshot.learning.nodes[0];
      const title = uniqueFileName(compactKnowledgeTitle(rootNode?.question || snapshot.metadata.title), ROOT_ID);
      const now = new Date().toISOString();
      const file = {
        id: uid('file'),
        type: 'file',
        parentId: ROOT_ID,
        name: title,
        text: String(rootNode?.answer || rootNode?.displayedAnswer || rootNode?.question || ''),
        session: snapshot,
        createdAt: now,
        updatedAt: now,
      };
      file.session = normalizeKnowledgeFileSession(file, snapshot, { freezeTyping: true });
      file.session.metadata = {
        ...(file.session.metadata || {}),
        sessionId: makeKnowledgeSessionId(file.id),
        title,
        knowledgeFileId: file.id,
        updatedAt: now,
      };
      file.session.learning.sessionId = file.session.metadata.sessionId;
      store.items.push(file);
      const root = getItem(ROOT_ID);
      if (root) root.children = [...new Set([...(root.children || []), file.id])];
      saveStore();
      getKnowledgeMapController()?.syncStore?.({ focusFolderId: store.currentFolderId || ROOT_ID });
      if (isKnowledgeModule() && (store.currentFolderId || ROOT_ID) === ROOT_ID) {
        enteringItemIds.add(file.id);
        renderList({ source: 'workbench-subtree-save' });
        scheduleClearItemEnter(file.id);
      }
      return clone(file);
    };

    const compactKnowledgeTitle = (value = '') => {
      const normalized = normalizeName(value) || '知识文件';
      return normalized.length > 42 ? `${normalized.slice(0, 42)}…` : normalized;
    };


    const debugCreateFolder = (name = '测试文件夹', parentId = store.currentFolderId || ROOT_ID) => {
      const safeParentId = isFolderId(parentId) ? parentId : ROOT_ID;
      const folder = {
        id: uid('folder'),
        type: 'folder',
        parentId: safeParentId,
        name: normalizeName(name) || uniqueFolderName(safeParentId),
        children: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.items.push(folder);
      saveStore();
      renderList();
      getKnowledgeMapController()?.syncStore?.({ focusFolderId: store.currentFolderId || ROOT_ID });
      return folder;
    };

    const debugCreateFile = (name = '新建文本', text = '') => {
      const parentId = isFolderId(store.currentFolderId) ? store.currentFolderId : ROOT_ID;
      const file = {
        id: uid('file'),
        type: 'file',
        parentId,
        name: normalizeName(name) || '新建文本',
        text: String(text || ''),
        session: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.items.push(file);
      const parent = getItem(parentId);
      if (parent) parent.children = [...new Set([...(parent.children || []), file.id])];
      saveStore();
      renderList();
      getKnowledgeMapController()?.syncStore?.({ focusFolderId: store.currentFolderId || ROOT_ID });
      return file;
    };

    return {
      attachEvents,
      enterKnowledgeModule,
      renderList,
      createFolder,
      openFile,
      togglePanel,
      exitCurrentFile,
      saveActiveFileSession,
      suspendActiveFileSession,
      ensureActiveKnowledgeFileMounted,
      isActiveKnowledgeFileMounted,
      isKnowledgeModule,
      getActiveFileId: () => store.activeFileId,
      getPanelMode,
      syncActionButtons,
      saveLearningSubtreeAsRootFile,
      getLearningRequestContext,
      isLearningRequestContextCurrent,
      markLearningRequestInFlight,
      finishLearningRequestInFlight,
      completeBackgroundLearningRequest,
      failBackgroundLearningRequest,
      getActiveKnowledgeSessionId,
      getAttachmentIds: () => window.AttachmentReferences?.toArray?.(collectKnowledgeAttachmentIds()) || [...collectKnowledgeAttachmentIds()],
      debugCreateFile,
      debugCreateFolder,
      debugDeleteItem: deleteKnowledgeItem,
      debugStartRenameFolder: startRenameFolder,
      debugStartRenameFile: startRenameFile,
      debugStartRenameItem: startRenameItem,
      debugToggleDeleteMode: () => { isDeleteMode = !isDeleteMode; syncDeleteModeUi(); renderList(); return isDeleteMode; },
      debugGoUpFolder: goUpFolder,
      debugEnterFolder: enterFolder,
      debugFolderTree: () => clone(getFolderTree()),
      debugCurrentFolderId: () => store.currentFolderId,
      debugKnowledgeMapLayout: () => clone(getKnowledgeMapController()?.ensureLayout?.() || store.graphLayout || null),
      debugKnowledgeSearch: () => ({
        query: getKnowledgeSearchController()?.getQuery?.() || '',
        matches: getKnowledgeSearchController()?.getMatches?.() || [],
      }),
      debugMoveItemsToFolder: moveKnowledgeItemsToFolder,
      debugDeleteItemsFromMap: deleteKnowledgeItemsFromMap,
      debugSuspendedWorkbenchSnapshot: () => clone(suspendedWorkbenchSnapshot),
      debug: () => clone(store),
    };
  };

  window.KnowledgeWarehouse = {
    createKnowledgeWarehouseController,
  };
}());
