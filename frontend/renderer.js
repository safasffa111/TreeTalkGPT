window.desktopShell?.meta?.().then((meta) => {
  document.body.dataset.platform = meta.platform;
});

const {
  shell,
  windowMinimizeButton,
  windowMaximizeButton,
  windowCloseButton,
  toggle,
  workbenchButton,
  knowledgeButton,
  settingsButton,
  errorlogsButton,
  apiSettingButton,
  promptSettingButton,
  settingsDetailGroupTitle,
  settingsDetailButtons,
  settingsDetailTitle,
  settingsDetailDescription,
  promptForm,
  promptBox,
  promptInput,
  promptSend,
  promptPop,
  promptAttach,
  attachMenu,
  attachMenuFile,
  attachMenuRich,
  richContextChip,
  attachmentInput,
  attachmentTray,
  contentStream,
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
  workbenchHistoryPanel,
  workbenchHistoryList,
  workbenchTreePanel,
  workbenchGraphPanel,
  workbenchHistoryBackButtons,
  workbenchHistoryClearButtons,
  workbenchSaveModeButton,
  workbenchTreeList,
  errorLogList,
  errorLogsContent,
  graphViewport,
  graphCanvas,
  graphEdges,
  graphNodes,
  apiCards,
  apiUseButtons,
  settingsPlaceholderTitle,
  settingsPlaceholderDescription,
  settingsContent,
  promptDetailTitle,
  promptDetailDescription,
  promptDisplay,
  promptEditor,
  promptEditButton,
  promptResetButton,
} = window.AppDom.queryDomRefs();

const {
  assistStates,
  assistLabels,
  providerDefaults,
  settingsGroups,
  settingDetailMeta,
  storageKey,
  promptSettingsStorageKey,
  legacyDefaultRichPrompt,
  defaultPromptSettings,
} = window.AppConfig;

const stackState = window.StackStateUtils.createInitialStackState();
const appStore = window.AppStore?.createAppStore?.({
  shell,
  stackState,
  providerDefaults,
});
window.__APP_STORE__ = appStore;
stackState.appStore = appStore;
let learningSessionPersistence = null;

let settingsController = null;
let errorLogController = null;
let workbenchRenderer = null;
let graphRenderer = null;
let mainTreeResetController = null;
let workbenchActions = null;
let workbenchHistoryController = null;
let knowledgeWarehouseController = null;
let learningStackStateMachine = null;
const recentNodeEnterIds = new Set();
stackState.recentNodeEnterIds = recentNodeEnterIds;

const bindWindowControls = () => {
  const desktopShell = window.desktopShell;
  const setMaximizedState = (isMaximized) => {
    if (!windowMaximizeButton) return;
    const maximized = Boolean(isMaximized);
    windowMaximizeButton.setAttribute('aria-pressed', maximized ? 'true' : 'false');
    windowMaximizeButton.setAttribute('aria-label', maximized ? '还原窗口' : '放大窗口');
    windowMaximizeButton.title = maximized ? '还原窗口' : '放大窗口';
    document.body.dataset.windowMaximized = maximized ? 'true' : 'false';
  };

  windowMinimizeButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    desktopShell?.minimize?.();
  });

  windowMaximizeButton?.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const result = await desktopShell?.maximize?.();
      if (result && typeof result.isMaximized !== 'undefined') setMaximizedState(result.isMaximized);
    } catch (error) {
      console.warn('[window-controls] maximize failed', error);
    }
  });

  windowCloseButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    desktopShell?.close?.();
  });

  desktopShell?.onWindowStateChange?.((state) => {
    setMaximizedState(state?.isMaximized);
  });

  desktopShell?.isMaximized?.().then((state) => {
    setMaximizedState(state?.isMaximized);
  }).catch(() => {});
};

bindWindowControls();

let graphRenderQueued = false;
const graphRefreshTimers = new Set();
const isWorkbenchGraphSurfaceVisible = () => {
  if (!shell || shell.dataset.assist !== 'wide') return false;
  if (shell.dataset.module === 'workbench') {
    return (shell.dataset.workbenchPanel || 'history') === 'session';
  }
  if (shell.dataset.module === 'knowledge') {
    return (shell.dataset.knowledgePanel || 'list') === 'session';
  }
  return false;
};
const renderWorkbenchGraph = () => {
  if (graphRenderQueued) return;
  graphRenderQueued = true;
  const run = () => {
    graphRenderQueued = false;
    if (!isWorkbenchGraphSurfaceVisible()) return;
    graphRenderer?.render({ recentNodeEnterIds });
  };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run);
  else window.setTimeout(run, 0);
};
const scheduleWorkbenchGraphRefresh = (delays = [0, 120, 320]) => {
  graphRefreshTimers.forEach((timer) => window.clearTimeout(timer));
  graphRefreshTimers.clear();
  [...new Set(Array.isArray(delays) ? delays : [delays])].forEach((delay) => {
    if (Number(delay) <= 0) {
      renderWorkbenchGraph();
      return;
    }
    const timer = window.setTimeout(() => {
      graphRefreshTimers.delete(timer);
      renderWorkbenchGraph();
    }, Number(delay));
    graphRefreshTimers.add(timer);
  });
};
const isWorkbenchHistoryPanel = () => (shell?.dataset?.workbenchPanel || 'history') === 'history';
const isKnowledgeFileActive = () => shell?.dataset?.module === 'knowledge' && Boolean(knowledgeWarehouseController?.getActiveFileId?.());
const renderActiveNodePage = (options = {}) => {
  // History-list mode owns content entry through workbench-history.enterSessionView().
  // Blocking unforced renders here prevents effects/store updates from mounting the
  // same Q0 content once before the queued history -> session transition, which was
  // the remaining source of the one-frame post-enter flash.
  // Knowledge files intentionally reuse the workbench content renderer while the
  // assist panel stays in the knowledge list/tree state. Do not let the workbench
  // history-list guard block knowledge-file node navigation such as fingerprint
  // clicks, graph clicks, or tree clicks after the file has opened on Q0.
  if (isWorkbenchHistoryPanel() && !isKnowledgeFileActive() && !options.force && !options.allowHistoryRender) {
    syncPromptPlaceholder?.();
    syncSendState?.();
    return false;
  }
  if (shell?.dataset?.module === 'knowledge' && !(knowledgeWarehouseController?.getActiveFileId?.()) && !options.force) {
    syncPromptPlaceholder?.();
    syncSendState?.();
    return false;
  }
  return workbenchRenderer?.renderActiveNodePage(options);
};
const renderWorkbenchTree = () => workbenchRenderer?.renderWorkbenchTree();
const clearContentStream = (options = {}) => workbenchRenderer?.clearContentStream(options);
const compactQuestionTitle = window.WorkbenchRenderer.compactQuestionTitle;

