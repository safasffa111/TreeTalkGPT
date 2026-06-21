(function () {
  const createMainTreeResetController = ({
    state,
    shell,
    contentStream,
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
    focusPrompt,
    createGraphState,
    stateMachine,
    appStore,
  } = {}) => {
    let isResettingMainTree = false;
    let resetAnimationTimer = 0;

    const isResetting = () => isResettingMainTree;
    const getLearningNodeCount = () => {
      const storeNodes = appStore?.getLearningNodes?.();
      if (Array.isArray(storeNodes)) return storeNodes.length;
      return Array.isArray(state?.nodes) ? state.nodes.length : 0;
    };

    const canResetMainQuestionTree = () => stateMachine?.canResetMainQuestionTree?.()
      ?? appStore?.guards?.canResetMainQuestionTree?.()
      ?? window.StackStateUtils.canResetMainQuestionTree({
        state,
        findNode,
        isResettingMainTree,
      });

    const performResetMainQuestionTree = () => {
      isResettingMainTree = false;
      appStore?.setAnimation?.({ resettingTree: false }, { source: 'main-tree-reset:complete' });
      const nextGraph = createGraphState?.() || window.StackStateUtils.createGraphState();
      if (appStore?.resetLearningTree) {
        appStore.resetLearningTree({ graph: nextGraph }, { source: 'main-tree-reset:complete' });
      } else {
        state.hasMainQuestion = false;
        state.activeQuestionId = null;
        state.nodes = [];
        state.questionStack = [];
        state.messages = [];
        state.activeSelection = null;
        state.selectedAttachments = [];
        state.richContextMode = false;
        state.isRequesting = false;
        state.nextQuestionIndex = 0;
        state.graph = nextGraph;
      }
      syncRichContextUi?.();
      stopAllAnswerTypewriters?.();
      renderAttachmentTray?.();

      if (shell) {
        shell.dataset.stackPhase = 'empty';
        delete shell.dataset.resettingTree;
      }
      stateMachine?.transition?.(window.LearningStackStateMachine.Event.RESET_COMPLETED, { forceChangedAt: true });
      appStore?.syncFromShell?.();

      window.getSelection?.()?.removeAllRanges?.();
      clearActiveSelectionState?.();
      clearContentStream?.();
      renderWorkbenchTree?.();
      renderWorkbenchGraph?.();
      syncPromptPlaceholder?.();
      syncSendState?.();
      scheduleFingerprintReflow?.([0]);
      window.requestAnimationFrame(() => focusPrompt?.());
    };

    const animateMainTreeRemoval = () => {
      window.clearTimeout(resetAnimationTimer);

      if (!getLearningNodeCount()) {
        performResetMainQuestionTree();
        return;
      }

      const treeLayer = document.querySelector('.assist-workbench-tree');
      const graphLayer = document.querySelector('.assist-workbench-graph');
      const contentMessages = Array.from(document.querySelectorAll('.content-message'));
      const treeItems = Array.from(document.querySelectorAll('.tree-node-button'));
      const graphItems = Array.from(document.querySelectorAll('.graph-node'));
      const graphEdgesList = Array.from(document.querySelectorAll('.graph-edge-path'));
      const leavingLayers = [
        contentStream,
        treeLayer,
        graphLayer,
        workbenchTreeList,
        graphCanvas,
        graphEdges,
        graphNodes,
      ].filter(Boolean);
      const contentLeavingItems = [...contentMessages];
      const treeGraphSnapshotItems = [
        ...treeItems,
        ...graphItems,
        ...graphEdgesList,
      ];

      if (shell) shell.dataset.resettingTree = 'true';

      stopAllAnswerTypewriters?.();
      clearActiveSelectionState?.();
      window.getSelection?.()?.removeAllRanges?.();

      // Freeze the current rendered content/tree/graph immediately. Animation is
      // only the visual layer; the actual reset always completes via the timer.
      contentLeavingItems.forEach((element) => {
        element.classList.remove('is-node-enter', 'is-node-leave', 'is-reset-leaving');
        element.classList.add('is-reset-snapshot');
        element.style.animation = 'none';
      });

      treeGraphSnapshotItems.forEach((element) => {
        element.classList.remove('is-node-enter', 'is-node-leave', 'is-reset-leaving');
        element.classList.add('is-reset-snapshot');
        element.style.animation = 'none';
      });

      leavingLayers.forEach((layer) => {
        layer.classList.remove('is-reset-leaving');
        layer.style.animation = 'none';
      });

      // Force frozen styles to apply, then start the fade immediately. The logic
      // tree and graph stay on the stable layer-fade path to avoid partial per-node reflow.
      document.body.offsetHeight;

      leavingLayers.forEach((layer) => {
        layer.style.animation = '';
        layer.classList.add('is-reset-leaving');
      });

      contentLeavingItems.forEach((element) => {
        element.style.animation = '';
        element.classList.add('is-reset-leaving');
      });

      resetAnimationTimer = window.setTimeout(() => {
        performResetMainQuestionTree();
        window.requestAnimationFrame(() => {
          [...leavingLayers, ...contentLeavingItems, ...treeGraphSnapshotItems].forEach((element) => {
            element.classList.remove('is-reset-leaving', 'is-reset-snapshot');
            element.style.animation = '';
          });
        });
      }, 520);
    };

    const resetMainQuestionTree = () => {
      if (isResettingMainTree) return;
      if (!getLearningNodeCount()) {
        performResetMainQuestionTree();
        return;
      }
      isResettingMainTree = true;
      appStore?.dispatch?.({ type: appStore.Action.LEARNING_RESET_STARTED, meta: { source: 'main-tree-reset:start' } });
      stateMachine?.transition?.(window.LearningStackStateMachine.Event.RESET_STARTED, { forceChangedAt: true });
      syncSendState?.();
      animateMainTreeRemoval();
    };

    return {
      isResetting,
      canResetMainQuestionTree,
      performResetMainQuestionTree,
      resetMainQuestionTree,
    };
  };

  window.MainTreeReset = {
    createMainTreeResetController,
  };
}());
