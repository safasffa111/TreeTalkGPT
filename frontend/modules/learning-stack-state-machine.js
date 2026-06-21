(function () {
  const Phase = Object.freeze({
    EMPTY: 'empty',
    ACTIVE: 'active',
    REQUESTING: 'requesting',
    ANSWER_VISIBLE: 'answer-visible',
    TREE_COMPLETED: 'tree-completed',
    RESETTING: 'resetting',
  });

  const Event = Object.freeze({
    INIT: 'init',
    REFRESH: 'refresh',
    MAIN_CREATED: 'main-created',
    FOLLOW_UP_CREATED: 'follow-up-created',
    REQUEST_STARTED: 'request-started',
    REQUEST_WAITING_API: 'request-waiting-api',
    REQUEST_SUCCEEDED: 'request-succeeded',
    REQUEST_FAILED: 'request-failed',
    REQUEST_SETTLED: 'request-settled',
    ACTIVE_NODE_CHANGED: 'active-node-changed',
    NODE_POPPED: 'node-popped',
    RESET_STARTED: 'reset-started',
    RESET_COMPLETED: 'reset-completed',
  });

  const isBlockingPhase = (phase) => phase === Phase.RESETTING;

  const createLearningStackStateMachine = ({
    state,
    shell,
    findNode,
    normalizeQuestionStack,
    getStackTopId,
    getMainRootNode,
    isResetting,
    appStore,
  } = {}) => {
    const machine = {
      phase: Phase.EMPTY,
      previousPhase: '',
      lastEvent: Event.INIT,
      lastChangedAt: Date.now(),
    };

    const getStoreLearningData = () => appStore?.select?.('learningData', null) || null;

    const getStoreNodes = () => {
      const nodes = appStore?.getLearningNodes?.();
      return Array.isArray(nodes) ? nodes : [];
    };

    const getNode = (nodeId) => {
      if (!nodeId) return null;
      return appStore?.getLearningNode?.(nodeId) || findNode?.(nodeId) || null;
    };

    const getActiveId = () => {
      const data = getStoreLearningData();
      return data?.activeQuestionId ?? state?.activeQuestionId ?? null;
    };

    const normalizeStoreQuestionStack = () => {
      const data = getStoreLearningData();
      if (!data || !Array.isArray(data.questionStack)) return null;
      return data.questionStack.filter((id) => {
        const node = getNode(id);
        return Boolean(node && node.stackStatus !== 'done');
      });
    };

    const getTopId = () => {
      const storeTopId = appStore?.select?.('stackTopId', null);
      if (storeTopId && getNode(storeTopId)?.stackStatus !== 'done') return storeTopId;
      const storeStack = normalizeStoreQuestionStack();
      if (storeStack) return storeStack.length ? storeStack[storeStack.length - 1] : null;
      if (typeof getStackTopId === 'function') return getStackTopId();
      return window.StackStateUtils?.getStackTopId?.(state, findNode) || null;
    };

    const getRoot = () => {
      const storeRoot = appStore?.getRootLearningNodes?.()?.[0];
      if (storeRoot) return storeRoot;
      return getMainRootNode?.() || window.StackStateUtils?.getMainRootNode?.(state) || null;
    };

    const getActiveNode = () => getNode(getActiveId());

    const normalizeStack = () => {
      const storeStack = normalizeStoreQuestionStack();
      if (storeStack) return storeStack;
      if (typeof normalizeQuestionStack === 'function') return normalizeQuestionStack();
      return window.StackStateUtils?.normalizeQuestionStack?.(state, findNode) || [];
    };

    const readRuntimeSnapshot = () => {
      const data = getStoreLearningData();
      const nodes = data ? getStoreNodes() : (Array.isArray(state?.nodes) ? state.nodes : []);
      const activeQuestionId = getActiveId();
      const questionStack = normalizeStack();
      const root = getRoot();
      const topId = getTopId();
      const isRequesting = Boolean(
        appStore?.select?.('learning.isRequesting', undefined) ?? state?.isRequesting
      );
      const hasMainQuestion = Boolean(data?.hasMainQuestion ?? state?.hasMainQuestion ?? nodes.length);
      return {
        hasMainQuestion,
        activeQuestionId,
        topId,
        root,
        nodes,
        nodeCount: nodes.length,
        questionStack,
        stackSize: questionStack.length,
        isRequesting,
        activeNode: getNode(activeQuestionId),
      };
    };

    const syncStateShape = () => {
      const runtime = readRuntimeSnapshot();
      const canReset = canResetMainQuestionTree();
      const canPop = canPopActiveNode();

      if (state) {
        state.learningPhase = machine.phase;
        state.lastStackEvent = machine.lastEvent;
        state.lastStackPhaseChangedAt = machine.lastChangedAt;
        state.canResetMainTree = canReset;
        state.canPopActiveNode = canPop;
      }

      appStore?.setLearning?.({
        phase: machine.phase,
        previousPhase: machine.previousPhase,
        lastEvent: machine.lastEvent,
        activeQuestionId: runtime.activeQuestionId,
        stackTopId: runtime.topId,
        rootQuestionId: runtime.root?.id || null,
        rootStackStatus: runtime.root?.stackStatus || '',
        hasMainQuestion: runtime.hasMainQuestion,
        nodeCount: runtime.nodeCount,
        stackSize: runtime.stackSize,
        isRequesting: runtime.isRequesting,
        canSendPrompt: canSendPrompt(true),
        canCreateMainQuestion: canCreateMainQuestion(),
        canCreateFollowUpQuestion: canCreateFollowUpQuestion(),
        canPopActiveNode: canPop,
        canResetMainQuestionTree: canReset,
        isBlocking: isBlockingPhase(machine.phase),
        lastChangedAt: machine.lastChangedAt,
      }, { source: 'learning-stack-state-machine', event: machine.lastEvent });
    };

    const derivePhase = () => {
      const runtime = readRuntimeSnapshot();
      if (isResetting?.()) return Phase.RESETTING;
      if (!runtime.hasMainQuestion || !runtime.nodeCount) return Phase.EMPTY;

      if (runtime.isRequesting || runtime.activeNode?.status === 'requesting') return Phase.REQUESTING;

      const hasOpenStack = Boolean(runtime.topId);
      if (runtime.root && runtime.root.stackStatus === 'done' && !hasOpenStack) return Phase.TREE_COMPLETED;

      if (runtime.activeNode && ['answered', 'waiting-api', 'error'].includes(runtime.activeNode.status)) {
        return Phase.ANSWER_VISIBLE;
      }

      return Phase.ACTIVE;
    };

    function canSendPrompt(hasPayload = true) {
      return Boolean(hasPayload && !isBlockingPhase(machine.phase));
    }

    function canCreateMainQuestion() {
      return machine.phase === Phase.EMPTY;
    }

    function canCreateFollowUpQuestion() {
      const runtime = readRuntimeSnapshot();
      return Boolean(runtime.hasMainQuestion && !isBlockingPhase(machine.phase));
    }

    function canPopActiveNode() {
      const runtime = readRuntimeSnapshot();
      if (!runtime.activeQuestionId || isBlockingPhase(machine.phase)) return false;
      if (runtime.activeNode?.status === 'requesting' || runtime.activeNode?.isTyping) return false;
      return runtime.activeQuestionId === runtime.topId;
    }

    function canResetMainQuestionTree() {
      if (isBlockingPhase(machine.phase)) return false;
      const runtime = readRuntimeSnapshot();
      // Compatibility name: this now means the bottom action may return to
      // the history list. The condition is intentionally based on the
      // normalized open question stack, not specifically on whether Q0/root
      // has been popped. As long as any question remains in the current main
      // stack, Enter / bottom action should keep behaving as pop/send.
      return Boolean(
        runtime.hasMainQuestion
        && runtime.root
        && runtime.stackSize === 0
        && !runtime.isRequesting
        && !isResetting?.()
      );
    }

    const applyShellDataset = () => {
      if (!shell) return;
      shell.dataset.stackPhase = machine.phase;
      shell.dataset.stackEvent = machine.lastEvent;
      shell.dataset.canResetMain = String(canResetMainQuestionTree());
      shell.dataset.canPopActive = String(canPopActiveNode());
    };

    const transition = (event = Event.REFRESH, meta = {}) => {
      const previous = machine.phase;
      machine.previousPhase = previous;
      machine.lastEvent = event;
      machine.phase = derivePhase();
      if (previous !== machine.phase || meta.forceChangedAt) {
        machine.lastChangedAt = Date.now();
      }
      syncStateShape();
      applyShellDataset();
      return machine.phase;
    };

    const refresh = () => transition(Event.REFRESH);

    transition(Event.INIT, { forceChangedAt: true });

    return {
      Phase,
      Event,
      get phase() {
        return machine.phase;
      },
      get previousPhase() {
        return machine.previousPhase;
      },
      get lastEvent() {
        return machine.lastEvent;
      },
      derivePhase,
      transition,
      refresh,
      canSendPrompt,
      canCreateMainQuestion,
      canCreateFollowUpQuestion,
      canPopActiveNode,
      canResetMainQuestionTree,
      isBlocking: () => isBlockingPhase(machine.phase),
      snapshot: () => ({ ...machine }),
    };
  };

  window.LearningStackStateMachine = {
    Phase,
    Event,
    createLearningStackStateMachine,
  };
}());