const moduleTransition = {
  timer: null,
  settleTimer: null,
  running: false,
  pending: null,
};

const assistPanelSelector = [
  '.assist-knowledge-list',
  '.assist-workbench-history',
  '.assist-workbench-tree',
  '.assist-workbench-graph',
  '.assist-settings',
  '.assist-settings-detail',
  '.assist-errorlogs',
].join(', ');

const clearAssistPanelRuntimeClasses = () => {
  if (!shell) return;
  shell.classList.remove('is-assist-panel-transitioning');
  shell.querySelectorAll?.(assistPanelSelector)?.forEach?.((panel) => {
    panel.classList.remove(
      'is-history-leaving',
      'is-history-preparing-enter',
      'is-history-entering',
      'is-history-enter-settled',
      'is-reset-leaving',
      'is-history-enter-settled',
    );
  });
};

const flushAssistPanelLayout = () => {
  if (!shell) return;
  // Force style recalculation between the outgoing module and the incoming module.
  // Without this, delayed visibility transitions from the knowledge panel can survive
  // into the next module and visually overlap with the workbench/settings/error panel.
  void shell.offsetHeight;
};

const applyModuleState = (module, options = {}) => {
  if (!shell) return;

  shell.dataset.module = module;
  shell.dataset.workbench = (module === 'workbench' || module === 'knowledge') && options.workbenchOpen !== false ? 'open' : 'closed';

  if (module === 'settings') {
    shell.dataset.settingsSection = options.settingsSection || shell.dataset.settingsSection || 'root';
    shell.dataset.settingsGroup = options.settingsGroup || shell.dataset.settingsGroup || '';
    shell.dataset.settingsDetail = options.settingsDetail || shell.dataset.settingsDetail || '';
  }

  appStore?.syncFromShell?.();
  syncToggleState();
  syncModuleState();

  if (module === 'workbench') {
    if (!shell.dataset.workbenchPanel) shell.dataset.workbenchPanel = 'history';
    appStore?.setWorkbenchPanel?.(shell.dataset.workbenchPanel || 'history', { source: 'apply-module-state:workbench' });
    workbenchHistoryController?.refreshHistoryList?.();
    renderWorkbenchTree();
    scheduleWorkbenchGraphRefresh();
    const hasLearningContent = Boolean(appStore?.hasMainQuestion?.() || appStore?.getLearningNodes?.()?.length || stackState?.hasMainQuestion || stackState?.nodes?.length);
    if ((shell.dataset.workbenchPanel || 'history') !== 'history' && hasLearningContent) {
      renderActiveNodePage({ force: true, animateEnter: true, reason: 'workbench-return-from-module' });
    }
    scheduleFingerprintReflow();
    syncPromptPlaceholder?.();
    syncSendState?.();
    if (options.focusPrompt) {
      window.requestAnimationFrame(() => promptInput?.focus());
    }
  }

  if (module === 'knowledge') {
    shell.dataset.knowledgePanel = shell.dataset.knowledgePanel || 'list';
    knowledgeWarehouseController?.enterKnowledgeModule?.();
    if (knowledgeWarehouseController?.getActiveFileId?.() && shell.dataset.knowledgePanel === 'session') {
      scheduleWorkbenchGraphRefresh();
    }
    scheduleFingerprintReflow();
    if (options.focusPrompt && knowledgeWarehouseController?.getActiveFileId?.()) {
      window.requestAnimationFrame(() => promptInput?.focus());
    }
  }
};

