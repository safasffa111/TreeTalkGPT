(function () {
  const createWorkbenchGraphRenderer = ({
    graphViewport,
    graphCanvas,
    graphEdges,
    graphNodes,
    state,
    findNode,
    getStackTopId,
    compactQuestionTitle,
    onOpenNode,
    appStore,
  } = {}) => {
    const graphNodeWidth = 178;
    const graphNodeHeight = 112;
    const graphCanvasSize = 1800;
    const graphHorizontalGap = 286;
    const graphVerticalGap = 176;
    const graphPaddingX = 30;
    const graphPaddingY = 48;
    let graphPanState = null;
    let viewportHandlersAttached = false;
    let lastLayoutSignature = '';
    let lastLayoutBounds = null;
    let lastLayoutPositionsRef = null;
    let lastCanvasSize = '';
    let lastTransform = '';
    const graphNodeCache = new Map();
    const graphEdgeCache = new Map();
    let emptyElement = null;
    let lastRenderedSessionId = null;

    const createDefaultGraphState = () => (
      window.AppStore?.createDefaultGraphViewportState?.()
      || window.StackStateUtils?.createGraphState?.()
      || { scale: 1, x: 18, y: 18, positions: {}, manualPositions: {} }
    );

    const getGraphState = () => {
      const storeGraph = appStore?.getGraphViewport?.();
      if (storeGraph) return storeGraph;
      if (!state) return createDefaultGraphState();
      if (!state.graph) state.graph = createDefaultGraphState();
      return state.graph;
    };

    const stableGraphValue = (value) => {
      if (!value || typeof value !== 'object') return value;
      try {
        return JSON.stringify(value);
      } catch (_) {
        return String(value);
      }
    };

    const isGraphPatchNoop = (currentGraph, patch = {}) => {
      const keys = Object.keys(patch || {});
      if (!keys.length) return true;
      return keys.every((key) => {
        if (key === 'positions' || key === 'manualPositions') {
          return stableGraphValue(currentGraph?.[key] || {}) === stableGraphValue(patch[key] || {});
        }
        return Object.is(currentGraph?.[key], patch[key]);
      });
    };

    const commitGraphPatch = (patch = {}, meta = {}) => {
      if (!patch || typeof patch !== 'object') return getGraphState();
      const currentGraph = getGraphState();
      if (isGraphPatchNoop(currentGraph, patch)) return currentGraph;
      if (appStore?.setGraphViewport) {
        appStore.setGraphViewport(patch, { source: 'graph-renderer', ...meta });
        return appStore.getGraphViewport?.() || getGraphState();
      }
      if (state) {
        state.graph = { ...(state.graph || createDefaultGraphState()), ...patch };
      }
      return getGraphState();
    };

    const getRenderNodes = () => {
      const nodes = appStore?.getLearningNodes?.();
      if (Array.isArray(nodes)) return nodes;
      return Array.isArray(state?.nodes) ? state.nodes : [];
    };

    const getRootNodes = () => {
      const nodes = appStore?.getRootLearningNodes?.();
      if (Array.isArray(nodes)) return nodes;
      return getRenderNodes().filter((node) => !node.parentId);
    };

    const getRenderNode = (nodeId) => {
      if (!nodeId) return null;
      return appStore?.getLearningNode?.(nodeId) || findNode?.(nodeId) || null;
    };

    const getActiveQuestionId = () => appStore?.select?.('activeQuestionId', null) ?? state?.activeQuestionId ?? null;
    const getSessionId = () => String(appStore?.select?.('learningData', null)?.sessionId || state?.sessionId || '');

    const getStackTopQuestionId = () => appStore?.select?.('stackTopId', null) ?? getStackTopId?.() ?? null;

    const clampGraphScale = (value) => Math.min(1.75, Math.max(0.46, value));

    const syncTransform = () => {
      if (!graphCanvas) return;
      const graph = getGraphState();
      const scale = clampGraphScale(graph.scale || 1);
      if (scale !== graph.scale) {
        commitGraphPatch({ scale }, { action: 'clamp-scale' });
      }
      const transform = `translate(${graph.x || 0}px, ${graph.y || 0}px) scale(${scale})`;
      if (transform !== lastTransform) {
        graphCanvas.style.transform = transform;
        lastTransform = transform;
      }
    };

    const updateCanvasSize = (layoutBounds = null) => {
      if (!graphCanvas || !graphEdges) return;
      const width = Math.max(graphCanvasSize, (layoutBounds?.maxX || 0) + 240);
      const height = Math.max(graphCanvasSize, (layoutBounds?.maxY || 0) + 220);
      const sizeKey = `${width}x${height}`;
      if (sizeKey === lastCanvasSize) return;
      lastCanvasSize = sizeKey;
      graphCanvas.style.width = `${width}px`;
      graphCanvas.style.height = `${height}px`;
      graphEdges.setAttribute('width', String(width));
      graphEdges.setAttribute('height', String(height));
      graphEdges.style.width = `${width}px`;
      graphEdges.style.height = `${height}px`;
    };

    const ensureLayout = () => {
      const renderNodes = getRenderNodes();
      const sessionId = getSessionId();
      const structureSignature = `${sessionId}::${renderNodes
        .map((node) => `${node.id || ''}:${node.parentId || ''}:${(node.children || []).join(',')}`)
        .join('|')}`;
      const currentPositions = getGraphState()?.positions || {};
      const hasCompletePositions = renderNodes.every((node) => {
        const position = currentPositions[node.id];
        return Number.isFinite(Number(position?.x)) && Number.isFinite(Number(position?.y));
      });
      if (structureSignature === lastLayoutSignature && lastLayoutBounds && hasCompletePositions) {
        if (currentPositions !== lastLayoutPositionsRef) {
          let maxX = 0;
          let maxY = 0;
          renderNodes.forEach((node) => {
            const position = currentPositions[node.id];
            maxX = Math.max(maxX, Number(position.x) + graphNodeWidth);
            maxY = Math.max(maxY, Number(position.y) + graphNodeHeight);
          });
          lastLayoutBounds = { ...lastLayoutBounds, maxX, maxY };
          lastLayoutPositionsRef = currentPositions;
        }
        return lastLayoutBounds;
      }
      const nextPositions = {};
      let maxDepth = 0;
      let leafCursor = 0;

      const roots = getRootNodes();

      const layoutNode = (nodeId, depth = 0) => {
        const node = getRenderNode(nodeId);
        if (!node) return leafCursor;

        maxDepth = Math.max(maxDepth, depth);
        const children = (node.children || []).filter((childId) => getRenderNode(childId));

        let y;
        if (!children.length) {
          y = leafCursor;
          leafCursor += graphVerticalGap;
        } else {
          const childYs = children.map((childId) => layoutNode(childId, depth + 1));
          const firstChildY = childYs[0] ?? leafCursor;
          const lastChildY = childYs[childYs.length - 1] ?? firstChildY;
          y = (firstChildY + lastChildY) / 2;
        }

        nextPositions[nodeId] = {
          x: depth * graphHorizontalGap,
          y,
        };
        return y;
      };

      roots.forEach((root, index) => {
        if (index > 0) leafCursor += graphVerticalGap * 0.8;
        layoutNode(root.id, 0);
      });

      let minY = Infinity;
      let maxX = 0;
      let maxY = 0;
      Object.values(nextPositions).forEach((pos) => {
        minY = Math.min(minY, pos.y);
      });
      if (!Number.isFinite(minY)) minY = 0;

      Object.keys(nextPositions).forEach((nodeId) => {
        const pos = nextPositions[nodeId];
        pos.x += graphPaddingX;
        pos.y = pos.y - minY + graphPaddingY;
        maxX = Math.max(maxX, pos.x + graphNodeWidth);
        maxY = Math.max(maxY, pos.y + graphNodeHeight);
      });

      commitGraphPatch({ positions: nextPositions, manualPositions: {} }, { action: 'layout' });

      lastLayoutSignature = structureSignature;
      lastLayoutPositionsRef = getGraphState()?.positions || nextPositions;
      lastLayoutBounds = { maxX, maxY, maxDepth, rows: Math.max(0, leafCursor / graphVerticalGap) };
      return lastLayoutBounds;
    };

    const graphPoint = (nodeId, side = 'right') => {
      const graph = getGraphState();
      const pos = graph.positions?.[nodeId] || { x: 0, y: 0 };
      if (side === 'left') {
        return { x: pos.x, y: pos.y + graphNodeHeight / 2 };
      }
      return { x: pos.x + graphNodeWidth, y: pos.y + graphNodeHeight / 2 };
    };

    const renderEdgeLayer = (recentNodeEnterIds = new Set()) => {
      if (!graphEdges) return;
      const svgNs = 'http://www.w3.org/2000/svg';
      const liveEdgeIds = new Set();

      getRenderNodes().forEach((node) => {
        (node.children || []).forEach((childId) => {
          const childNode = getRenderNode(childId);
          if (!childNode) return;
          const parentPoint = graphPoint(node.id, 'right');
          const childPoint = graphPoint(childId, 'left');
          const gapX = Math.max(52, childPoint.x - parentPoint.x);
          const midX = parentPoint.x + gapX * 0.52;
          const edgeId = `${node.id}->${childId}`;
          liveEdgeIds.add(edgeId);
          let cached = graphEdgeCache.get(edgeId);
          if (!cached) {
            const path = document.createElementNS(svgNs, 'path');
            cached = { path, lastKey: '' };
            graphEdgeCache.set(edgeId, cached);
            graphEdges.appendChild(path);
          }
          const { path } = cached;
          const edgeClass = [
            'graph-edge-path',
            childNode.stackStatus === 'done' ? 'is-done' : '',
            recentNodeEnterIds.has(childId) ? 'is-node-enter' : '',
          ].filter(Boolean).join(' ');
          const pathData = `M ${parentPoint.x} ${parentPoint.y} C ${midX} ${parentPoint.y}, ${midX} ${childPoint.y}, ${childPoint.x} ${childPoint.y}`;
          const key = `${edgeClass}|${pathData}`;
          if (cached.lastKey !== key) {
            path.setAttribute('class', edgeClass);
            path.setAttribute('d', pathData);
            cached.lastKey = key;
          }
        });
      });
      graphEdgeCache.forEach((cached, edgeId) => {
        if (liveEdgeIds.has(edgeId)) return;
        cached.path.remove?.();
        graphEdgeCache.delete(edgeId);
      });
    };

    const createGraphNode = (nodeId) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'graph-node';
      button.dataset.nodeId = nodeId;
      const title = document.createElement('span');
      title.className = 'graph-node-title';
      button.appendChild(title);
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('pointerup', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenNode?.(nodeId);
      });
      return { button, title, lastKey: '' };
    };

    const render = ({ recentNodeEnterIds = new Set() } = {}) => {
      if (!graphViewport || !graphCanvas || !graphEdges || !graphNodes) return;
      const sessionId = getSessionId();
      if (lastRenderedSessionId !== null && sessionId !== lastRenderedSessionId) {
        graphNodeCache.forEach(({ button }) => button.remove?.());
        graphNodeCache.clear();
        graphEdgeCache.forEach(({ path }) => path.remove?.());
        graphEdgeCache.clear();
        emptyElement?.remove?.();
      }
      lastRenderedSessionId = sessionId;

      const bounds = ensureLayout();
      updateCanvasSize(bounds);

      const nodes = getRenderNodes();
      if (!nodes.length) {
        graphNodeCache.forEach(({ button }) => button.remove?.());
        graphNodeCache.clear();
        graphEdgeCache.forEach(({ path }) => path.remove?.());
        graphEdgeCache.clear();
        if (!emptyElement) {
          emptyElement = document.createElement('div');
          emptyElement.className = 'graph-empty';
          emptyElement.textContent = '提出主问题后，问题会按父子关系以图块形式出现在这里。滚轮缩放，拖动画布移动。';
        }
        if (emptyElement.parentNode !== graphNodes) graphNodes.appendChild(emptyElement);
        syncTransform();
        return;
      }

      emptyElement?.remove?.();

      renderEdgeLayer(recentNodeEnterIds);

      const graph = getGraphState();
      const liveNodeIds = new Set();
      nodes.forEach((node, index) => {
        liveNodeIds.add(node.id);
        const pos = graph.positions?.[node.id] || { x: 0, y: 0 };
        let cached = graphNodeCache.get(node.id);
        if (!cached) {
          cached = createGraphNode(node.id);
          graphNodeCache.set(node.id, cached);
        }
        const { button, title } = cached;
        const compactTitle = compactQuestionTitle?.(node.question) || node.question || node.id;
        const isActive = node.id === getActiveQuestionId();
        const isDone = node.stackStatus === 'done';
        const isStackTop = node.id === getStackTopQuestionId();
        const isEntering = recentNodeEnterIds.has(node.id);
        const key = `${pos.x}|${pos.y}|${node.question || ''}|${compactTitle}|${isActive ? 1 : 0}|${isDone ? 1 : 0}|${isStackTop ? 1 : 0}|${isEntering ? 1 : 0}`;
        if (cached.lastKey !== key) {
          button.style.left = `${pos.x}px`;
          button.style.top = `${pos.y}px`;
          button.title = node.question || node.id;
          button.setAttribute('aria-label', `${node.id} ${node.question || ''}`.trim());
          button.classList.toggle('is-active', isActive);
          button.classList.toggle('is-done', isDone);
          button.classList.toggle('is-stack-top', isStackTop);
          button.classList.toggle('is-node-enter', isEntering);
          title.textContent = compactTitle;
          cached.lastKey = key;
        }
        const currentAtIndex = graphNodes.children?.[index];
        if (currentAtIndex !== button) graphNodes.insertBefore(button, currentAtIndex || null);
      });
      graphNodeCache.forEach((cached, nodeId) => {
        if (liveNodeIds.has(nodeId)) return;
        cached.button.remove?.();
        graphNodeCache.delete(nodeId);
      });

      syncTransform();
    };

    const attachViewportHandlers = () => {
      if (!graphViewport || viewportHandlersAttached) return;
      viewportHandlersAttached = true;

      graphViewport.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target?.closest?.('.graph-node')) return;
        const graph = getGraphState();
        graphPanState = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: graph.x || 0,
          originY: graph.y || 0,
        };
        graphViewport.classList.add('is-panning');
        graphViewport.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });

      graphViewport.addEventListener('pointermove', (event) => {
        if (!graphPanState || graphPanState.pointerId !== event.pointerId) return;
        commitGraphPatch({
          x: graphPanState.originX + event.clientX - graphPanState.startX,
          y: graphPanState.originY + event.clientY - graphPanState.startY,
        }, { action: 'pan' });
        syncTransform();
      });

      const endGraphPan = (event) => {
        if (!graphPanState || graphPanState.pointerId !== event.pointerId) return;
        graphViewport.classList.remove('is-panning');
        graphViewport.releasePointerCapture?.(event.pointerId);
        graphPanState = null;
      };

      graphViewport.addEventListener('pointerup', endGraphPan);
      graphViewport.addEventListener('pointercancel', endGraphPan);
      graphViewport.addEventListener('wheel', (event) => {
        event.preventDefault();
        const rect = graphViewport.getBoundingClientRect();
        const graph = getGraphState();
        const oldScale = clampGraphScale(graph.scale || 1);
        const zoomFactor = event.deltaY < 0 ? 1.08 : 0.925;
        const newScale = clampGraphScale(oldScale * zoomFactor);
        const cursorX = event.clientX - rect.left;
        const cursorY = event.clientY - rect.top;
        const worldX = (cursorX - (graph.x || 0)) / oldScale;
        const worldY = (cursorY - (graph.y || 0)) / oldScale;
        commitGraphPatch({
          scale: newScale,
          x: cursorX - worldX * newScale,
          y: cursorY - worldY * newScale,
        }, { action: 'zoom' });
        syncTransform();
      }, { passive: false });
    };

    return {
      render,
      syncTransform,
      attachViewportHandlers,
      clampGraphScale,
    };
  };

  window.GraphRenderer = {
    createWorkbenchGraphRenderer,
  };
}());
