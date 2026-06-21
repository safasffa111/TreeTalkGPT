// Central app state dispatcher.
//
// This module is the single place for cross-module runtime state snapshots.
// It is being migrated from a passive observer into a real command dispatcher:
// - old controllers may still read the legacy stackState object;
// - new writes should go through AppStore actions/helpers first;
// - AppStore mirrors every learning-tree mutation into learningData so renderers
//   can be migrated to store selectors gradually without a big rewrite.
(function () {
  const Slice = Object.freeze({
    LEARNING: 'learning',
    LEARNING_DATA: 'learningData',
    UI: 'ui',
    API: 'api',
    ANIMATION: 'animation',
    SETTINGS: 'settings',
    ERRORS: 'errors',
  });

  const Action = Object.freeze({
    SET_SLICE: 'store/set-slice',
    PATCH: 'store/patch',
    BATCH: 'store/batch',
    SYNC_FROM_SHELL: 'store/sync-from-shell',
    RESET_ALL: 'store/reset-all',

    UI_SYNC: 'ui/sync',
    UI_SWITCH_MODULE: 'ui/switch-module',
    UI_SET_ASSIST: 'ui/set-assist',
    UI_SET_FLAGS: 'ui/set-flags',
    UI_SET_WORKBENCH_PANEL: 'ui/set-workbench-panel',
    UI_GRAPH_CHANGED: 'ui/graph-changed',
    UI_GRAPH_RESET: 'ui/graph-reset',

    LEARNING_SYNC: 'learning/sync',
    LEARNING_DATA_SYNC: 'learning-data/sync',
    LEARNING_NODE_CREATED: 'learning/node-created',
    LEARNING_NODE_PATCHED: 'learning/node-patched',
    LEARNING_MESSAGE_ADDED: 'learning/message-added',
    LEARNING_REQUESTING_CHANGED: 'learning/requesting-changed',
    LEARNING_ACTIVE_CHANGED: 'learning/active-changed',
    LEARNING_NODE_POPPED: 'learning/node-popped',
    LEARNING_SELECTION_CHANGED: 'learning/selection-changed',
    LEARNING_SELECTION_CLEARED: 'learning/selection-cleared',
    LEARNING_ATTACHMENTS_CHANGED: 'learning/attachments-changed',
    LEARNING_RICH_CONTEXT_CHANGED: 'learning/rich-context-changed',
    LEARNING_TREE_RESET: 'learning/tree-reset',
    LEARNING_REQUEST_STARTED: 'learning/request-started',
    LEARNING_REQUEST_SETTLED: 'learning/request-settled',
    LEARNING_RESET_STARTED: 'learning/reset-started',
    LEARNING_RESET_COMPLETED: 'learning/reset-completed',
    LEARNING_SESSION_RESTORED: 'learning/session-restored',

    API_SYNC: 'api/sync',
    API_ACTIVE_PROVIDER_CHANGED: 'api/active-provider-changed',

    ANIMATION_SYNC: 'animation/sync',
    ANIMATION_SET: 'animation/set',
    ANIMATION_START: 'animation/start',
    ANIMATION_FINISH: 'animation/finish',

    SETTINGS_SYNC: 'settings/sync',
    SETTINGS_OPEN_ROOT: 'settings/open-root',
    SETTINGS_OPEN_GROUP: 'settings/open-group',
    SETTINGS_SELECT_DETAIL: 'settings/select-detail',
    SETTINGS_CLEAR_SELECTION: 'settings/clear-selection',
    SETTINGS_PROMPT_EDITING: 'settings/prompt-editing',

    ERRORS_SYNC: 'errors/sync',
    ERRORS_LOG_ADDED: 'errors/log-added',
    ERRORS_SELECT: 'errors/select',
    ERRORS_CLEAR_SELECTION: 'errors/clear-selection',
  });

  const createDefaultLearningData = () => ({
    sessionId: '',
    hasMainQuestion: false,
    activeQuestionId: null,
    nodeOrder: [],
    nodesById: {},
    questionStack: [],
    messages: [],
    activeSelection: null,
    selectedAttachments: [],
    richContextMode: false,
    nextQuestionIndex: 0,
    lastMutation: 'init',
    lastMutationAt: Date.now(),
  });

  const createDefaultGraphViewportState = () => ({
    scale: 1,
    x: 18,
    y: 18,
    positions: {},
    manualPositions: {},
  });

  const createDefaultRenderRevisions = () => ({
    content: 0,
    tree: 0,
    graph: 0,
    prompt: 0,
  });

  const createDefaultState = () => ({
    version: 0,
    updatedAt: Date.now(),
    renderRevisions: createDefaultRenderRevisions(),
    learning: {
      phase: 'empty',
      previousPhase: '',
      lastEvent: 'init',
      activeQuestionId: null,
      stackTopId: null,
      rootQuestionId: null,
      rootStackStatus: '',
      hasMainQuestion: false,
      nodeCount: 0,
      stackSize: 0,
      isRequesting: false,
      canSendPrompt: false,
      canCreateMainQuestion: true,
      canCreateFollowUpQuestion: false,
      canPopActiveNode: false,
      canResetMainQuestionTree: false,
      isBlocking: false,
      lastChangedAt: Date.now(),
    },
    learningData: createDefaultLearningData(),
    ui: {
      module: 'none',
      assist: 'normal',
      workbenchOpen: false,
      settingsOpen: false,
      errorlogsOpen: false,
      settingsSection: 'root',
      settingsGroup: '',
      settingsDetail: '',
      canResetMain: false,
      canPopActive: false,
      workbenchPanel: 'history',
      graph: createDefaultGraphViewportState(),
    },
    api: {
      activeProvider: '',
      activeProviderName: '',
      activeProviderConfigured: false,
      providersConfigured: {},
    },
    animation: {
      moduleTransition: '',
      settingsContentTransition: '',
      errorlogsContentTransition: '',
      resettingTree: false,
      activeQueue: '',
      lastAnimation: '',
    },
    settings: {
      selectedSection: 'root',
      selectedGroup: '',
      selectedDetail: '',
      promptEditing: false,
      promptEditDetail: '',
    },
    errors: {
      count: 0,
      selectedId: '',
      latestId: '',
      latestMessage: '',
    },
  });

  const isPlainObject = (value) => Boolean(
    value && typeof value === 'object' && !Array.isArray(value)
  );

  const clone = (value) => {
    if (value === undefined || value === null || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_) {}
    }
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };

  const shallowEqual = (a = {}, b = {}) => {
    const aKeys = Object.keys(a || {});
    const bKeys = Object.keys(b || {});
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => Object.is(a?.[key], b?.[key]));
  };

  const normalizeSelectionComparable = (selection) => {
    if (!selection) return null;
    return {
      parentId: selection.parentId || '',
      sourceKind: selection.sourceKind || '',
      selectedText: String(selection.selectedText || ''),
      start: Number(selection.start ?? -1),
      end: Number(selection.end ?? -1),
      renderStart: Number(selection.selectionRenderRange?.start ?? selection.renderStart ?? -1),
      renderEnd: Number(selection.selectionRenderRange?.end ?? selection.renderEnd ?? -1),
    };
  };

  const selectionEqual = (a, b) => shallowEqual(
    normalizeSelectionComparable(a),
    normalizeSelectionComparable(b)
  );

  const normalizePatch = (patch) => (isPlainObject(patch) ? patch : {});

  const diffObject = (previous = {}, next = {}) => {
    const diff = {};
    const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
    keys.forEach((key) => {
      if (!Object.is(previous?.[key], next?.[key])) {
        diff[key] = { before: previous?.[key], after: next?.[key] };
      }
    });
    return diff;
  };

  const readShellSnapshot = (shell) => {
    if (!shell) return {};
    const module = shell.dataset.module || 'none';
    const settingsSection = shell.dataset.settingsSection || 'root';
    const settingsGroup = shell.dataset.settingsGroup || '';
    const settingsDetail = shell.dataset.settingsDetail || '';

    return {
      ui: {
        module,
        assist: shell.dataset.assist || 'normal',
        workbenchOpen: module === 'workbench' && shell.dataset.workbench === 'open',
        settingsOpen: module === 'settings',
        errorlogsOpen: module === 'errorlogs',
        settingsSection,
        settingsGroup,
        settingsDetail,
        canResetMain: shell.dataset.canResetMain === 'true',
        canPopActive: shell.dataset.canPopActive === 'true',
        workbenchPanel: shell.dataset.workbenchPanel || 'history',
      },
      animation: {
        moduleTransition: shell.dataset.moduleTransition || '',
        settingsContentTransition: shell.dataset.settingsContentTransition || '',
        errorlogsContentTransition: shell.dataset.errorlogsContentTransition || '',
        resettingTree: shell.dataset.resettingTree === 'true',
      },
      settings: {
        selectedSection: settingsSection,
        selectedGroup: settingsGroup,
        selectedDetail: settingsDetail,
      },
      api: {
        activeProvider: shell.dataset.apiProvider || '',
      },
    };
  };

  const computeProviderConfiguredMap = (apiSettings = {}) => {
    const providers = apiSettings.providers || {};
    return Object.fromEntries(
      Object.entries(providers).map(([provider, config]) => [
        provider,
        Boolean(config?.apiKey && config?.baseUrl && config?.model),
      ])
    );
  };

  const createUiPatchForModule = (state, action = {}) => {
    const module = action.module || action.payload?.module || 'none';
    const options = action.options || action.payload?.options || {};
    const settingsSection = options.settingsSection ?? state.ui.settingsSection ?? 'root';
    const settingsGroup = options.settingsGroup ?? state.ui.settingsGroup ?? '';
    const settingsDetail = options.settingsDetail ?? state.ui.settingsDetail ?? '';
    return {
      module,
      workbenchOpen: module === 'workbench' && options.workbenchOpen !== false,
      settingsOpen: module === 'settings',
      errorlogsOpen: module === 'errorlogs',
      settingsSection: module === 'settings' ? settingsSection : state.ui.settingsSection,
      settingsGroup: module === 'settings' ? settingsGroup : state.ui.settingsGroup,
      settingsDetail: module === 'settings' ? settingsDetail : state.ui.settingsDetail,
    };
  };

  const createSettingsSelectionPatch = (state, action = {}) => {
    const group = action.group || action.payload?.group || '';
    const detail = action.detail || action.payload?.detail || '';
    switch (action.type) {
      case Action.SETTINGS_OPEN_ROOT:
      case Action.SETTINGS_CLEAR_SELECTION:
        return {
          selectedSection: 'root',
          selectedGroup: '',
          selectedDetail: '',
          promptEditing: false,
          promptEditDetail: '',
        };
      case Action.SETTINGS_OPEN_GROUP:
        return {
          selectedSection: group,
          selectedGroup: group,
          selectedDetail: '',
          promptEditing: false,
          promptEditDetail: '',
        };
      case Action.SETTINGS_SELECT_DETAIL: {
        const nextGroup = group || state.settings.selectedGroup || '';
        return {
          selectedSection: nextGroup,
          selectedGroup: nextGroup,
          selectedDetail: detail,
          promptEditing: false,
          promptEditDetail: '',
        };
      }
      case Action.SETTINGS_PROMPT_EDITING:
        return {
          promptEditing: Boolean(action.editing ?? action.payload?.editing),
          promptEditDetail: action.detail || action.payload?.detail || state.settings.promptEditDetail || '',
        };
      default:
        return {};
    }
  };

  const normalizeLegacyStackShape = (legacyState) => {
    if (!legacyState) return null;
    if (!Array.isArray(legacyState.nodes)) legacyState.nodes = [];
    if (!Array.isArray(legacyState.questionStack)) legacyState.questionStack = [];
    if (!Array.isArray(legacyState.messages)) legacyState.messages = [];
    if (!Array.isArray(legacyState.selectedAttachments)) legacyState.selectedAttachments = [];
    if (typeof legacyState.nextQuestionIndex !== 'number') legacyState.nextQuestionIndex = 0;
    if (typeof legacyState.hasMainQuestion !== 'boolean') legacyState.hasMainQuestion = Boolean(legacyState.nodes.length);
    if (typeof legacyState.isRequesting !== 'boolean') legacyState.isRequesting = false;
    return legacyState;
  };

  const findLegacyNode = (legacyState, id) => {
    if (!id) return null;
    return (legacyState?.nodes || []).find((node) => node.id === id) || null;
  };

  const normalizeLegacyQuestionStack = (legacyState) => {
    if (!legacyState) return [];
    normalizeLegacyStackShape(legacyState);
    legacyState.questionStack = (legacyState.questionStack || []).filter((id) => {
      const node = findLegacyNode(legacyState, id);
      return Boolean(node && node.stackStatus !== 'done');
    });
    return legacyState.questionStack;
  };

  const getLegacyStackTopId = (legacyState) => {
    const stack = normalizeLegacyQuestionStack(legacyState);
    return stack.length ? stack[stack.length - 1] : null;
  };

  const getLegacyRootNode = (legacyState) => {
    return (legacyState?.nodes || []).find((node) => !node.parentId) || null;
  };

  const buildLearningDataFromStack = (legacyState, mutation = 'sync') => {
    const safeState = normalizeLegacyStackShape(legacyState);
    const data = createDefaultLearningData();
    if (!safeState) return data;

    const nodesById = {};
    const nodeOrder = [];
    (safeState.nodes || []).forEach((node) => {
      if (!node?.id) return;
      nodeOrder.push(node.id);
      nodesById[node.id] = clone(node);
    });

    return {
      sessionId: String(safeState.sessionId || ''),
      hasMainQuestion: Boolean(safeState.hasMainQuestion),
      activeQuestionId: safeState.activeQuestionId ?? null,
      nodeOrder,
      nodesById,
      questionStack: [...(safeState.questionStack || [])],
      messages: clone(safeState.messages || []),
      activeSelection: clone(safeState.activeSelection ?? null),
      selectedAttachments: clone(safeState.selectedAttachments || []),
      richContextMode: Boolean(safeState.richContextMode),
      nextQuestionIndex: Number(safeState.nextQuestionIndex || 0),
      lastMutation: mutation,
      lastMutationAt: Date.now(),
    };
  };

  const buildLearningSummaryFromStack = (legacyState) => {
    const safeState = normalizeLegacyStackShape(legacyState);
    const root = getLegacyRootNode(safeState);
    return {
      activeQuestionId: safeState?.activeQuestionId ?? null,
      stackTopId: getLegacyStackTopId(safeState),
      rootQuestionId: root?.id || null,
      rootStackStatus: root?.stackStatus || '',
      hasMainQuestion: Boolean(safeState?.hasMainQuestion),
      nodeCount: Number(safeState?.nodes?.length || 0),
      stackSize: Number(safeState?.questionStack?.length || 0),
      isRequesting: Boolean(safeState?.isRequesting),
      lastChangedAt: Date.now(),
    };
  };


  const stableStringify = (value) => {
    const seen = new WeakSet();
    const normalize = (item) => {
      if (item === null || item === undefined) return item;
      if (typeof item !== 'object') return item;
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
      if (Array.isArray(item)) return item.map(normalize);
      return Object.keys(item).sort().reduce((acc, key) => {
        acc[key] = normalize(item[key]);
        return acc;
      }, {});
    };
    try { return JSON.stringify(normalize(value)); } catch (_) { return String(value); }
  };

  const getRenderRevision = (targetState, key) => Number(targetState.renderRevisions?.[key] || 0);

  const createLearningContentRenderKey = (targetState) => {
    const data = targetState.learningData || createDefaultLearningData();
    return `content:${getRenderRevision(targetState, 'content')}:${data.sessionId || ''}:${data.activeQuestionId || ''}`;
  };

  const createLearningTreeRenderKey = (targetState) => {
    const data = targetState.learningData || createDefaultLearningData();
    return `tree:${getRenderRevision(targetState, 'tree')}:${data.sessionId || ''}:${data.activeQuestionId || ''}:${targetState.learning?.stackTopId || ''}`;
  };

  const createLearningGraphRenderKey = (targetState) => {
    const data = targetState.learningData || createDefaultLearningData();
    return `graph:${getRenderRevision(targetState, 'graph')}:${data.sessionId || ''}:${data.activeQuestionId || ''}:${targetState.learning?.stackTopId || ''}`;
  };

  const createPromptUiRenderKey = (targetState) => {
    const data = targetState.learningData || createDefaultLearningData();
    return `prompt:${getRenderRevision(targetState, 'prompt')}:${data.sessionId || ''}:${data.activeQuestionId || ''}`;
  };

  const createSelectors = () => ({
    module: (state) => state.ui.module,
    isWorkbenchOpen: (state) => Boolean(state.ui.workbenchOpen),
    isSettingsOpen: (state) => Boolean(state.ui.settingsOpen),
    isErrorLogsOpen: (state) => Boolean(state.ui.errorlogsOpen),
    assist: (state) => state.ui.assist,
    workbenchPanel: (state) => state.ui.workbenchPanel || 'history',
    stackPhase: (state) => state.learning.phase,
    isBlocking: (state) => Boolean(state.learning.isBlocking || state.animation.resettingTree),
    canSendPrompt: (state) => Boolean(!state.learning.isBlocking && !state.animation.resettingTree),
    canPopActiveNode: (state) => Boolean(state.learning.canPopActiveNode && !state.learning.isBlocking),
    canResetMainQuestionTree: (state) => Boolean(state.learning.canResetMainQuestionTree && !state.learning.isBlocking),
    learningData: (state) => state.learningData,
    learningContentRenderKey: (state) => createLearningContentRenderKey(state),
    learningTreeRenderKey: (state) => createLearningTreeRenderKey(state),
    learningGraphRenderKey: (state) => createLearningGraphRenderKey(state),
    promptUiRenderKey: (state) => createPromptUiRenderKey(state),
    activeQuestionId: (state) => state.learningData.activeQuestionId,
    activeNode: (state) => state.learningData.nodesById[state.learningData.activeQuestionId] || null,
    stackTopId: (state) => state.learning.stackTopId,
    stackTopNode: (state) => state.learningData.nodesById[state.learning.stackTopId] || null,
    nodesById: (state) => state.learningData.nodesById,
    nodeOrder: (state) => state.learningData.nodeOrder,
    nodes: (state) => state.learningData.nodeOrder
      .map((id) => state.learningData.nodesById[id])
      .filter(Boolean),
    rootNodes: (state) => state.learningData.nodeOrder
      .map((id) => state.learningData.nodesById[id])
      .filter((node) => node && !node.parentId),
    questionStack: (state) => state.learningData.questionStack,
    graphViewport: (state) => state.ui.graph || createDefaultGraphViewportState(),
    settingsSelection: (state) => ({
      section: state.settings.selectedSection,
      group: state.settings.selectedGroup,
      detail: state.settings.selectedDetail,
    }),
    activeApiProvider: (state) => state.api.activeProvider,
    hasActiveApi: (state) => Boolean(state.api.activeProviderConfigured),
    hasMainQuestion: (state) => Boolean(state.learningData.hasMainQuestion),
    activeSelection: (state) => state.learningData.activeSelection || null,
    selectedAttachments: (state) => state.learningData.selectedAttachments || [],
    learningMessages: (state) => state.learningData.messages || [],
    isLearningRequesting: (state) => Boolean(state.learning.isRequesting),
    canCreateMainQuestion: (state) => Boolean(state.learning.canCreateMainQuestion),
    canCreateFollowUpQuestion: (state) => Boolean(state.learning.canCreateFollowUpQuestion),
    errorCount: (state) => state.errors.count,
    selectedErrorId: (state) => state.errors.selectedId,
  });

  const createAppStore = ({ shell = null, stackState = null, providerDefaults = {}, observeShell = true } = {}) => {
    let state = createDefaultState();
    const subscribers = new Set();
    const selectorSubscribers = new Set();
    const history = [];
    const selectors = createSelectors();
    let observer = null;
    let queuedShellSync = false;
    let isBatching = false;
    let batchedChanges = [];

    const contentNodeFields = new Set([
      'question', 'status', 'answer', 'displayedAnswer', 'isTyping', 'answerMeta',
      'systemMessage', 'errorMessage', 'loadingText', 'loadingMeta', 'parentTextContext',
      'selectedTextContext', 'selectedPositionContext', 'selectionSourceKind',
      'selectionRange', 'selectionRenderRange', 'attachments', 'annotations',
    ]);
    const structureNodeFields = new Set(['parentId', 'question', 'status', 'stackStatus', 'children']);

    const bumpRenderRevisions = (action = {}, changes = []) => {
      const changedSlices = new Set((changes || []).map((change) => change.slice));
      if (!changedSlices.has(Slice.LEARNING_DATA) && !changedSlices.has(Slice.LEARNING)) return;
      const source = String(action.meta?.source || '');
      const flags = { content: false, tree: false, graph: false, prompt: false };
      const markAll = () => {
        flags.content = true;
        flags.tree = true;
        flags.graph = true;
        flags.prompt = true;
      };

      switch (action.type) {
        case Action.LEARNING_NODE_PATCHED: {
          if (source.startsWith('answer-typewriter:')) break;
          const payload = action.payload || {};
          const patch = normalizePatch(action.patch || payload.patch || payload);
          const keys = Object.keys(patch);
          const nodeId = action.nodeId || payload.nodeId || payload.id || action.id || '';
          if (nodeId === state.learningData?.activeQuestionId && keys.some((key) => contentNodeFields.has(key))) {
            flags.content = true;
          }
          if (keys.some((key) => structureNodeFields.has(key))) {
            flags.tree = true;
            flags.graph = true;
          }
          if (keys.some((key) => ['status', 'stackStatus', 'isTyping'].includes(key))) flags.prompt = true;
          break;
        }
        case Action.LEARNING_NODE_CREATED:
        case Action.LEARNING_ACTIVE_CHANGED:
        case Action.LEARNING_NODE_POPPED:
        case Action.LEARNING_TREE_RESET:
        case Action.LEARNING_SESSION_RESTORED:
        case Action.LEARNING_RESET_COMPLETED:
          markAll();
          break;
        case Action.LEARNING_SELECTION_CHANGED:
        case Action.LEARNING_SELECTION_CLEARED:
        case Action.LEARNING_ATTACHMENTS_CHANGED:
        case Action.LEARNING_RICH_CONTEXT_CHANGED:
        case Action.LEARNING_REQUESTING_CHANGED:
        case Action.LEARNING_REQUEST_STARTED:
        case Action.LEARNING_REQUEST_SETTLED:
        case Action.LEARNING_RESET_STARTED:
          flags.prompt = true;
          break;
        case Action.LEARNING_MESSAGE_ADDED:
          break;
        case Action.BATCH:
          if (changedSlices.has(Slice.LEARNING_DATA)) markAll();
          else flags.prompt = true;
          break;
        default:
          if (changedSlices.has(Slice.LEARNING_DATA)) markAll();
          else if (changedSlices.has(Slice.LEARNING)) flags.prompt = true;
      }

      if (!Object.values(flags).some(Boolean)) return;
      const current = state.renderRevisions || createDefaultRenderRevisions();
      const next = { ...current };
      Object.entries(flags).forEach(([key, changed]) => {
        if (changed) next[key] = Number(current[key] || 0) + 1;
      });
      state = { ...state, renderRevisions: next };
    };

    const pushHistory = (action, changes) => {
      if (!changes.length) return;
      if (action?.meta?.source === 'answer-typewriter:tick') return;
      history.unshift({
        type: action?.type || 'unknown',
        slice: action?.slice || changes.map((change) => change.slice).join(','),
        meta: action?.meta || {},
        changes: changes.map((change) => ({
          slice: change.slice,
          diff: diffObject(change.previous, change.next),
        })),
        at: state.updatedAt,
        version: state.version,
      });
      if (history.length > 160) history.length = 160;
    };

    const notifySelectorSubscribers = (nextState, action) => {
      selectorSubscribers.forEach((record) => {
        try {
          const nextValue = record.selector(nextState);
          if (!record.equals(record.value, nextValue)) {
            const previousValue = record.value;
            // Keep the selected value reference. Slices are immutable, so a new
            // reference means a real selected-state change; unrelated actions keep
            // the same selected object reference and should not notify.
            record.value = nextValue;
            record.listener(nextValue, previousValue, nextState, action);
          }
        } catch (error) {
          try { console.warn?.('AppStore selector subscriber failed', error); } catch (_) {}
        }
      });
    };

    const emit = (action, changes = []) => {
      if (!changes.length) return;
      bumpRenderRevisions(action, changes);
      state.version += 1;
      state.updatedAt = Date.now();
      pushHistory(action, changes);
      const currentState = getState();
      subscribers.forEach((listener) => {
        try {
          listener(currentState, action, changes);
        } catch (error) {
          try { console.warn?.('AppStore subscriber failed', error); } catch (_) {}
        }
      });
      notifySelectorSubscribers(currentState, action);
    };

    const queueOrEmit = (action, changes) => {
      if (!changes.length) return;
      if (isBatching) {
        batchedChanges.push(...changes.map((change) => ({ ...change, action })));
        return;
      }
      emit(action, changes);
    };

    const applySlicePatch = (slice, patch, action) => {
      if (!slice || !Object.prototype.hasOwnProperty.call(state, slice)) return false;
      const nextPatch = normalizePatch(patch);
      if (!Object.keys(nextPatch).length) return false;
      const previous = state[slice] || {};
      const next = { ...previous, ...nextPatch };
      if (shallowEqual(previous, next)) return false;
      state = { ...state, [slice]: next };
      queueOrEmit(action || { type: Action.SET_SLICE, slice, patch: nextPatch }, [{ slice, previous, next }]);
      return true;
    };

    const applyPatchMap = (patchMap = {}, action) => {
      const localChanges = [];
      Object.entries(patchMap).forEach(([slice, patch]) => {
        if (!Object.prototype.hasOwnProperty.call(state, slice)) return;
        const nextPatch = normalizePatch(patch);
        if (!Object.keys(nextPatch).length) return;
        const previous = state[slice] || {};
        const next = { ...previous, ...nextPatch };
        if (shallowEqual(previous, next)) return;
        state = { ...state, [slice]: next };
        localChanges.push({ slice, previous, next });
      });
      queueOrEmit(action || { type: Action.PATCH }, localChanges);
      return localChanges.length > 0;
    };

    const syncLearningSlicesFromLegacy = (action, learningPatch = {}) => {
      if (!stackState) return false;
      const mutation = action?.type || action?.meta?.source || 'sync';
      return applyPatchMap({
        learningData: buildLearningDataFromStack(stackState, mutation),
        learning: {
          ...buildLearningSummaryFromStack(stackState),
          ...learningPatch,
        },
      }, action);
    };

    const createLegacyLearningNode = (action = {}) => {
      if (!stackState) return null;
      normalizeLegacyStackShape(stackState);
      const payload = action.payload || {};
      const question = String(action.question ?? payload.question ?? '').trim();
      const parentId = action.parentId ?? payload.parentId ?? null;
      const options = action.options || payload.options || {};
      const id = `Q${stackState.nextQuestionIndex}`;
      stackState.nextQuestionIndex += 1;

      const node = {
        id,
        parentId,
        question,
        status: 'pending',
        stackStatus: 'active',
        answer: '',
        answerMeta: '',
        systemMessage: '',
        errorMessage: '',
        loadingText: '',
        loadingMeta: '',
        parentTextContext: options.parentTextContext || '',
        selectedTextContext: options.selectedTextContext || '',
        selectedPositionContext: options.selectedPositionContext || '',
        selectionSourceKind: options.selectionSourceKind || '',
        selectionRange: options.selectionRange || null,
        selectionRenderRange: options.selectionRenderRange || null,
        selectionLocator: options.selectionLocator || null,
        attachments: clone(options.attachments || []),
        annotations: [],
        children: [],
      };

      stackState.nodes.push(node);
      if (parentId) {
        const parent = findLegacyNode(stackState, parentId);
        if (parent) {
          parent.children = Array.isArray(parent.children) ? parent.children : [];
          parent.children.push(id);

          const selectionStart = Number(options.selectionRange?.start);
          const selectionEnd = Number(options.selectionRange?.end);
          const hasStableSelectionRange = Number.isFinite(selectionStart) && Number.isFinite(selectionEnd) && selectionStart >= 0 && selectionEnd > selectionStart;
          if (hasStableSelectionRange && options.selectionSourceKind) {
            parent.annotations = Array.isArray(parent.annotations) ? parent.annotations : [];
            const renderStart = Number(options.selectionRenderRange?.start);
            const renderEnd = Number(options.selectionRenderRange?.end);
            parent.annotations.push({
              childId: id,
              sourceKind: options.selectionSourceKind,
              start: selectionStart,
              end: selectionEnd,
              renderStart: Number.isFinite(renderStart) ? renderStart : -1,
              renderEnd: Number.isFinite(renderEnd) ? renderEnd : -1,
              selectedText: options.selectedTextContext || '',
            });
          }
        }
      }

      stackState.activeQuestionId = id;
      stackState.questionStack.push(id);
      stackState.hasMainQuestion = true;
      stackState.messages.push({ role: 'user', questionId: id, content: question });
      action.resultId = id;
      action.resultNode = node;
      syncLearningSlicesFromLegacy(action, {
        lastEvent: parentId ? 'follow-up-created' : 'main-created',
        canCreateMainQuestion: false,
        canCreateFollowUpQuestion: true,
      });
      return node;
    };

    const patchLegacyLearningNode = (action = {}) => {
      if (!stackState) return null;
      const payload = action.payload || {};
      const nodeId = action.nodeId || payload.nodeId || payload.id || action.id;
      const patch = normalizePatch(action.patch || payload.patch || payload);
      const node = findLegacyNode(stackState, nodeId);
      if (!node) return null;
      Object.assign(node, patch);
      action.resultNode = node;
      if (String(action.meta?.source || '').startsWith('answer-typewriter:')) {
        const previousData = state.learningData || createDefaultLearningData();
        const previousNode = previousData.nodesById?.[nodeId] || {};
        applySlicePatch(Slice.LEARNING_DATA, {
          nodesById: {
            ...(previousData.nodesById || {}),
            [nodeId]: { ...previousNode, ...clone(patch) },
          },
          lastMutation: action.meta.source,
          lastMutationAt: Date.now(),
        }, action);
        return node;
      }
      syncLearningSlicesFromLegacy(action, {
        lastEvent: action.event || payload.event || 'node-patched',
      });
      return node;
    };

    const addLegacyLearningMessage = (action = {}) => {
      if (!stackState) return null;
      normalizeLegacyStackShape(stackState);
      const message = action.message || action.payload?.message || {
        role: action.role || action.payload?.role,
        questionId: action.questionId || action.payload?.questionId,
        content: action.content || action.payload?.content,
      };
      if (!message?.role) return null;
      stackState.messages.push(clone(message));
      action.resultMessage = message;
      syncLearningSlicesFromLegacy(action, { lastEvent: 'message-added' });
      return message;
    };

    const setLegacyLearningRequesting = (action = {}) => {
      if (!stackState) return false;
      normalizeLegacyStackShape(stackState);
      const requesting = Boolean(action.requesting ?? action.payload?.requesting);
      stackState.isRequesting = requesting;
      syncLearningSlicesFromLegacy(action, {
        isRequesting: requesting,
        isBlocking: requesting,
        lastEvent: requesting ? 'request-started' : 'request-settled',
      });
      return true;
    };

    const setLegacyActiveQuestion = (action = {}) => {
      if (!stackState) return false;
      const nodeId = action.nodeId || action.payload?.nodeId || action.id || null;
      if (nodeId && !findLegacyNode(stackState, nodeId)) return false;
      stackState.activeQuestionId = nodeId;
      syncLearningSlicesFromLegacy(action, { lastEvent: 'active-node-changed' });
      return true;
    };

    const setLegacySelection = (action = {}) => {
      if (!stackState) return false;
      const selection = action.selection ?? action.payload?.selection ?? null;
      if (selectionEqual(stackState.activeSelection, selection)) return false;
      stackState.activeSelection = clone(selection);
      syncLearningSlicesFromLegacy(action, { lastEvent: selection ? 'selection-changed' : 'selection-cleared' });
      return true;
    };

    const clearLegacySelection = (action = {}) => {
      if (!stackState) return false;
      if (!stackState.activeSelection) return false;
      stackState.activeSelection = null;
      syncLearningSlicesFromLegacy(action, { lastEvent: 'selection-cleared' });
      return true;
    };

    const setLegacyAttachments = (action = {}) => {
      if (!stackState) return false;
      const attachments = action.attachments ?? action.payload?.attachments ?? [];
      const nextAttachments = clone(Array.isArray(attachments) ? attachments : []);
      if (stableStringify(stackState.selectedAttachments || []) === stableStringify(nextAttachments)) return false;
      stackState.selectedAttachments = nextAttachments;
      syncLearningSlicesFromLegacy(action, { lastEvent: 'attachments-changed' });
      return true;
    };

    const setLegacyRichContextMode = (action = {}) => {
      if (!stackState) return false;
      const nextEnabled = Boolean(action.enabled ?? action.payload?.enabled);
      if (Boolean(stackState.richContextMode) === nextEnabled) return false;
      stackState.richContextMode = nextEnabled;
      syncLearningSlicesFromLegacy(action, { lastEvent: 'rich-context-changed' });
      return true;
    };

    const popLegacyActiveNode = (action = {}) => {
      if (!stackState) return null;
      normalizeLegacyStackShape(stackState);
      const topId = getLegacyStackTopId(stackState);
      if (!topId || topId !== stackState.activeQuestionId) {
        action.result = { poppedId: null, nextActiveId: stackState.activeQuestionId ?? null };
        syncLearningSlicesFromLegacy(action, { lastEvent: 'node-pop-blocked' });
        return action.result;
      }

      const poppedId = stackState.questionStack.pop();
      const poppedNode = findLegacyNode(stackState, poppedId);
      if (poppedNode) {
        poppedNode.stackStatus = 'done';
        poppedNode.completedAt = Date.now();
      }

      normalizeLegacyQuestionStack(stackState);
      const nextTopId = getLegacyStackTopId(stackState);
      const keepCompletedVisible = action.keepCompletedVisible ?? action.payload?.keepCompletedVisible ?? true;
      stackState.activeQuestionId = nextTopId || (keepCompletedVisible && poppedNode ? poppedNode.id : null);
      action.result = { poppedId, nextActiveId: stackState.activeQuestionId, poppedNode };
      syncLearningSlicesFromLegacy(action, { lastEvent: 'node-popped' });
      return action.result;
    };

    const resetLegacyLearningTree = (action = {}) => {
      if (!stackState) return false;
      const payload = action.payload || {};
      stackState.sessionId = '';
      stackState.hasMainQuestion = false;
      stackState.activeQuestionId = null;
      stackState.nodes = [];
      stackState.questionStack = [];
      stackState.messages = [];
      stackState.activeSelection = null;
      stackState.selectedAttachments = [];
      stackState.richContextMode = false;
      stackState.isRequesting = false;
      stackState.nextQuestionIndex = 0;
      if (payload.graph) {
        stackState.graph = clone(payload.graph);
      } else if (window.StackStateUtils?.createGraphState) {
        stackState.graph = window.StackStateUtils.createGraphState();
      } else {
        stackState.graph = createDefaultGraphViewportState();
      }
      applySlicePatch(Slice.UI, { graph: clone(stackState.graph) }, action);
      syncLearningSlicesFromLegacy(action, {
        ...createDefaultState().learning,
        lastEvent: 'tree-reset',
        lastChangedAt: Date.now(),
      });
      return true;
    };


    const normalizeRestoredNode = (rawNode = {}) => {
      const node = clone(rawNode) || {};
      const restoredAnswer = String(node.answer || '');
      const restoredDisplayed = String(node.displayedAnswer || '');
      const hasAnswer = Boolean(String(restoredAnswer || restoredDisplayed).trim());
      const normalizedAnswer = restoredAnswer || (node.status === 'answered' ? restoredDisplayed : '');
      const normalizedDisplayed = restoredDisplayed || (node.isTyping ? '' : normalizedAnswer);
      const stillTyping = Boolean(
        node.isTyping
        && normalizedAnswer
        && normalizedDisplayed.length < normalizedAnswer.length
      );
      node.id = String(node.id || '');
      node.parentId = node.parentId || null;
      node.question = String(node.question || '');
      node.status = String(node.status || (hasAnswer ? 'answered' : 'pending'));
      node.stackStatus = String(node.stackStatus || 'active');
      node.answer = normalizedAnswer || restoredDisplayed;
      node.displayedAnswer = normalizedDisplayed;
      node.isTyping = stillTyping;
      node.answerMeta = String(node.answerMeta || '');
      node.systemMessage = String(node.systemMessage || '');
      node.errorMessage = String(node.errorMessage || '');
      node.loadingText = node.status === 'requesting' ? String(node.loadingText || '正在思考…') : '';
      node.loadingMeta = node.status === 'requesting' ? String(node.loadingMeta || '') : '';
      node.parentTextContext = String(node.parentTextContext || '');
      node.selectedTextContext = String(node.selectedTextContext || '');
      node.selectedPositionContext = String(node.selectedPositionContext || '');
      node.selectionSourceKind = String(node.selectionSourceKind || '');
      node.selectionRange = node.selectionRange || null;
      node.selectionRenderRange = node.selectionRenderRange || null;
      node.selectionLocator = node.selectionLocator || null;
      node.attachments = Array.isArray(node.attachments) ? clone(node.attachments) : [];
      node.annotations = Array.isArray(node.annotations) ? clone(node.annotations) : [];
      node.children = Array.isArray(node.children) ? [...new Set(node.children.filter(Boolean))] : [];
      if (hasAnswer && (node.status === 'requesting' || node.status === 'pending')) {
        node.status = 'answered';
        node.loadingText = '';
        node.loadingMeta = '';
      }
      return node.id ? node : null;
    };

    const normalizeRestoredGraph = (rawGraph = {}) => {
      const fallback = createDefaultGraphViewportState();
      const graph = isPlainObject(rawGraph) ? rawGraph : {};
      return {
        ...fallback,
        ...clone(graph),
        scale: Number.isFinite(Number(graph.scale)) ? Number(graph.scale) : fallback.scale,
        x: Number.isFinite(Number(graph.x)) ? Number(graph.x) : fallback.x,
        y: Number.isFinite(Number(graph.y)) ? Number(graph.y) : fallback.y,
        positions: isPlainObject(graph.positions) ? clone(graph.positions) : {},
        manualPositions: isPlainObject(graph.manualPositions) ? clone(graph.manualPositions) : {},
      };
    };

    const inferNextQuestionIndex = (nodes = []) => {
      const maxIndex = nodes.reduce((max, node) => {
        const match = String(node?.id || '').match(/^Q(\d+)$/);
        if (!match) return max;
        return Math.max(max, Number(match[1]));
      }, -1);
      return maxIndex + 1;
    };

    const restoreLegacyLearningSession = (action = {}) => {
      if (!stackState) return false;
      const payload = action.payload || action.snapshot || action.session || {};
      const learning = payload.learning || payload.learningData || payload.data?.learning || {};
      const rawNodes = Array.isArray(learning.nodes)
        ? learning.nodes
        : (Array.isArray(learning.nodeOrder)
          ? learning.nodeOrder.map((id) => learning.nodesById?.[id]).filter(Boolean)
          : []);
      const nodes = rawNodes.map(normalizeRestoredNode).filter(Boolean);
      const nodeIds = new Set(nodes.map((node) => node.id));

      nodes.forEach((node) => {
        node.children = (node.children || []).filter((childId) => nodeIds.has(childId));
      });
      nodes.forEach((node) => {
        if (!node.parentId || !nodeIds.has(node.parentId)) return;
        const parent = nodes.find((candidate) => candidate.id === node.parentId);
        if (parent && !parent.children.includes(node.id)) parent.children.push(node.id);
      });

      const requestedActiveId = learning.activeQuestionId || payload.activeQuestionId || null;
      const activeQuestionId = requestedActiveId && nodeIds.has(requestedActiveId)
        ? requestedActiveId
        : (nodes.find((node) => node.stackStatus !== 'done')?.id || nodes[nodes.length - 1]?.id || null);
      const questionStack = (Array.isArray(learning.questionStack) ? learning.questionStack : [])
        .filter((id) => nodeIds.has(id) && nodes.find((node) => node.id === id)?.stackStatus !== 'done');
      const inferredStack = questionStack.length
        ? questionStack
        : nodes.filter((node) => node.stackStatus !== 'done').map((node) => node.id);
      const selectedAttachments = Array.isArray(learning.selectedAttachments)
        ? clone(learning.selectedAttachments)
        : clone(payload.attachments?.selectedAttachments || []);
      const graph = normalizeRestoredGraph(payload.graph || payload.ui?.graph || learning.graph || {});
      const restoredSessionId = String(payload.metadata?.sessionId || payload.sessionId || learning.sessionId || action.meta?.sessionId || action.meta?.knowledgeFileId || '').trim();

      normalizeLegacyStackShape(stackState);
      stackState.sessionId = restoredSessionId || `runtime-${Date.now()}`;
      stackState.hasMainQuestion = Boolean(learning.hasMainQuestion ?? nodes.length);
      stackState.activeQuestionId = activeQuestionId;
      stackState.nodes = nodes;
      stackState.questionStack = inferredStack;
      stackState.messages = Array.isArray(learning.messages) ? clone(learning.messages) : [];
      stackState.activeSelection = learning.activeSelection ? clone(learning.activeSelection) : null;
      stackState.selectedAttachments = selectedAttachments;
      stackState.richContextMode = Boolean(learning.richContextMode ?? payload.attachments?.richContextMode);
      stackState.isRequesting = false;
      stackState.nextQuestionIndex = Number.isFinite(Number(learning.nextQuestionIndex))
        ? Number(learning.nextQuestionIndex)
        : inferNextQuestionIndex(nodes);
      stackState.graph = graph;

      applySlicePatch(Slice.UI, { graph: clone(graph) }, action);
      syncLearningSlicesFromLegacy(action, {
        ...buildLearningSummaryFromStack(stackState),
        isRequesting: false,
        isBlocking: false,
        lastEvent: 'session-restored',
        canCreateMainQuestion: !nodes.length,
        canCreateFollowUpQuestion: Boolean(nodes.length),
        lastChangedAt: Date.now(),
      });
      return true;
    };

    function dispatch(action = {}) {
      if (Array.isArray(action)) return batch(action, { type: Action.BATCH });
      if (!action || typeof action !== 'object') return getState();

      switch (action.type) {
        case Action.SET_SLICE:
          applySlicePatch(action.slice, action.patch, action);
          break;
        case Action.PATCH:
          applyPatchMap(action.patch || action.payload || {}, action);
          break;
        case Action.BATCH:
          batch(action.actions || [], action);
          break;
        case Action.SYNC_FROM_SHELL:
          applyPatchMap(readShellSnapshot(action.shell || shell), action);
          break;
        case Action.RESET_ALL:
          state = createDefaultState();
          queueOrEmit(action, [{ slice: 'store', previous: {}, next: state }]);
          break;

        case Action.UI_SYNC:
          applySlicePatch(Slice.UI, action.patch || action.payload, action);
          break;
        case Action.UI_SWITCH_MODULE:
          applySlicePatch(Slice.UI, createUiPatchForModule(state, action), action);
          break;
        case Action.UI_SET_ASSIST:
          applySlicePatch(Slice.UI, { assist: action.assist || action.payload?.assist || 'normal' }, action);
          break;
        case Action.UI_SET_FLAGS:
          applySlicePatch(Slice.UI, action.patch || action.payload, action);
          break;
        case Action.UI_SET_WORKBENCH_PANEL:
          applySlicePatch(Slice.UI, { workbenchPanel: action.panel || action.payload?.panel || 'history' }, action);
          break;
        case Action.UI_GRAPH_CHANGED: {
          const patch = clone(normalizePatch(action.patch || action.payload));
          const currentGraph = state.ui.graph || createDefaultGraphViewportState();
          const nextGraph = { ...currentGraph, ...patch };
          if (patch.positions !== undefined) nextGraph.positions = clone(patch.positions || {});
          if (patch.manualPositions !== undefined) nextGraph.manualPositions = clone(patch.manualPositions || {});
          if (stackState) stackState.graph = clone(nextGraph);
          applySlicePatch(Slice.UI, { graph: nextGraph }, action);
          break;
        }
        case Action.UI_GRAPH_RESET: {
          const nextGraph = createDefaultGraphViewportState();
          if (stackState) stackState.graph = clone(nextGraph);
          applySlicePatch(Slice.UI, { graph: nextGraph }, action);
          break;
        }

        case Action.LEARNING_SYNC:
          applySlicePatch(Slice.LEARNING, action.patch || action.payload, action);
          break;
        case Action.LEARNING_DATA_SYNC:
          applySlicePatch(Slice.LEARNING_DATA, action.patch || action.payload, action);
          break;
        case Action.LEARNING_NODE_CREATED:
          createLegacyLearningNode(action);
          break;
        case Action.LEARNING_NODE_PATCHED:
          patchLegacyLearningNode(action);
          break;
        case Action.LEARNING_MESSAGE_ADDED:
          addLegacyLearningMessage(action);
          break;
        case Action.LEARNING_REQUESTING_CHANGED:
          setLegacyLearningRequesting(action);
          break;
        case Action.LEARNING_ACTIVE_CHANGED:
          setLegacyActiveQuestion(action);
          break;
        case Action.LEARNING_NODE_POPPED:
          popLegacyActiveNode(action);
          break;
        case Action.LEARNING_SELECTION_CHANGED:
          setLegacySelection(action);
          break;
        case Action.LEARNING_SELECTION_CLEARED:
          clearLegacySelection(action);
          break;
        case Action.LEARNING_ATTACHMENTS_CHANGED:
          setLegacyAttachments(action);
          break;
        case Action.LEARNING_RICH_CONTEXT_CHANGED:
          setLegacyRichContextMode(action);
          break;
        case Action.LEARNING_TREE_RESET:
          resetLegacyLearningTree(action);
          break;
        case Action.LEARNING_REQUEST_STARTED:
          applySlicePatch(Slice.LEARNING, { isRequesting: true, isBlocking: true, lastEvent: 'request-started' }, action);
          break;
        case Action.LEARNING_REQUEST_SETTLED:
          applySlicePatch(Slice.LEARNING, { isRequesting: false, isBlocking: false, lastEvent: 'request-settled' }, action);
          break;
        case Action.LEARNING_RESET_STARTED:
          applyPatchMap({
            learning: { phase: 'resetting', isBlocking: true, canSendPrompt: false, lastEvent: 'reset-started' },
            animation: { resettingTree: true },
          }, action);
          break;
        case Action.LEARNING_SESSION_RESTORED:
          restoreLegacyLearningSession(action);
          break;
        case Action.LEARNING_RESET_COMPLETED:
          applyPatchMap({
            learning: createDefaultState().learning,
            learningData: createDefaultLearningData(),
            animation: { resettingTree: false },
            ui: { canResetMain: false, canPopActive: false },
          }, action);
          break;

        case Action.API_SYNC:
          applySlicePatch(Slice.API, action.patch || action.payload, action);
          break;
        case Action.API_ACTIVE_PROVIDER_CHANGED:
          applySlicePatch(Slice.API, {
            activeProvider: action.provider || action.payload?.provider || '',
            activeProviderName: action.providerName || action.payload?.providerName || '',
            activeProviderConfigured: Boolean(action.configured ?? action.payload?.configured),
          }, action);
          break;

        case Action.ANIMATION_SYNC:
        case Action.ANIMATION_SET:
          applySlicePatch(Slice.ANIMATION, action.patch || action.payload, action);
          break;
        case Action.ANIMATION_START:
          applySlicePatch(Slice.ANIMATION, {
            [action.name || 'lastAnimation']: action.value || 'running',
            lastAnimation: action.name || '',
            activeQueue: action.queue || state.animation.activeQueue || '',
          }, action);
          break;
        case Action.ANIMATION_FINISH:
          applySlicePatch(Slice.ANIMATION, {
            [action.name || 'lastAnimation']: action.value || '',
            lastAnimation: action.name || '',
            activeQueue: action.queue || '',
          }, action);
          break;

        case Action.SETTINGS_SYNC:
          applySlicePatch(Slice.SETTINGS, action.patch || action.payload, action);
          break;
        case Action.SETTINGS_OPEN_ROOT:
        case Action.SETTINGS_OPEN_GROUP:
        case Action.SETTINGS_SELECT_DETAIL:
        case Action.SETTINGS_CLEAR_SELECTION: {
          const settingsPatch = createSettingsSelectionPatch(state, action);
          const uiPatch = {
            settingsSection: settingsPatch.selectedSection,
            settingsGroup: settingsPatch.selectedGroup,
            settingsDetail: settingsPatch.selectedDetail,
          };
          applyPatchMap({ settings: settingsPatch, ui: uiPatch }, action);
          break;
        }
        case Action.SETTINGS_PROMPT_EDITING:
          applySlicePatch(Slice.SETTINGS, createSettingsSelectionPatch(state, action), action);
          break;

        case Action.ERRORS_SYNC:
          applySlicePatch(Slice.ERRORS, action.patch || action.payload, action);
          break;
        case Action.ERRORS_LOG_ADDED:
          applySlicePatch(Slice.ERRORS, {
            count: Number(action.count ?? state.errors.count + 1),
            latestId: action.id || action.payload?.id || state.errors.latestId,
            latestMessage: action.message || action.payload?.message || state.errors.latestMessage,
          }, action);
          break;
        case Action.ERRORS_SELECT:
          applySlicePatch(Slice.ERRORS, { selectedId: action.id || action.payload?.id || '' }, action);
          break;
        case Action.ERRORS_CLEAR_SELECTION:
          applySlicePatch(Slice.ERRORS, { selectedId: '' }, action);
          break;

        default:
          if (action.slice && action.patch) {
            applySlicePatch(action.slice, action.patch, action);
          } else if (action.patch && isPlainObject(action.patch)) {
            applyPatchMap(action.patch, action);
          }
      }
      return getState();
    }

    function batch(actions = [], metaAction = {}) {
      if (!Array.isArray(actions) || !actions.length) return getState();
      const outerBatching = isBatching;
      isBatching = true;
      try {
        actions.forEach((item) => dispatch(item));
      } finally {
        isBatching = outerBatching;
      }
      if (!isBatching && batchedChanges.length) {
        const grouped = new Map();
        batchedChanges.forEach((entry) => {
          const current = grouped.get(entry.slice);
          if (!current) {
            grouped.set(entry.slice, { slice: entry.slice, previous: entry.previous, next: entry.next });
          } else {
            current.next = entry.next;
          }
        });
        const changes = Array.from(grouped.values()).filter((change) => !shallowEqual(change.previous, change.next));
        batchedChanges = [];
        emit({ type: metaAction.type || Action.BATCH, meta: metaAction.meta || {} }, changes);
      }
      return getState();
    }

    function getState() {
      return state;
    }

    function snapshot() {
      return clone(state);
    }

    function subscribe(listener, options = {}) {
      if (typeof listener !== 'function') return () => {};
      subscribers.add(listener);
      if (options.immediate) {
        listener(getState(), { type: 'store/subscribe-immediate' }, []);
      }
      return () => subscribers.delete(listener);
    }

    function resolveSelector(selector) {
      if (typeof selector === 'function') return selector;
      if (typeof selector === 'string' && selectors[selector]) return selectors[selector];
      if (typeof selector === 'string') {
        return (targetState) => selector.split('.').reduce((cursor, key) => (
          cursor && Object.prototype.hasOwnProperty.call(cursor, key) ? cursor[key] : undefined
        ), targetState);
      }
      return () => undefined;
    }

    function subscribeTo(selector, listener, options = {}) {
      if (typeof listener !== 'function') return () => {};
      const selectorFn = resolveSelector(selector);
      const equals = options.equals || Object.is;
      const initialValue = selectorFn(state);
      const record = {
        selector: selectorFn,
        listener,
        equals,
        // Keep the selector's real value reference instead of a cloned snapshot.
        // Store slices are replaced immutably, so Object.is can correctly tell
        // whether a selected object slice actually changed. Cloning here made
        // object selectors look different on every unrelated store action, which
        // could cause render loops such as graph render -> ui.graph write ->
        // learningData subscriber -> workbench render -> graph render.
        value: initialValue,
      };
      selectorSubscribers.add(record);
      if (options.immediate) {
        listener(initialValue, undefined, getState(), { type: 'store/subscribe-to-immediate' });
      }
      return () => selectorSubscribers.delete(record);
    }

    function select(selector, fallback = undefined) {
      const selectorFn = resolveSelector(selector);
      const value = selectorFn(state);
      return value === undefined ? fallback : value;
    }

    function getLearningNodes() {
      return select('nodes', []);
    }

    function getRootLearningNodes() {
      return select('rootNodes', []);
    }

    function getLearningNode(nodeId) {
      if (!nodeId) return null;
      return state.learningData.nodesById[nodeId] || null;
    }

    function getActiveLearningNode() {
      return getLearningNode(state.learningData.activeQuestionId);
    }

    function getStackTopLearningNode() {
      return getLearningNode(state.learning.stackTopId);
    }

    function getActiveQuestionId() {
      return select('activeQuestionId', null);
    }

    function getStackTopQuestionId() {
      return select('stackTopId', null);
    }

    function getLearningSelection() {
      return select('activeSelection', null);
    }

    function getLearningMessages() {
      return select('learningMessages', []);
    }

    function getLearningContentRenderKey() {
      return select('learningContentRenderKey', '');
    }

    function getLearningTreeRenderKey() {
      return select('learningTreeRenderKey', '');
    }

    function getLearningGraphRenderKey() {
      return select('learningGraphRenderKey', '');
    }

    function getPromptUiRenderKey() {
      return select('promptUiRenderKey', '');
    }

    function hasMainQuestion() {
      return Boolean(select('hasMainQuestion', false));
    }

    function isLearningRequesting() {
      return Boolean(select('isLearningRequesting', false));
    }

    function getGraphViewport() {
      return select('graphViewport', createDefaultGraphViewportState());
    }

    function getLearningNodeDepth(nodeId) {
      let depth = 0;
      let current = getLearningNode(nodeId);
      const guard = new Set();
      while (current?.parentId && !guard.has(current.id)) {
        guard.add(current.id);
        depth += 1;
        current = getLearningNode(current.parentId);
      }
      return depth;
    }

    function waitFor(predicate, { timeout = 3000 } = {}) {
      return new Promise((resolve, reject) => {
        if (typeof predicate !== 'function') {
          reject(new Error('waitFor requires a predicate function'));
          return;
        }
        if (predicate(getState())) {
          resolve(getState());
          return;
        }
        let done = false;
        const startedAt = Date.now();
        const unsubscribe = subscribe((nextState) => {
          if (done) return;
          if (predicate(nextState)) {
            done = true;
            window.clearTimeout?.(timer);
            unsubscribe();
            resolve(nextState);
          }
        });
        const timer = window.setTimeout?.(() => {
          if (done) return;
          done = true;
          unsubscribe();
          reject(new Error('AppStore waitFor timeout'));
        }, Math.max(0, timeout - (Date.now() - startedAt)));
      });
    }

    function setUi(patch, meta = {}) {
      return dispatch({ type: Action.UI_SYNC, patch, meta });
    }

    function setLearning(patch, meta = {}) {
      return dispatch({ type: Action.LEARNING_SYNC, patch, meta });
    }

    function setLearningData(patch, meta = {}) {
      return dispatch({ type: Action.LEARNING_DATA_SYNC, patch, meta });
    }

    function setApi(patch, meta = {}) {
      return dispatch({ type: Action.API_SYNC, patch, meta });
    }

    function setAnimation(patch, meta = {}) {
      return dispatch({ type: Action.ANIMATION_SET, patch, meta });
    }

    function setSettings(patch, meta = {}) {
      return dispatch({ type: Action.SETTINGS_SYNC, patch, meta });
    }

    function setErrors(patch, meta = {}) {
      return dispatch({ type: Action.ERRORS_SYNC, patch, meta });
    }

    function setModule(module, options = {}, meta = {}) {
      return dispatch({ type: Action.UI_SWITCH_MODULE, module, options, meta });
    }

    function setAssist(assist, meta = {}) {
      return dispatch({ type: Action.UI_SET_ASSIST, assist, meta });
    }

    function setWorkbenchPanel(panel = 'history', meta = {}) {
      return dispatch({ type: Action.UI_SET_WORKBENCH_PANEL, panel, meta });
    }

    function setGraphViewport(patch = {}, meta = {}) {
      return dispatch({ type: Action.UI_GRAPH_CHANGED, patch, meta });
    }

    function resetGraphViewport(meta = {}) {
      return dispatch({ type: Action.UI_GRAPH_RESET, meta });
    }

    function setSettingsSelection({ group = '', detail = '', root = false } = {}, meta = {}) {
      if (root) return dispatch({ type: Action.SETTINGS_OPEN_ROOT, meta });
      if (detail) return dispatch({ type: Action.SETTINGS_SELECT_DETAIL, group, detail, meta });
      if (group) return dispatch({ type: Action.SETTINGS_OPEN_GROUP, group, meta });
      return dispatch({ type: Action.SETTINGS_CLEAR_SELECTION, meta });
    }

    function syncFromShell(targetShell = shell) {
      return dispatch({ type: Action.SYNC_FROM_SHELL, shell: targetShell });
    }

    function syncLearningDataFromStack(meta = {}) {
      return dispatch({ type: Action.LEARNING_DATA_SYNC, patch: buildLearningDataFromStack(stackState, meta.source || 'manual-sync'), meta });
    }

    function syncLearningFromMachine(machine, helpers = {}) {
      const data = state.learningData || createDefaultLearningData();
      const nodes = selectors.nodes(state);
      const rootNodes = selectors.rootNodes(state);
      const topId = helpers.getStackTopId?.() ?? state.learning.stackTopId ?? getLegacyStackTopId(stackState);
      const root = helpers.getMainRootNode?.() ?? rootNodes[0] ?? getLegacyRootNode(stackState);
      const lastChangedAt = machine?.snapshot?.().lastChangedAt || Date.now();
      batch([
        {
          type: Action.LEARNING_SYNC,
          patch: {
            phase: machine?.phase || 'empty',
            previousPhase: machine?.previousPhase || '',
            lastEvent: machine?.lastEvent || 'refresh',
            activeQuestionId: data.activeQuestionId ?? stackState?.activeQuestionId ?? null,
            stackTopId: topId,
            rootQuestionId: root?.id || null,
            rootStackStatus: root?.stackStatus || '',
            hasMainQuestion: Boolean(data.hasMainQuestion ?? stackState?.hasMainQuestion),
            nodeCount: Number(nodes.length || stackState?.nodes?.length || 0),
            stackSize: Number(data.questionStack?.length || stackState?.questionStack?.length || 0),
            isRequesting: Boolean(stackState?.isRequesting || state.learning.isRequesting),
            canSendPrompt: Boolean(machine?.canSendPrompt?.(true)),
            canCreateMainQuestion: Boolean(machine?.canCreateMainQuestion?.()),
            canCreateFollowUpQuestion: Boolean(machine?.canCreateFollowUpQuestion?.()),
            canPopActiveNode: Boolean(machine?.canPopActiveNode?.()),
            canResetMainQuestionTree: Boolean(machine?.canResetMainQuestionTree?.()),
            isBlocking: Boolean(machine?.isBlocking?.()),
            lastChangedAt,
          },
          meta: { source: 'learning-state-machine' },
        },
        {
          type: Action.LEARNING_DATA_SYNC,
          patch: buildLearningDataFromStack(stackState, machine?.lastEvent || 'machine-sync'),
          meta: { source: 'learning-state-machine:data' },
        },
      ], { type: Action.BATCH, meta: { source: 'sync-learning-from-machine' } });
      return getState();
    }

    function createLearningNode({ question = '', parentId = null, options = {} } = {}, meta = {}) {
      const action = { type: Action.LEARNING_NODE_CREATED, question, parentId, options, meta };
      dispatch(action);
      return action.resultNode || findLegacyNode(stackState, action.resultId) || null;
    }

    function patchLearningNode(nodeId, patch = {}, meta = {}) {
      const action = { type: Action.LEARNING_NODE_PATCHED, nodeId, patch, meta };
      dispatch(action);
      return action.resultNode || null;
    }

    function addLearningMessage(message = {}, meta = {}) {
      const action = { type: Action.LEARNING_MESSAGE_ADDED, message, meta };
      dispatch(action);
      return action.resultMessage || null;
    }

    function setLearningRequesting(requesting, meta = {}) {
      return dispatch({ type: Action.LEARNING_REQUESTING_CHANGED, requesting, meta });
    }

    function setActiveQuestion(nodeId, meta = {}) {
      return dispatch({ type: Action.LEARNING_ACTIVE_CHANGED, nodeId, meta });
    }

    function popActiveLearningNode(options = {}, meta = {}) {
      const action = { type: Action.LEARNING_NODE_POPPED, ...options, meta };
      dispatch(action);
      return action.result || { poppedId: null, nextActiveId: stackState?.activeQuestionId ?? null };
    }

    function setLearningSelection(selection = null, meta = {}) {
      return dispatch({ type: Action.LEARNING_SELECTION_CHANGED, selection, meta });
    }

    function clearLearningSelection(meta = {}) {
      return dispatch({ type: Action.LEARNING_SELECTION_CLEARED, meta });
    }

    function setLearningAttachments(attachments = [], meta = {}) {
      return dispatch({ type: Action.LEARNING_ATTACHMENTS_CHANGED, attachments, meta });
    }

    function setLearningRichContextMode(enabled, meta = {}) {
      return dispatch({ type: Action.LEARNING_RICH_CONTEXT_CHANGED, enabled, meta });
    }

    function resetLearningTree(payload = {}, meta = {}) {
      return dispatch({ type: Action.LEARNING_TREE_RESET, payload, meta });
    }

    function markLearningNodeWaitingApi(nodeId, providerName = '当前 API', meta = {}) {
      if (!nodeId) return null;
      return patchLearningNode(nodeId, {
        status: 'waiting-api',
        systemMessage: `当前选择的是 ${providerName}，但还没有填写 API Key。\n\n请点击左侧底部设置按钮 → API 设置，填写 ${providerName} 的 API Key、Base URL 和 Model 后，再回到工作台发送问题。`,
      }, { source: 'app-store:node-waiting-api', ...meta });
    }

    function startLearningNodeRequest(nodeId, providerName = '当前 API', meta = {}) {
      if (!nodeId) return null;
      batch([
        { type: Action.LEARNING_REQUESTING_CHANGED, requesting: true, meta: { source: 'app-store:request-started', ...meta } },
        {
          type: Action.LEARNING_NODE_PATCHED,
          nodeId,
          patch: {
            status: 'requesting',
            loadingText: '正在思考…',
            loadingMeta: `${providerName} · 思考中`,
          },
          meta: { source: 'app-store:node-requesting', ...meta },
        },
      ], { type: Action.BATCH, meta: { source: 'app-store:start-node-request', ...meta } });
      return getLearningNode(nodeId) || findLegacyNode(stackState, nodeId);
    }

    function completeLearningNodeRequest(nodeId, answer = '', providerName = '当前 API', meta = {}) {
      if (!nodeId) return null;
      const normalizedAnswer = String(answer || '').trim() || 'AI 没有返回有效内容。';
      batch([
        {
          type: Action.LEARNING_NODE_PATCHED,
          nodeId,
          patch: {
            status: 'answered',
            answer: normalizedAnswer,
            displayedAnswer: '',
            isTyping: true,
            answerMeta: `${providerName} · 回复`,
          },
          meta: { source: 'app-store:node-answered', ...meta },
        },
        {
          type: Action.LEARNING_MESSAGE_ADDED,
          message: { role: 'assistant', questionId: nodeId, content: normalizedAnswer },
          meta: { source: 'app-store:assistant-message', ...meta },
        },
      ], { type: Action.BATCH, meta: { source: 'app-store:complete-node-request', ...meta } });
      return getLearningNode(nodeId) || findLegacyNode(stackState, nodeId);
    }

    function failLearningNodeRequest(nodeId, errorMessage = '', meta = {}) {
      if (!nodeId) return null;
      return patchLearningNode(nodeId, {
        status: 'error',
        errorMessage: String(errorMessage || 'API 请求失败。'),
      }, { source: 'app-store:node-error', ...meta });
    }

    function settleLearningNodeRequest(meta = {}) {
      return setLearningRequesting(false, { source: 'app-store:request-settled', ...meta });
    }


    function restoreLearningSession(snapshot = {}, meta = {}) {
      return dispatch({ type: Action.LEARNING_SESSION_RESTORED, payload: snapshot, meta });
    }

    function syncApiFromSettings(apiSettings = {}) {
      const activeProvider = apiSettings.activeProvider || '';
      const activeProviderName = providerDefaults?.[activeProvider]?.providerName || activeProvider;
      const providersConfigured = computeProviderConfiguredMap(apiSettings);
      return setApi({
        activeProvider,
        activeProviderName,
        activeProviderConfigured: Boolean(providersConfigured[activeProvider]),
        providersConfigured,
      }, { source: 'settings-controller' });
    }

    function syncSettingsFromShell(targetShell = shell, extra = {}) {
      const snapshot = readShellSnapshot(targetShell);
      return setSettings({
        ...(snapshot.settings || {}),
        ...extra,
      }, { source: 'shell-settings-dataset' });
    }

    function scheduleShellSync() {
      if (queuedShellSync) return;
      queuedShellSync = true;
      const run = () => {
        queuedShellSync = false;
        syncFromShell();
      };
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(run);
      } else {
        window.setTimeout(run, 0);
      }
    }

    function startShellObserver() {
      if (!observeShell || !shell || observer || !window.MutationObserver) return;
      observer = new MutationObserver((mutations) => {
        if (mutations.some((mutation) => mutation.type === 'attributes' && mutation.attributeName?.startsWith('data-'))) {
          scheduleShellSync();
        }
      });
      observer.observe(shell, { attributes: true });
    }

    function destroy() {
      observer?.disconnect?.();
      observer = null;
      subscribers.clear();
      selectorSubscribers.clear();
    }

    syncFromShell();
    if (stackState) {
      syncLearningSlicesFromLegacy({ type: Action.LEARNING_DATA_SYNC, meta: { source: 'initial-stack-state' } }, {
        ...buildLearningSummaryFromStack(stackState),
      });
    }
    startShellObserver();

    const debug = {
      state: () => snapshot(),
      learningData: () => clone(state.learningData),
      activeNode: () => clone(select('activeNode', null)),
      history: (count = 20) => history.slice(0, count),
      last: () => history[0] || null,
      selectors,
      whyBlocked: () => ({
        module: state.ui.module,
        learningPhase: state.learning.phase,
        learningBlocking: state.learning.isBlocking,
        resettingTree: state.animation.resettingTree,
        isRequesting: state.learning.isRequesting,
        canSendPrompt: selectors.canSendPrompt(state),
        canPopActiveNode: selectors.canPopActiveNode(state),
        canResetMainQuestionTree: selectors.canResetMainQuestionTree(state),
      }),
    };

    return {
      Slice,
      Action,
      selectors,
      dispatch,
      batch,
      getState,
      snapshot,
      select,
      getLearningNodes,
      getRootLearningNodes,
      getLearningNode,
      getActiveLearningNode,
      getStackTopLearningNode,
      getActiveQuestionId,
      getStackTopQuestionId,
      getLearningSelection,
      getLearningMessages,
      getLearningContentRenderKey,
      getLearningTreeRenderKey,
      getLearningGraphRenderKey,
      getPromptUiRenderKey,
      hasMainQuestion,
      isLearningRequesting,
      getGraphViewport,
      getLearningNodeDepth,
      subscribe,
      subscribeTo,
      waitFor,
      setUi,
      setLearning,
      setLearningData,
      setApi,
      setAnimation,
      setSettings,
      setErrors,
      setModule,
      setAssist,
      setWorkbenchPanel,
      setGraphViewport,
      resetGraphViewport,
      setSettingsSelection,
      syncFromShell,
      syncLearningDataFromStack,
      syncLearningFromMachine,
      createLearningNode,
      patchLearningNode,
      addLearningMessage,
      setLearningRequesting,
      setActiveQuestion,
      popActiveLearningNode,
      setLearningSelection,
      clearLearningSelection,
      setLearningAttachments,
      setLearningRichContextMode,
      resetLearningTree,
      markLearningNodeWaitingApi,
      startLearningNodeRequest,
      completeLearningNodeRequest,
      failLearningNodeRequest,
      settleLearningNodeRequest,
      restoreLearningSession,
      syncApiFromSettings,
      syncSettingsFromShell,
      destroy,
      history: () => history.slice(),
      debug,
      guards: {
        canSendPrompt: () => selectors.canSendPrompt(state),
        canPopActiveNode: () => selectors.canPopActiveNode(state),
        canResetMainQuestionTree: () => selectors.canResetMainQuestionTree(state),
        isBlocking: () => selectors.isBlocking(state),
      },
    };
  };

  window.AppStore = {
    Slice,
    Action,
    createAppStore,
    createDefaultGraphViewportState,
  };
}());