const performModuleSwitch = (module, options = {}) => new Promise((resolve) => {
  if (!shell) {
    resolve();
    return;
  }

  window.clearTimeout(moduleTransition.timer);
  window.clearTimeout(moduleTransition.settleTimer);

  const currentModule = shell.dataset.module || 'none';
  const hasVisibleModule = currentModule !== 'none';
  const isSameModule = currentModule === module;

  if (isSameModule) {
    clearAssistPanelRuntimeClasses();
    applyModuleState(module, options);
    flushAssistPanelLayout();
    resolve();
    return;
  }

  clearAssistPanelRuntimeClasses();
  flushAssistPanelLayout();
  shell.dataset.moduleTransition = hasVisibleModule ? 'out' : 'in';
  shell.dataset.assistTransitionQueued = 'true';
  appStore?.setAnimation?.({ moduleTransition: shell.dataset.moduleTransition }, { source: 'switch-module:start' });

  const switchDelay = hasVisibleModule ? 150 : 0;

  moduleTransition.timer = window.setTimeout(() => {
    clearAssistPanelRuntimeClasses();
    applyModuleState(module, options);
    flushAssistPanelLayout();

    if (module === 'none') {
      shell.dataset.moduleTransition = 'idle';
      appStore?.setAnimation?.({ moduleTransition: 'idle' }, { source: 'switch-module:none' });
      moduleTransition.settleTimer = window.setTimeout(() => {
        if (shell.dataset.moduleTransition === 'idle') {
          delete shell.dataset.moduleTransition;
          delete shell.dataset.assistTransitionQueued;
          appStore?.setAnimation?.({ moduleTransition: '' }, { source: 'switch-module:settled' });
        }
        resolve();
      }, 220);
      return;
    }

    shell.dataset.moduleTransition = 'in';
    appStore?.setAnimation?.({ moduleTransition: 'in' }, { source: 'switch-module:in' });
    moduleTransition.settleTimer = window.setTimeout(() => {
      if (shell.dataset.moduleTransition === 'in') {
        delete shell.dataset.moduleTransition;
        delete shell.dataset.assistTransitionQueued;
        appStore?.setAnimation?.({ moduleTransition: '' }, { source: 'switch-module:settled' });
      }
      resolve();
    }, 280);
  }, switchDelay);
});

const switchModule = (module, options = {}) => {
  if (!shell) return;

  moduleTransition.pending = { module, options };
  if (moduleTransition.running) return;

  const drain = () => {
    const request = moduleTransition.pending;
    if (!request) {
      moduleTransition.running = false;
      return;
    }
    moduleTransition.pending = null;
    moduleTransition.running = true;
    performModuleSwitch(request.module, request.options)
      .catch(() => {})
      .finally(() => {
        moduleTransition.running = false;
        if (moduleTransition.pending) drain();
      });
  };

  drain();
};

const suspendKnowledgeBeforeLeaving = async (targetModule = 'none') => {
  if (targetModule === 'knowledge') return false;
  if (shell?.dataset?.module !== 'knowledge') return false;
  return Boolean(await knowledgeWarehouseController?.suspendActiveFileSession?.({ clearWorkspace: true }));
};

const syncToggleState = () => {
  if (!shell || !toggle) return;
  const state = shell.dataset.assist;
  toggle.setAttribute('aria-expanded', String(state !== 'hidden'));
  toggle.setAttribute('aria-label', assistLabels[state] ?? assistLabels.normal);
};

const syncPromptPlaceholder = () => {
  if (!promptInput) return;
  const learningData = appStore?.select?.('learningData', null) || null;
  const hasMainQuestion = learningData ? learningData.hasMainQuestion : stackState.hasMainQuestion;
  const activeSelection = learningData?.activeSelection ?? stackState.activeSelection;
  if (shell?.dataset?.module === 'knowledge' && !hasMainQuestion) {
    promptInput.placeholder = '选择知识文件后，可以框选并追问';
  } else if (!hasMainQuestion) {
    promptInput.placeholder = '提出主问题，创建 Q0';
  } else if (activeSelection?.selectedText) {
    promptInput.placeholder = '针对已框选内容追问';
  } else {
    promptInput.placeholder = '直接追问当前父文本';
  }
};

const getPromptSettingValue = (detail) => settingsController?.getPromptSettingValue(detail) ?? defaultPromptSettings[detail] ?? '';

const syncModuleState = () => {
  if (!shell) return;
  const module = shell.dataset.module ?? 'none';
  const workbenchOpen = module === 'workbench' && shell.dataset.workbench === 'open';
  const knowledgeOpen = module === 'knowledge' && shell.dataset.workbench === 'open';
  const settingsOpen = module === 'settings';
  const errorlogsOpen = module === 'errorlogs';

  appStore?.setUi?.({
    module,
    assist: shell.dataset.assist || 'normal',
    workbenchOpen,
    knowledgeOpen,
    settingsOpen,
    errorlogsOpen,
    settingsSection: shell.dataset.settingsSection || 'root',
    settingsGroup: shell.dataset.settingsGroup || '',
    settingsDetail: shell.dataset.settingsDetail || '',
  }, { source: 'sync-module-state' });
  appStore?.setAnimation?.({
    moduleTransition: shell.dataset.moduleTransition || '',
    settingsContentTransition: shell.dataset.settingsContentTransition || '',
    errorlogsContentTransition: shell.dataset.errorlogsContentTransition || '',
    resettingTree: shell.dataset.resettingTree === 'true',
  }, { source: 'sync-module-state' });

  if (workbenchButton) {
    workbenchButton.setAttribute('aria-pressed', String(workbenchOpen));
    workbenchButton.setAttribute('aria-label', workbenchOpen ? '关闭工作台' : '打开工作台');
  }

  if (knowledgeButton) {
    knowledgeButton.setAttribute('aria-pressed', String(knowledgeOpen));
    knowledgeButton.setAttribute('aria-label', knowledgeOpen ? '关闭知识仓库' : '打开知识仓库');
  }

  if (settingsButton) {
    settingsButton.setAttribute('aria-pressed', String(settingsOpen));
    settingsButton.setAttribute('aria-label', settingsOpen ? '关闭设置' : '打开设置');
  }

  if (errorlogsButton) {
    errorlogsButton.setAttribute('aria-pressed', String(errorlogsOpen));
    errorlogsButton.setAttribute('aria-label', errorlogsOpen ? '关闭错误日志' : '打开错误日志');
  }

  syncPromptPlaceholder();
  settingsController?.sync();
  errorLogController?.sync();
};


