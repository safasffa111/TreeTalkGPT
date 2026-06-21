(function () {
  const createGraphState = () => ({
    scale: 1,
    x: 18,
    y: 18,
    positions: {},
    manualPositions: {},
  });

  const createInitialStackState = () => ({
    hasMainQuestion: false,
    activeQuestionId: null,
    nodes: [],
    questionStack: [],
    messages: [],
    activeSelection: null,
    selectedAttachments: [],
    richContextMode: false,
    isRequesting: false,
    learningPhase: 'empty',
    lastStackEvent: 'init',
    canResetMainTree: false,
    canPopActiveNode: false,
    nextQuestionIndex: 0,
    graph: createGraphState(),
  });

  const normalizeQuestionStack = (state, findNode) => {
    if (!state) return [];
    const normalized = (state.questionStack || []).filter((id) => {
      const node = findNode?.(id);
      return Boolean(node && node.stackStatus !== 'done');
    });
    if (normalized.length !== (state.questionStack || []).length) {
      state.questionStack = normalized;
    }
    return state.questionStack || [];
  };

  const getStackTopId = (state, findNode) => {
    const openStack = normalizeQuestionStack(state, findNode);
    return openStack.length ? openStack[openStack.length - 1] : null;
  };

  const getMainRootNode = (state) => {
    return (state?.nodes || []).find((node) => !node.parentId) || null;
  };

  const canResetMainQuestionTree = ({ state, findNode, isResettingMainTree = false } = {}) => {
    const root = getMainRootNode(state);
    const openStack = normalizeQuestionStack(state, findNode);
    // Compatibility name: the UI now returns to the history list only when
    // the current main question stack is empty. A completed Q0/root alone is
    // no longer the decisive condition.
    return Boolean(
      state?.hasMainQuestion
      && root
      && openStack.length === 0
      && !state.isRequesting
      && !isResettingMainTree
    );
  };

  window.StackStateUtils = {
    createGraphState,
    createInitialStackState,
    normalizeQuestionStack,
    getStackTopId,
    getMainRootNode,
    canResetMainQuestionTree,
  };
}());