settingsController = window.SettingsController.createSettingsController({
  shell,
  apiSettingButton,
  promptSettingButton,
  settingsDetailGroupTitle,
  settingsDetailButtons,
  settingsDetailTitle,
  settingsDetailDescription,
  apiCards,
  apiUseButtons,
  settingsPlaceholderTitle,
  settingsPlaceholderDescription,
  settingsContent,
  promptDetailTitle,
  promptDetailDescription,
  promptDisplay,
  promptEditor,
  promptEditButton,
  promptResetButton,
  config: window.AppConfig,
  storage: window.SettingsStorage,
  appStore,
  callbacks: {
    requestToggleSync: () => syncToggleState(),
    requestModuleSync: () => syncModuleState(),
    switchModule: (module, options) => switchModule(module, options),
  },
});

errorLogController = window.ErrorLogController?.createErrorLogController?.({
  shell,
  errorlogsButton,
  errorLogList,
  errorLogsContent,
  appStore,
  callbacks: {
    requestModuleSync: () => syncModuleState(),
  },
});

if (shell && toggle) {
  if (!assistStates.includes(shell.dataset.assist)) {
    shell.dataset.assist = 'normal';
  }

  syncToggleState();

  toggle.addEventListener('click', () => {
    const currentIndex = assistStates.indexOf(shell.dataset.assist);
    const nextState = assistStates[(currentIndex + 1) % assistStates.length];
    shell.dataset.assist = nextState;
    appStore?.setUi?.({ assist: nextState }, { source: 'assist-toggle' });
    settingsController?.ensureSettingsWideDetail();
    syncToggleState();
    syncModuleState();
    scheduleWorkbenchGraphRefresh();
    scheduleFingerprintReflow();
  });
}

if (shell && workbenchButton) {
  workbenchButton.addEventListener('click', async () => {
    const isOpen = shell.dataset.module === 'workbench' && shell.dataset.workbench === 'open';
    if (isOpen) {
      switchModule('none', { workbenchOpen: false });
    } else {
      await suspendKnowledgeBeforeLeaving('workbench');
      switchModule('workbench', { workbenchOpen: true, focusPrompt: true });
    }
  });
}

if (shell && knowledgeButton) {
  knowledgeButton.addEventListener('click', async () => {
    const isOpen = shell.dataset.module === 'knowledge';
    if (isOpen) {
      await knowledgeWarehouseController?.suspendActiveFileSession?.({ clearWorkspace: true });
      switchModule('none', { workbenchOpen: false });
    } else {
      shell.dataset.assist = shell.dataset.assist === 'hidden' ? 'normal' : shell.dataset.assist || 'normal';
      switchModule('knowledge', { workbenchOpen: true, focusPrompt: true });
    }
  });
}

if (shell && settingsButton) {
  settingsButton.addEventListener('click', async () => {
    const isOpen = shell.dataset.module === 'settings';
    settingsController?.resetSettingsSelection({ fadeOut: isOpen });
    if (isOpen) {
      switchModule('none');
    } else {
      await suspendKnowledgeBeforeLeaving('settings');
      shell.dataset.assist = 'normal';
      switchModule('settings', { settingsSection: 'root', settingsGroup: '', settingsDetail: '' });
    }
  });
}

if (shell && errorlogsButton) {
  errorlogsButton.addEventListener('click', async () => {
    const isOpen = shell.dataset.module === 'errorlogs';
    if (isOpen) {
      errorLogController?.clearSelection?.({ fadeOut: true });
      switchModule('none');
    } else {
      await suspendKnowledgeBeforeLeaving('errorlogs');
      shell.dataset.assist = shell.dataset.assist === 'hidden' ? 'normal' : shell.dataset.assist || 'normal';
      switchModule('errorlogs');
    }
  });
}

syncToggleState();
syncModuleState();


const attachmentController = window.AttachmentController.createAttachmentController({
  state: stackState,
  promptAttach,
  attachMenu,
  attachMenuFile,
  attachMenuRich,
  richContextChip,
  attachmentInput,
  attachmentTray,
  promptInput,
  syncSendState: () => syncSendState(),
  appStore,
  flushAttachmentReferences: async () => {
    if (shell?.dataset?.module === 'knowledge') {
      knowledgeWarehouseController?.saveActiveFileSession?.();
      return;
    }
    let result = await learningSessionPersistence?.saveNow?.();
    if (result === null) {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      result = await learningSessionPersistence?.saveNow?.();
    }
    return result;
  },
  getAttachmentIdsToPreserve: () => {
    const ids = new Set(knowledgeWarehouseController?.getAttachmentIds?.() || []);
    window.AttachmentReferences?.collectFromLearningData?.(appStore?.select?.('learningData', null) || {}, ids);
    return [...ids];
  },
});
const {
  renderAttachmentTray,
  consumeSelectedAttachments,
  setAttachMenuOpen,
  syncRichContextUi,
  hasPromptPayload,
  getPromptQuestionText,
  handlePasteImages,
} = attachmentController;
attachmentController.attachEvents();

const {
  normalizeAttachmentList,
  buildMessageContentForApi,
} = window.AttachmentUtils;

const promptBoxController = window.PromptBoxController.createPromptBoxController({
  promptInput,
  promptBox,
  richContextChip,
  promptAttach,
  promptPop,
  promptSend,
});
const {
  autoResizePrompt,
  restorePromptToInitialState,
  schedulePromptRestore,
} = promptBoxController;

const normalizeQuestionStack = () => window.StackStateUtils.normalizeQuestionStack(stackState, findNode);

const getStackTopId = () => appStore?.getStackTopQuestionId?.() ?? appStore?.select?.('stackTopId', null) ?? window.StackStateUtils.getStackTopId(stackState, findNode);

const isActiveNodeStackTop = () => {
  const activeId = appStore?.getActiveQuestionId?.() ?? appStore?.select?.('activeQuestionId', null) ?? stackState.activeQuestionId;
  const topId = getStackTopId();
  return Boolean(activeId && activeId === topId);
};

const getMainRootNode = () => appStore?.getRootLearningNodes?.()?.[0] || window.StackStateUtils.getMainRootNode(stackState);

const isMainTreeResetting = () => mainTreeResetController?.isResetting?.() ?? false;

const canResetMainQuestionTree = () => mainTreeResetController?.canResetMainQuestionTree?.() ?? false;

const syncSendState = () => {
  learningStackStateMachine?.refresh?.();
  const blocked = isMainTreeResetting() || learningStackStateMachine?.isBlocking?.();
  const knowledgeNeedsFile = shell?.dataset?.module === 'knowledge' && !(knowledgeWarehouseController?.getActiveFileId?.());
  const hasPayload = hasPromptPayload();

  if (promptInput && promptSend) {
    promptSend.disabled = knowledgeNeedsFile || (learningStackStateMachine
      ? !learningStackStateMachine.canSendPrompt(hasPayload)
      : (!hasPayload || blocked));
  }

  if (promptAttach) {
    promptAttach.disabled = blocked;
    promptAttach.setAttribute('aria-disabled', String(blocked));
    if (blocked) setAttachMenuOpen(false);
  }

  if (attachMenuFile) {
    attachMenuFile.disabled = blocked;
    attachMenuFile.setAttribute('aria-disabled', String(blocked));
  }

  if (attachMenuRich) {
    attachMenuRich.disabled = blocked;
    attachMenuRich.setAttribute('aria-disabled', String(blocked));
  }

  syncRichContextUi();

  if (promptPop) {
    const canReset = learningStackStateMachine?.canResetMainQuestionTree?.() ?? canResetMainQuestionTree();
    const canPop = learningStackStateMachine?.canPopActiveNode?.() ?? (isActiveNodeStackTop() && !blocked);
    const enabled = canReset || canPop;

    promptPop.disabled = !enabled;
    promptPop.setAttribute('aria-disabled', String(!enabled));
    promptPop.setAttribute(
      'aria-label',
      canReset
        ? (shell?.dataset?.module === 'knowledge' ? '退出当前知识文本' : '返回历史学习列表')
        : (canPop ? '当前栈顶问题出栈' : '当前页面不是栈顶，无法出栈')
    );
    promptPop.classList.toggle('is-stack-top', canPop && !canReset);
    promptPop.classList.toggle('is-reset-main', canReset);
    if (shell) {
      shell.dataset.canResetMain = String(canReset);
      shell.dataset.canPopActive = String(canPop);
    }
    appStore?.setUi?.({ canResetMain: canReset, canPopActive: canPop }, { source: 'sync-send-state' });
  }
};

const { renderRichText } = window.RichRenderer;

const findNode = (id) => stackState.nodes.find((node) => node.id === id) || appStore?.getLearningNode?.(id) || null;

const getNodeDepth = (nodeId) => {
  let depth = 0;
  if (appStore?.getLearningNodeDepth) return appStore.getLearningNodeDepth(nodeId);
  let current = findNode(nodeId);
  const guard = new Set();
  while (current?.parentId && !guard.has(current.id)) {
    guard.add(current.id);
    depth += 1;
    current = findNode(current.parentId);
  }
  return depth;
};

learningStackStateMachine = window.LearningStackStateMachine.createLearningStackStateMachine({
  state: stackState,
  shell,
  findNode,
  normalizeQuestionStack,
  getStackTopId,
  getMainRootNode,
  isResetting: () => isMainTreeResetting(),
  appStore,
});

const selectionFingerprint = window.SelectionFingerprint.createSelectionFingerprintController({
  contentStream,
  stackState,
  promptInput,
  findNode,
  syncPromptPlaceholder,
  renderActiveNodePage: () => renderActiveNodePage(),
  renderWorkbenchTree: () => renderWorkbenchTree(),
  renderWorkbenchGraph: () => renderWorkbenchGraph(),
  appStore,
});
const {
  getVisibleText,
  clearActiveSelectionState,
  updateActiveSelectionFromWindow,
  applyNodeAnnotationsToBody,
  scheduleFingerprintReflow,
} = selectionFingerprint;

workbenchRenderer = window.WorkbenchRenderer.createWorkbenchRenderer({
  shell,
  contentStream,
  workbenchTreeList,
  workbenchSaveModeButton,
  state: stackState,
  findNode,
  getStackTopId,
  renderRichText,
  applyNodeAnnotationsToBody,
  clearActiveSelectionState,
  scheduleFingerprintReflow,
  syncSendState,
  syncPromptPlaceholder,
  focusPrompt: () => promptInput?.focus(),
  renderWorkbenchGraph,
  onSaveSubtreeToKnowledge: (nodeId) => knowledgeWarehouseController?.saveLearningSubtreeAsRootFile?.(nodeId),
  appStore,
});



graphRenderer = window.GraphRenderer.createWorkbenchGraphRenderer({
  graphViewport,
  graphCanvas,
  graphEdges,
  graphNodes,
  state: stackState,
  findNode,
  getStackTopId,
  compactQuestionTitle,
  appStore,
  onOpenNode: (nodeId) => {
    if (!(appStore?.getLearningNode?.(nodeId) || findNode(nodeId))) return;
    if (appStore?.setActiveQuestion) {
      appStore.setActiveQuestion(nodeId, { source: 'graph-renderer:open-node' });
    } else {
      stackState.activeQuestionId = nodeId;
    }
    learningStackStateMachine?.transition?.(window.LearningStackStateMachine.Event.ACTIVE_NODE_CHANGED);
    renderActiveNodePage();
    renderWorkbenchTree();
    renderWorkbenchGraph();
    syncPromptPlaceholder();
    window.requestAnimationFrame(() => promptInput?.focus());
  },
});

const scheduleRaf = (() => {
  const rafIds = new Map();
  return (key, task) => {
    if (rafIds.get(key)) return;
    const run = () => {
      rafIds.delete(key);
      task?.();
    };
    const id = window.requestAnimationFrame?.(run) || window.setTimeout(run, 0);
    rafIds.set(key, id);
  };
})();

const scheduleContentRender = (options = {}) => scheduleRaf('workbench-content', () => {
  if (shell?.dataset?.knowledgeFileTransition && !options.allowDuringKnowledgeFileTransition) return;
  renderActiveNodePage(options);
  syncPromptPlaceholder();
  syncSendState();
});

const scheduleTreeRender = () => scheduleRaf('workbench-tree', () => {
  renderWorkbenchTree();
  syncSendState();
});

const scheduleGraphRender = () => scheduleRaf('workbench-graph', () => {
  renderWorkbenchGraph();
});

const schedulePromptUiRender = () => scheduleRaf('prompt-ui', () => {
  renderAttachmentTray?.();
  syncRichContextUi?.();
  syncPromptPlaceholder();
  syncSendState();
});

// Store-driven UI is now subscribed by narrow render keys instead of the whole
// learningData object. This is the migration boundary that prevents transient
// input states (selection, attachments, graph viewport) from destructively
// rebuilding the content panel.
appStore?.subscribeTo?.('learningContentRenderKey', (next, previous, storeState, action = {}) => {
  const source = action?.meta?.source || '';
  // While the workbench assist panel is still in the history-list state, content
  // changes are controlled by WorkbenchHistory.enterSessionView(). Knowledge
  // files are different: they reuse the content renderer without becoming a
  // workbench history session, so content changes from fingerprint/tree/graph
  // navigation must still render inside the current knowledge file.
  if ((shell?.dataset?.workbenchPanel || 'history') === 'history' && !isKnowledgeFileActive()) return;
  // The typewriter patches the answer body directly. Rebuilding the whole
  // content panel on each tick or on completion can cause visible jumps and
  // can reset scroll position after the answer finishes.
  if (source.startsWith('answer-typewriter:tick') || source === 'answer-typewriter:completed') return;
  // Opening a knowledge file owns a single awaited leave/swap/enter transaction.
  // The explicit render in knowledge-warehouse must not race this RAF subscriber.
  if (source === 'knowledge-warehouse:open-file') return;
  if (source === 'main-tree-reset:start' || action?.type === appStore.Action.LEARNING_RESET_STARTED) return;
  if (source === 'workbench-history:enter-history-reset' || source === 'workbench-history:clear-all-reset') return;
  scheduleContentRender();
});

appStore?.subscribeTo?.('learningTreeRenderKey', () => {
  scheduleTreeRender();
});

appStore?.subscribeTo?.('learningGraphRenderKey', () => {
  scheduleGraphRender();
});

appStore?.subscribeTo?.('promptUiRenderKey', () => {
  schedulePromptUiRender();
});

appStore?.subscribeTo?.('graphViewport', () => {
  // Pan/zoom must update only the transform layer. Re-rendering nodes here would
  // make graph interactions feed back into the learning/content render path.
  graphRenderer?.syncTransform?.();
});

const answerTypewriter = window.AnswerTypewriter.createAnswerTypewriter({
  contentStream,
  state: stackState,
  findNode,
  renderRichText,
  applyNodeAnnotationsToBody,
  syncSendState,
  schedulePromptRestore,
  scheduleFingerprintReflow,
  appStore,
});

const stopAnswerTypewriter = (nodeId) => answerTypewriter.stop(nodeId);
const stopAllAnswerTypewriters = () => answerTypewriter.stopAll();
const startAnswerTypewriter = (nodeId) => answerTypewriter.start(nodeId);

const promptBuilder = window.PromptBuilder.createPromptBuilder({
  state: stackState,
  findNode,
  getNodeDepth,
  getPromptSettingValue,
  appStore,
});
const {
  collectRichContextAttachments,
  buildMainQuestionPrompt,
  buildFollowUpPrompt,
} = promptBuilder;

mainTreeResetController = window.MainTreeReset.createMainTreeResetController({
  state: stackState,
  shell,
  contentStream,
  knowledgePanel,
  knowledgeList,
  knowledgeBreadcrumb,
  knowledgeFolderBackButton,
  knowledgeTitleText,
  knowledgeNewFolderButton,
  knowledgeDeleteModeButton,
  knowledgeWideNewButton,
  workbenchHistoryPanel,
  workbenchHistoryList,
  workbenchTreePanel,
  workbenchGraphPanel,
  workbenchHistoryBackButtons,
  workbenchTreeList,
  graphCanvas,
  graphEdges,
  graphNodes,
  findNode,
  syncRichContextUi,
  stopAllAnswerTypewriters,
  renderAttachmentTray,
  clearActiveSelectionState,
  clearContentStream,
  renderWorkbenchTree,
  renderWorkbenchGraph,
  syncPromptPlaceholder,
  syncSendState,
  scheduleFingerprintReflow,
  focusPrompt: () => promptInput?.focus(),
  createGraphState: window.StackStateUtils.createGraphState,
  stateMachine: learningStackStateMachine,
  appStore,
});

workbenchActions = window.WorkbenchActions.createWorkbenchActionsController({
  state: stackState,
  shell,
  promptForm,
  promptInput,
  promptPop,
  findNode,
  getStackTopId,
  normalizeQuestionStack,
  getActiveApiConfig: () => window.ApiClient.getActiveApiConfig(settingsController?.getApiSettings(), providerDefaults),
  mainTreeResetController,
  stateMachine: learningStackStateMachine,
  hasPromptPayload,
  getPromptQuestionText,
  consumeSelectedAttachments,
  restorePromptToInitialState,
  clearActiveSelectionState,
  collectRichContextAttachments,
  buildMainQuestionPrompt,
  buildFollowUpPrompt,
  normalizeAttachmentList,
  buildMessageContentForApi,
  requestChat: window.ApiClient.requestChat,
  getPersistence: () => learningSessionPersistence,
  renderActiveNodePage,
  renderWorkbenchTree,
  renderWorkbenchGraph,
  syncPromptPlaceholder,
  syncSendState,
  schedulePromptRestore,
  startAnswerTypewriter,
  recentNodeEnterIds,
  appStore,
  onBeforeMainQuestionCreate: () => {
    if ((shell?.dataset?.workbenchPanel || 'history') === 'history') {
      learningSessionPersistence?.startNewSession?.({ clearCurrent: true });
    }
  },
  onAfterMainQuestionCreate: () => {
    if ((shell?.dataset?.workbenchPanel || 'history') === 'history') {
      return workbenchHistoryController?.enterSessionView?.({ animateEnter: true, scrollTop: true, reason: 'main-question-created-from-history' });
    }
    return false;
  },
  onRequestHistoryReturn: () => workbenchHistoryController?.enterHistoryList?.({ clearWorkspace: true, reason: 'prompt-return-history' }),
  onRequestKnowledgeExit: () => knowledgeWarehouseController?.exitCurrentFile?.(),
  getLearningRequestContext: (node) => knowledgeWarehouseController?.getLearningRequestContext?.(node),
  isLearningRequestContextCurrent: (context) => knowledgeWarehouseController?.isLearningRequestContextCurrent?.(context),
  markLearningRequestInFlight: (context) => knowledgeWarehouseController?.markLearningRequestInFlight?.(context),
  finishLearningRequestInFlight: (context) => knowledgeWarehouseController?.finishLearningRequestInFlight?.(context),
  completeBackgroundLearningRequest: (payload) => knowledgeWarehouseController?.completeBackgroundLearningRequest?.(payload),
  failBackgroundLearningRequest: (payload) => knowledgeWarehouseController?.failBackgroundLearningRequest?.(payload),
});
workbenchActions.attachEvents();

if (contentStream) {
  contentStream.addEventListener('mouseup', () => {
    window.setTimeout(scheduleSelectionStateUpdate, 0);
  });

  contentStream.addEventListener('keyup', (event) => {
    if (event.key === 'Shift' || event.key.startsWith('Arrow')) {
      window.setTimeout(scheduleSelectionStateUpdate, 0);
    }
  });
}

let selectionUpdateRaf = 0;
const scheduleSelectionStateUpdate = () => {
  if (selectionUpdateRaf) return;
  selectionUpdateRaf = window.requestAnimationFrame?.(() => {
    selectionUpdateRaf = 0;
    updateActiveSelectionFromWindow();
  }) || window.setTimeout(() => {
    selectionUpdateRaf = 0;
    updateActiveSelectionFromWindow();
  }, 0);
};

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const anchor = selection.anchorNode?.parentElement || selection.anchorNode;
  if (!contentStream?.contains(anchor)) return;
  scheduleSelectionStateUpdate();
});


if (promptInput && promptForm) {
  autoResizePrompt({ immediate: true });
  syncSendState();
  syncPromptPlaceholder();

  promptInput.addEventListener('input', () => {
    autoResizePrompt();
    syncSendState();
  });

  promptInput.addEventListener('paste', async (event) => {
    await handlePasteImages(event);
  });

}


graphRenderer.attachViewportHandlers();

if (window.ResizeObserver && contentStream) {
  const fingerprintResizeObserver = new ResizeObserver(() => {
    scheduleFingerprintReflow([0, 80]);
  });
  fingerprintResizeObserver.observe(contentStream);
}

let windowResizeFrame = 0;
let windowResizeSettleTimer = 0;
window.addEventListener('resize', () => {
  document.body?.classList?.add('is-window-resizing');
  window.clearTimeout(windowResizeSettleTimer);
  windowResizeSettleTimer = window.setTimeout(() => {
    document.body?.classList?.remove('is-window-resizing');
    autoResizePrompt({ immediate: true });
    renderWorkbenchGraph();
    scheduleFingerprintReflow([0, 80]);
  }, 160);

  if (windowResizeFrame) return;
  windowResizeFrame = window.requestAnimationFrame?.(() => {
    windowResizeFrame = 0;
    autoResizePrompt({ immediate: true });
    renderWorkbenchGraph();
    scheduleFingerprintReflow();
  }) || window.setTimeout(() => {
    windowResizeFrame = 0;
    autoResizePrompt({ immediate: true });
    renderWorkbenchGraph();
    scheduleFingerprintReflow();
  }, 16);
});

if (shell) {
  shell.addEventListener('transitionend', (event) => {
    if (['grid-template-columns', 'width', 'transform', 'opacity'].includes(event.propertyName)) {
      renderWorkbenchGraph();
      scheduleFingerprintReflow([0, 80]);
    }
  });
}

learningSessionPersistence = window.LearningSessionPersistence?.createLearningSessionPersistence?.({
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
});
window.__LEARNING_SESSION_PERSISTENCE__ = learningSessionPersistence;

workbenchHistoryController = window.WorkbenchHistory?.createWorkbenchHistoryController?.({
  shell,
  historyPanel: workbenchHistoryPanel,
  historyList: workbenchHistoryList,
  treePanel: workbenchTreePanel,
  graphPanel: workbenchGraphPanel,
  backButtons: workbenchHistoryBackButtons,
  clearButtons: workbenchHistoryClearButtons,
  appStore,
  persistence: learningSessionPersistence,
  stateMachine: learningStackStateMachine,
  clearContentStream,
  renderActiveNodePage,
  renderWorkbenchTree,
  renderWorkbenchGraph,
  renderAttachmentTray,
  syncRichContextUi,
  syncPromptPlaceholder,
  syncSendState,
  scheduleFingerprintReflow,
  resetGraphViewport: () => appStore?.resetGraphViewport?.({ source: 'workbench-history' }),
  focusPrompt: () => promptInput?.focus(),
  startAnswerTypewriter,
  getAttachmentIdsToPreserve: () => knowledgeWarehouseController?.getAttachmentIds?.() || [],
});
window.__WORKBENCH_HISTORY__ = workbenchHistoryController;

knowledgeWarehouseController = window.KnowledgeWarehouse?.createKnowledgeWarehouseController?.({
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
  treePanel: workbenchTreePanel,
  graphPanel: workbenchGraphPanel,
  treeToggleButtons: workbenchHistoryBackButtons,
  appStore,
  stackState,
  persistence: learningSessionPersistence,
  stateMachine: learningStackStateMachine,
  clearContentStream,
  renderActiveNodePage,
  renderWorkbenchTree,
  renderWorkbenchGraph,
  renderAttachmentTray,
  syncRichContextUi,
  syncPromptPlaceholder,
  syncSendState,
  scheduleFingerprintReflow,
  focusPrompt: () => promptInput?.focus(),
  stopAllAnswerTypewriters,
});
knowledgeWarehouseController?.attachEvents?.();
window.__KNOWLEDGE_WAREHOUSE__ = knowledgeWarehouseController;

const renderInitialWorkspace = () => {
  learningStackStateMachine?.refresh?.();
  appStore?.syncFromShell?.();
  appStore?.syncApiFromSettings?.(settingsController?.getApiSettings?.() || {});
  shell && (shell.dataset.workbenchPanel = shell.dataset.workbenchPanel || 'history');
  appStore?.setWorkbenchPanel?.(shell?.dataset?.workbenchPanel || 'history', { source: 'initial-workspace' });
  renderAttachmentTray?.();
  syncRichContextUi?.();
  syncPromptPlaceholder?.();
  syncSendState?.();
  renderWorkbenchTree();
  renderWorkbenchGraph();
};

learningSessionPersistence?.hydrate?.({ restoreCurrent: false })
  .then(() => {
    renderInitialWorkspace();
    return workbenchHistoryController?.initialize?.();
  })
  .then(() => {
    learningSessionPersistence?.startAutoSave?.();
  })
  .catch((error) => {
    try { console.warn?.('Learning session persistence init failed', error); } catch (_) {}
    renderInitialWorkspace();
    workbenchHistoryController?.initialize?.();
    learningSessionPersistence?.startAutoSave?.();
  });
