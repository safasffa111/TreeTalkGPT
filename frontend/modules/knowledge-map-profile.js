// Knowledge warehouse spatial map controller.
//
// Redesign notes:
// - This module is a warehouse-only spatial file system. It never touches the
//   workbench stack, workbench history, or a knowledge file's internal Q0/Q1 tree.
// - Rendering is intentionally separated from layout settling. Mouse movement
//   must not recalculate folder geometry, otherwise folder regions drift while
//   files are being dragged.
// - Folder regions are stable containers. Their size is settled from child count
//   and child positions at safe moments: initialization, focus, store sync, and
//   drag end.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ROOT_ID = 'root';
  const LAYOUT_VERSION = 17;

  const MIN_DRAG_DISTANCE = 4;
  const FILE_RADIUS = 5;
  const FILE_CLUSTER_GAP = 14;
  const FILE_REPEL_DISTANCE = 30;
  const FILE_REPEL_STRENGTH = 0.48;
  const FORCE_LAYOUT_PASSES = 72;
  const FORCE_LAYOUT_DAMPING = 0.76;
  const FORCE_LAYOUT_MAX_STEP = 18;
  const FILE_BODY_RX = 11;
  const FILE_BODY_RY = 11;
  const FOLDER_BODY_PADDING_X = 22;
  const FOLDER_BODY_PADDING_Y = 16;
  const FOLDER_REPEL_PADDING_X = 24;
  const FOLDER_REPEL_PADDING_Y = 18;
  const FOLDER_REPEL_PASSES = 58;
  const FOLDER_REPEL_MAX_STEP = 14;
  const FOLDER_REPEL_DAMPING = 0.72;
  const FOLDER_EDGE_PADDING = 22;
  const FILE_EDGE_PADDING = 15;
  const ROOT_WORLD_MIN_RX = 1500;
  const ROOT_WORLD_MIN_RY = 960;
  const FREE_FOLDER_MIN_RX = 58;
  const FREE_FOLDER_MIN_RY = 38;
  const FOLDER_DOUBLE_CLICK_MS = 420;
  const FOLDER_DOUBLE_CLICK_DISTANCE = 22;
  const FILE_DOUBLE_CLICK_MS = 360;
  const FILE_DOUBLE_CLICK_DISTANCE = 18;

  const VISUAL_SETTLE_EPSILON = 0.08;
  const VISUAL_FOLDER_EASE_MS = 210;
  const VISUAL_FILE_EASE_MS = 145;
  const VISUAL_CLUSTER_FORM_EASE_MS = 205;
  const VISUAL_PULSE_MS = 640;
  const DELETE_ANIMATION_MS = 320;
  const MAP_TO_FILE_LEAVE_MS = 360;
  const DROP_ENTER_PADDING = 5;
  const DROP_EXIT_PADDING = 20;
  const DROP_SWITCH_DISTANCE = 10;
  const DRAG_PRESSURE_DISTANCE = 46;
  const DRAG_PRESSURE_MAX_OFFSET = 13;
  const FILE_DISTRIBUTION_MIN_CANDIDATES = 72;
  const FILE_DISTRIBUTION_MAX_CANDIDATES = 360;
  const FILE_DISTRIBUTION_ANCHOR_PULL = 0.0108;
  const FILE_DISTRIBUTION_EDGE_MARGIN = 18;
  const FILE_ANCHOR_GREEDY_LIMIT = 0;
  const FILE_PAIRWISE_GRID_LIMIT = 36;
  const RENDER_FILE_CULL_MARGIN_PX = 160;
  const RENDER_FOLDER_CULL_MARGIN_PX = 260;
  const VISUAL_ANIMATION_CULL_MARGIN_PX = 260;
  const DRAG_PRESSURE_CLUSTER_LIMIT = 10;
  const DRAG_PRESSURE_PARENT_FILE_LIMIT = 90;


  // Chromium can exceed tile memory when an SVG path/filter covers an area far
  // larger than the visible content panel. These thresholds keep rendering
  // visually equivalent while capping the painted geometry to the viewport.
  const FOLDER_SAFE_RENDER_MARGIN_PX = 120;
  const FOLDER_SAFE_SURFACE_MARGIN_PX = 32;
  const FOLDER_SAFE_SURFACE_AREA_RATIO = 1.08;
  const FOLDER_SAFE_SURFACE_DIM_RATIO = 1.20;

  const FOLDER_SHAPE_POINTS = 72;
  const FOLDER_SHAPE_SMOOTH_PASSES = 4;
  const FOLDER_SHAPE_MAX_BULGE = 0.165;
  const FOLDER_CONTENT_PADDING_X = 24;
  const FOLDER_CONTENT_PADDING_Y = 18;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => Number(a || 0) + (Number(b || 0) - Number(a || 0)) * t;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wait = (ms = 0) => new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = window.setTimeout?.(resolve, ms);
    if (!timer) resolve();
  });

  const createSvg = (tag, className = '') => {
    const node = document.createElementNS(SVG_NS, tag);
    if (className) node.setAttribute('class', className);
    return node;
  };

  const hashString = (value = '') => {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  };

  const colorForId = (id = '') => {
    const hash = hashString(id);
    const hue = hash % 360;
    const sat = 56 + (hash % 18);
    const light = 48 + (hash % 12);
    return `hsl(${hue} ${sat}% ${light}%)`;
  };

  const getItems = (store = {}) => (Array.isArray(store.items) ? store.items : []);
  const isFile = (item) => item && item.type === 'file';
  const isFolder = (item) => item && item.type !== 'file';

  let activeStoreIndex = null;

  const buildStoreIndex = (store = {}) => {
    const items = getItems(store);
    const byId = new Map();
    const childrenByParent = new Map();
    const filesByParent = new Map();
    const foldersByParent = new Map();
    items.forEach((item) => {
      if (!item || !item.id) return;
      byId.set(item.id, item);
      const parentId = item.parentId || ROOT_ID;
      if (item.id === parentId) return;
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(item);
      if (isFile(item)) {
        if (!filesByParent.has(parentId)) filesByParent.set(parentId, []);
        filesByParent.get(parentId).push(item);
      } else {
        if (!foldersByParent.has(parentId)) foldersByParent.set(parentId, []);
        foldersByParent.get(parentId).push(item);
      }
    });
    return { store, items, byId, childrenByParent, filesByParent, foldersByParent };
  };

  const withStoreIndex = (store, callback) => {
    const previous = activeStoreIndex;
    activeStoreIndex = buildStoreIndex(store);
    try {
      return callback(activeStoreIndex);
    } finally {
      activeStoreIndex = previous;
    }
  };

  const getIndexedChildren = (store, folderId = ROOT_ID, kind = 'all') => {
    const index = activeStoreIndex && activeStoreIndex.store === store ? activeStoreIndex : null;
    if (!index) return null;
    if (kind === 'file') return index.filesByParent.get(folderId) || [];
    if (kind === 'folder') return index.foldersByParent.get(folderId) || [];
    return index.childrenByParent.get(folderId) || [];
  };

  const getItem = (store, id) => {
    const index = activeStoreIndex && activeStoreIndex.store === store ? activeStoreIndex : null;
    return (index ? index.byId.get(id) : getItems(store).find((item) => item?.id === id)) || null;
  };

  const getChildren = (store, folderId = ROOT_ID) => getIndexedChildren(store, folderId, 'all')
    || getItems(store).filter((item) => item && item.id !== folderId && item.parentId === folderId);

  const getFileChildren = (store, folderId = ROOT_ID) => getIndexedChildren(store, folderId, 'file')
    || getChildren(store, folderId).filter(isFile);

  const getFolderChildren = (store, folderId = ROOT_ID) => getIndexedChildren(store, folderId, 'folder')
    || getChildren(store, folderId).filter(isFolder);

  const makeLayoutSignature = (store = {}) => {
    const parts = getItems(store)
      .map((item) => `${item?.id || ''}:${item?.type || ''}:${item?.parentId || ROOT_ID}`)
      .sort();
    let hash = 2166136261;
    parts.forEach((part) => {
      for (let i = 0; i < part.length; i += 1) {
        hash ^= part.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      hash ^= 124;
      hash = Math.imul(hash, 16777619);
    });
    return `${parts.length}:${hash >>> 0}`;
  };

  const getDepth = (store, itemId) => {
    let depth = 0;
    let current = getItem(store, itemId);
    const guard = new Set();
    while (current && current.parentId && !guard.has(current.id)) {
      guard.add(current.id);
      current = getItem(store, current.parentId);
      if (current) depth += 1;
    }
    return depth;
  };

  const collectDescendants = (store, folderId) => {
    const result = new Set();
    const visit = (id) => {
      getChildren(store, id).forEach((child) => {
        if (!child || result.has(child.id)) return;
        result.add(child.id);
        if (isFolder(child)) visit(child.id);
      });
    };
    visit(folderId);
    return result;
  };

  const normalizeViewport = (viewport = {}) => ({
    x: Number.isFinite(Number(viewport.x)) ? Number(viewport.x) : 0,
    y: Number.isFinite(Number(viewport.y)) ? Number(viewport.y) : 0,
    scale: Number.isFinite(Number(viewport.scale)) ? clamp(Number(viewport.scale), 0.18, 2.8) : 1,
    // Once the user manually pans or zooms the warehouse map, routine store
    // syncs must preserve that viewpoint. Explicit folder navigation can still
    // request a forced focus.
    userControlled: Boolean(viewport.userControlled),
    focusedFolderId: String(viewport.focusedFolderId || ''),
    updatedAt: Number.isFinite(Number(viewport.updatedAt)) ? Number(viewport.updatedAt) : 0,
  });

  const cloneFolderLayout = (folder = {}) => ({
    x: Number(folder.x || 0),
    y: Number(folder.y || 0),
    rx: Number(folder.rx || 1),
    ry: Number(folder.ry || 1),
    color: folder.color,
    seed: Number(folder.seed || 1),
    manual: Boolean(folder.manual),
  });

  const normalizeFolderSize = (rx, ry, options = {}) => {
    const minRx = Number(options.minRx || 96);
    const minRy = Number(options.minRy || 64);
    const minAspect = Number(options.minAspect || 1.04);
    const maxAspect = Number(options.maxAspect || 2.18);
    let nextRx = Math.max(minRx, Number(rx || minRx));
    let nextRy = Math.max(minRy, Number(ry || minRy));
    const area = Math.max(minRx * minRy, nextRx * nextRy);
    const aspect = nextRx / Math.max(1, nextRy);
    if (aspect > maxAspect) {
      nextRx = Math.sqrt(area * maxAspect);
      nextRy = nextRx / maxAspect;
    } else if (aspect < minAspect) {
      nextRy = Math.sqrt(area / minAspect);
      nextRx = nextRy * minAspect;
    }
    return {
      rx: Math.max(minRx, nextRx),
      ry: Math.max(minRy, nextRy),
    };
  };

  const estimateBaseFolderSize = (store, folderId) => {
    const directChildren = getChildren(store, folderId);
    const directFiles = directChildren.filter(isFile).length;
    const directFolders = directChildren.filter(isFolder).length;
    const totalItems = getItems(store).length;

    // Root is no longer a visible folder region. It is only a virtual world
    // field used for root-file packing, panning focus, and drop-to-warehouse.
    // The warehouse itself occupies the whole graph, so this should be large
    // and calm rather than a visible parent blob.
    if (folderId === ROOT_ID) {
      const weight = Math.sqrt(Math.max(1, directFiles + directFolders * 2.8 + totalItems * 0.35));
      return normalizeFolderSize(
        Math.max(ROOT_WORLD_MIN_RX, ROOT_WORLD_MIN_RX + weight * 74),
        Math.max(ROOT_WORLD_MIN_RY, ROOT_WORLD_MIN_RY + weight * 48),
        { minRx: ROOT_WORLD_MIN_RX, minRy: ROOT_WORLD_MIN_RY, minAspect: 1.16, maxAspect: 2.18 },
      );
    }

    // Normal folders are free visual containers. They do not participate in a
    // folder-vs-folder auto layout. Their size should be compact: an empty
    // folder starts small, and only direct file capacity expands it.
    const fileCapacity = Math.sqrt(Math.max(0, directFiles));
    const rx = FREE_FOLDER_MIN_RX + fileCapacity * 18;
    const ry = FREE_FOLDER_MIN_RY + fileCapacity * 12.5;
    return normalizeFolderSize(rx, ry, {
      minRx: FREE_FOLDER_MIN_RX,
      minRy: FREE_FOLDER_MIN_RY,
      minAspect: 1.10,
      maxAspect: 1.82,
    });
  };

  const estimateCapacityFolderSize = (store, layout, folderId) => {
    const children = getChildren(store, folderId);
    if (!children.length) return null;

    let bodyArea = 0;
    let weightedAspect = 0;
    let bodies = 0;

    children.forEach((child) => {
      if (isFile(child)) {
        const rx = FILE_BODY_RX + 5;
        const ry = FILE_BODY_RY + 5;
        bodyArea += Math.PI * rx * ry;
        weightedAspect += 1.05;
        bodies += 1;
        return;
      }
      const folder = layout?.folders?.[child.id];
      const rx = Math.max(44, Number(folder?.rx || 76) + FOLDER_BODY_PADDING_X * 0.62);
      const ry = Math.max(34, Number(folder?.ry || 54) + FOLDER_BODY_PADDING_Y * 0.62);
      bodyArea += Math.PI * rx * ry;
      weightedAspect += rx / Math.max(1, ry);
      bodies += 1;
    });

    if (!bodies) return null;
    const childFolders = children.filter(isFolder).length;
    const childFiles = children.filter(isFile).length;
    const packingSlack = folderId === ROOT_ID ? 1.46 : 1.20;
    const whitespace = folderId === ROOT_ID
      ? 4800 + bodies * 540 + childFolders * 1550
      : 760 + bodies * 145 + childFolders * 620 + Math.sqrt(Math.max(1, childFiles)) * 90;
    const targetArea = bodyArea * packingSlack + whitespace;
    const measuredAspect = weightedAspect / Math.max(1, bodies);
    const aspect = clamp(
      measuredAspect,
      folderId === ROOT_ID ? 1.22 : 1.08,
      folderId === ROOT_ID ? 1.92 : 1.78,
    );
    const ry = Math.sqrt(targetArea / (Math.PI * aspect));
    const rx = ry * aspect;

    return normalizeFolderSize(rx, ry, folderId === ROOT_ID
      ? { minRx: 900, minRy: 580, minAspect: 1.18, maxAspect: 2.05 }
      : { minRx: 74, minRy: 50, minAspect: 1.04, maxAspect: 2.05 });
  };

  const seededAngle = (id, index, total) => {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const hash = hashString(id);
    return (index * golden + (hash % 628) / 100) % (Math.PI * 2);
  };

  const placeInside = (parent, id, index, total, spread = 0.55) => {
    const angle = seededAngle(id, index, Math.max(1, total));
    const hash = hashString(id);
    const ring = 0.20 + ((hash % 100) / 100) * spread;
    return {
      x: Number(parent.x || 0) + Math.cos(angle) * Number(parent.rx || 1) * ring,
      y: Number(parent.y || 0) + Math.sin(angle) * Number(parent.ry || 1) * ring,
    };
  };

  const pointInFolder = (folderLayout, x, y, padding = 0) => {
    if (!folderLayout) return false;
    const rx = Math.max(1, Number(folderLayout.rx || 1) + padding);
    const ry = Math.max(1, Number(folderLayout.ry || 1) + padding);
    const dx = Math.abs((Number(x || 0) - Number(folderLayout.x || 0)) / rx);
    const dy = Math.abs((Number(y || 0) - Number(folderLayout.y || 0)) / ry);
    const p = 2.35;
    return Math.pow(dx, p) + Math.pow(dy, p) <= 1;
  };

  const projectPointIntoFolder = (folderLayout, x, y, margin = FILE_EDGE_PADDING) => {
    if (!folderLayout) return { x, y };
    const cx = Number(folderLayout.x || 0);
    const cy = Number(folderLayout.y || 0);
    const rx = Math.max(24, Number(folderLayout.rx || 1) - margin);
    const ry = Math.max(24, Number(folderLayout.ry || 1) - margin);
    const dx = Number(x || 0) - cx;
    const dy = Number(y || 0) - cy;
    const distance = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    if (distance <= 1) return { x: Number(x || 0), y: Number(y || 0) };
    const scale = 0.985 / Math.max(distance, 0.0001);
    return { x: cx + dx * scale, y: cy + dy * scale };
  };

  const clampFolderInsideParent = (child, parent) => {
    if (!child || !parent) return;
    const parentRx = Math.max(1, Number(parent.rx || 1));
    const parentRy = Math.max(1, Number(parent.ry || 1));
    const maxRatio = Math.max(Number(child.rx || 1) / parentRx, Number(child.ry || 1) / parentRy);
    if (maxRatio > 0.80) {
      const scale = 0.80 / maxRatio;
      child.rx = Math.max(64, Number(child.rx || 1) * scale);
      child.ry = Math.max(44, Number(child.ry || 1) * scale);
    }

    const safeRx = Math.max(12, parentRx - Number(child.rx || 1) - FOLDER_EDGE_PADDING * 0.35);
    const safeRy = Math.max(12, parentRy - Number(child.ry || 1) - FOLDER_EDGE_PADDING * 0.35);
    const projected = projectPointIntoFolder(
      { x: parent.x, y: parent.y, rx: safeRx, ry: safeRy },
      child.x,
      child.y,
      0,
    );
    child.x = projected.x;
    child.y = projected.y;
  };

  const getChildBounds = (store, layout, folderId, options = {}) => {
    const skipIds = options.skipIds || new Set();
    const children = getChildren(store, folderId).filter((child) => child && !skipIds.has(child.id));
    if (!children.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    children.forEach((child) => {
      if (isFile(child)) {
        const point = layout.files?.[child.id];
        if (!point) return;
        minX = Math.min(minX, Number(point.x || 0) - 16);
        maxX = Math.max(maxX, Number(point.x || 0) + 16);
        minY = Math.min(minY, Number(point.y || 0) - 14);
        maxY = Math.max(maxY, Number(point.y || 0) + 14);
        count += 1;
        return;
      }
      const folder = layout.folders?.[child.id];
      if (!folder) return;
      minX = Math.min(minX, Number(folder.x || 0) - Number(folder.rx || 1) - 12);
      maxX = Math.max(maxX, Number(folder.x || 0) + Number(folder.rx || 1) + 12);
      minY = Math.min(minY, Number(folder.y || 0) - Number(folder.ry || 1) - 10);
      maxY = Math.max(maxY, Number(folder.y || 0) + Number(folder.ry || 1) + 10);
      count += 1;
    });
    if (!count || !Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      count,
    };
  };

  const foldersByDepth = (store, desc = false) => getItems(store)
    .filter(isFolder)
    .sort((a, b) => {
      const diff = getDepth(store, a.id) - getDepth(store, b.id);
      return desc ? -diff : diff;
    });

  const translateFolderSubtree = (store, layout, folderId, dx, dy) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001)) return;
    collectDescendants(store, folderId).forEach((id) => {
      const item = getItem(store, id);
      if (!item) return;
      const target = isFile(item) ? layout.files?.[id] : layout.folders?.[id];
      if (!target) return;
      target.x = Number(target.x || 0) + dx;
      target.y = Number(target.y || 0) + dy;
    });
  };

  const makeScopedBody = (store, layout, child) => {
    if (!child) return null;
    if (isFile(child)) {
      const point = layout.files?.[child.id];
      if (!point) return null;
      return {
        id: child.id,
        type: 'file',
        item: child,
        layout: point,
        rx: FILE_BODY_RX,
        ry: FILE_BODY_RY,
        mass: 0.74,
        vx: 0,
        vy: 0,
      };
    }
    const folder = layout.folders?.[child.id];
    if (!folder) return null;
    return {
      id: child.id,
      type: 'folder',
      item: child,
      layout: folder,
      // Treat child folders as their full visible region. The older algorithm
      // used a reduced radius, which allowed root files and sibling folders to
      // visually sink into folder regions.
      rx: Math.max(46, Number(folder.rx || 1) + FOLDER_BODY_PADDING_X),
      ry: Math.max(34, Number(folder.ry || 1) + FOLDER_BODY_PADDING_Y),
      mass: Math.max(2.8, Math.sqrt(Math.max(1, Number(folder.rx || 1) * Number(folder.ry || 1))) / 18),
      vx: 0,
      vy: 0,
    };
  };

  const getScopedBodies = (store, layout, folderId) => getChildren(store, folderId)
    .map((child) => makeScopedBody(store, layout, child))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });

  const getBodyAreaSize = (bodies = [], folderId = ROOT_ID) => {
    if (!bodies.length) return null;
    let area = 0;
    let folderCount = 0;
    let fileCount = 0;
    let maxAspect = 1.18;
    bodies.forEach((body) => {
      area += Math.PI * Math.max(1, body.rx) * Math.max(1, body.ry);
      if (body.type === 'folder') folderCount += 1;
      else fileCount += 1;
      maxAspect = Math.max(maxAspect, Math.max(0.72, body.rx / Math.max(1, body.ry)));
    });
    const packingSlack = folderId === ROOT_ID
      ? 1.98
      : clamp(1.24 + folderCount * 0.10 + Math.sqrt(Math.max(0, fileCount)) * 0.018, 1.24, 1.92);
    const air = folderId === ROOT_ID
      ? 26000 + bodies.length * 920 + folderCount * 3600
      : 420 + bodies.length * 52 + folderCount * 250;
    const targetArea = area * packingSlack + air;
    const aspect = folderId === ROOT_ID
      ? clamp(maxAspect * 1.085, 1.22, 1.95)
      : clamp(maxAspect * 0.92, 1.06, 1.72);
    const ry = Math.sqrt(targetArea / (Math.PI * aspect));
    const rx = ry * aspect;
    return normalizeFolderSize(rx, ry, folderId === ROOT_ID
      ? { minRx: 900, minRy: 580, minAspect: 1.18, maxAspect: 2.05 }
      : { minRx: 74, minRy: 50, minAspect: 1.04, maxAspect: 2.05 });
  };

  const bodyDistanceNorm = (a, b) => {
    const dx = Number(b.layout.x || 0) - Number(a.layout.x || 0);
    const dy = Number(b.layout.y || 0) - Number(a.layout.y || 0);
    const gapX = (a.type === 'file' && b.type === 'file') ? 9 : 18;
    const gapY = (a.type === 'file' && b.type === 'file') ? 9 : 15;
    const safeX = Math.max(14, a.rx + b.rx + gapX);
    const safeY = Math.max(14, a.ry + b.ry + gapY);
    return Math.sqrt((dx / safeX) ** 2 + (dy / safeY) ** 2);
  };

  const forEachSpatialPair = (bodies = [], cellSize = 64, callback) => {
    if (!Array.isArray(bodies) || bodies.length < 2) return;
    const bucketSize = Math.max(8, Number(cellSize || 64));
    const buckets = new Map();
    const keyOf = (cx, cy) => `${cx}:${cy}`;
    bodies.forEach((body, index) => {
      const cx = Math.floor(Number(body.layout?.x || 0) / bucketSize);
      const cy = Math.floor(Number(body.layout?.y || 0) / bucketSize);
      const key = keyOf(cx, cy);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(index);
    });
    const seen = new Set();
    buckets.forEach((indices, key) => {
      const [cxRaw, cyRaw] = String(key).split(':');
      const cx = Number(cxRaw);
      const cy = Number(cyRaw);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const other = buckets.get(keyOf(cx + ox, cy + oy));
          if (!other) continue;
          indices.forEach((i) => {
            other.forEach((j) => {
              if (j <= i) return;
              const pairKey = `${i}:${j}`;
              if (seen.has(pairKey)) return;
              seen.add(pairKey);
              callback(bodies[i], bodies[j], i, j);
            });
          });
        }
      }
    });
  };

  const moveScopedBody = (store, layout, body, dx, dy, locked) => {
    if (!body || locked.has(body.id)) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const limitedDx = clamp(dx, -FORCE_LAYOUT_MAX_STEP, FORCE_LAYOUT_MAX_STEP);
    const limitedDy = clamp(dy, -FORCE_LAYOUT_MAX_STEP, FORCE_LAYOUT_MAX_STEP);
    body.layout.x = Number(body.layout.x || 0) + limitedDx;
    body.layout.y = Number(body.layout.y || 0) + limitedDy;
    if (body.type === 'folder') translateFolderSubtree(store, layout, body.id, limitedDx, limitedDy);
  };

  const seedBodiesInContainer = (store, layout, bodies, parent, locked) => {
    if (!parent || bodies.length <= 0) return;
    let needsSeed = false;
    for (let i = 0; i < bodies.length; i += 1) {
      const body = bodies[i];
      if (locked.has(body.id)) continue;
      if (!pointInFolder(parent, body.layout.x, body.layout.y, -(Math.max(body.rx, body.ry) * 0.18))) needsSeed = true;
      for (let j = i + 1; j < bodies.length; j += 1) {
        if (bodyDistanceNorm(body, bodies[j]) < 0.22) needsSeed = true;
      }
    }
    if (!needsSeed) return;
    bodies.forEach((body, index) => {
      if (locked.has(body.id)) return;
      const ring = bodies.length <= 1 ? 0 : 0.16 + Math.sqrt((index + 0.75) / Math.max(1, bodies.length)) * 0.56;
      const placed = placeInside(parent, `${body.id}:hierarchical-seed`, index, bodies.length, ring);
      const dx = placed.x - Number(body.layout.x || 0);
      const dy = placed.y - Number(body.layout.y || 0);
      moveScopedBody(store, layout, body, dx, dy, locked);
    });
  };

  const projectBodyCenterIntoParent = (body, parent) => {
    const marginX = body.type === 'folder' ? Math.max(36, body.rx * 0.96) : FILE_EDGE_PADDING;
    const marginY = body.type === 'folder' ? Math.max(30, body.ry * 0.96) : FILE_EDGE_PADDING;
    const safeParent = {
      x: parent.x,
      y: parent.y,
      rx: Math.max(24, Number(parent.rx || 1) - marginX),
      ry: Math.max(24, Number(parent.ry || 1) - marginY),
    };
    return projectPointIntoFolder(safeParent, body.layout.x, body.layout.y, 0);
  };

  const settleScopedBodiesInFolder = (store, layout, folderId, options = {}) => {
    const locked = options.lockedIds || new Set();
    const parent = layout.folders?.[folderId] || layout.folders?.[ROOT_ID];
    if (!parent) return;
    const bodies = getScopedBodies(store, layout, folderId);
    if (!bodies.length) return;

    seedBodiesInContainer(store, layout, bodies, parent, locked);
    const passes = Math.max(24, Number(options.passes || FORCE_LAYOUT_PASSES));
    for (let pass = 0; pass < passes; pass += 1) {
      const alpha = Math.pow(1 - pass / Math.max(1, passes), 1.18);
      bodies.forEach((body) => {
        body.vx = 0;
        body.vy = 0;
      });

      for (let i = 0; i < bodies.length; i += 1) {
        const a = bodies[i];
        for (let j = i + 1; j < bodies.length; j += 1) {
          const b = bodies[j];
          const aLocked = locked.has(a.id);
          const bLocked = locked.has(b.id);
          if (aLocked && bLocked) continue;

          let dx = Number(b.layout.x || 0) - Number(a.layout.x || 0);
          let dy = Number(b.layout.y || 0) - Number(a.layout.y || 0);
          let distance = Math.sqrt(dx * dx + dy * dy);
          if (!Number.isFinite(distance) || distance < 0.001) {
            const angle = seededAngle(`${folderId}:${a.id}:${b.id}`, pass, bodies.length + 13);
            dx = Math.cos(angle) * 0.01;
            dy = Math.sin(angle) * 0.01;
            distance = 0.01;
          }
          const dirX = dx / Math.max(0.001, distance);
          const dirY = dy / Math.max(0.001, distance);
          const gapX = (a.type === 'file' && b.type === 'file') ? 10 : 20;
          const gapY = (a.type === 'file' && b.type === 'file') ? 10 : 17;
          const safeX = Math.max(14, a.rx + b.rx + gapX);
          const safeY = Math.max(14, a.ry + b.ry + gapY);
          const norm = Math.sqrt((dx / safeX) ** 2 + (dy / safeY) ** 2);
          if (!Number.isFinite(norm) || norm > 2.20) continue;

          // Soft Obsidian-like charge: collision is strong; near-field charge is
          // gentle. Folders use their true visible radius, so files cannot drift
          // into sibling folder regions.
          const collision = norm < 1 ? Math.pow(1 - norm, 1.42) * 1.05 : 0;
          const charge = norm < 2.20 ? Math.pow((2.20 - norm) / 2.20, 2.35) * 0.17 : 0;
          const force = (collision + charge) * alpha;
          if (force <= 0) continue;
          const aShare = b.mass / Math.max(0.001, a.mass + b.mass);
          const bShare = a.mass / Math.max(0.001, a.mass + b.mass);
          const stepX = Math.min(FORCE_LAYOUT_MAX_STEP, safeX * force * 0.24);
          const stepY = Math.min(FORCE_LAYOUT_MAX_STEP, safeY * force * 0.24);

          if (!aLocked) {
            a.vx -= dirX * stepX * (bLocked ? 1 : aShare);
            a.vy -= dirY * stepY * (bLocked ? 1 : aShare);
          }
          if (!bLocked) {
            b.vx += dirX * stepX * (aLocked ? 1 : bShare);
            b.vy += dirY * stepY * (aLocked ? 1 : bShare);
          }
        }
      }

      bodies.forEach((body) => {
        if (locked.has(body.id)) return;
        const centerPull = body.type === 'folder' ? 0.0028 : 0.0042;
        body.vx += (Number(parent.x || 0) - Number(body.layout.x || 0)) * centerPull * alpha;
        body.vy += (Number(parent.y || 0) - Number(body.layout.y || 0)) * centerPull * alpha;
        const projected = projectBodyCenterIntoParent(body, parent);
        body.vx += (projected.x - Number(body.layout.x || 0)) * 0.58 * alpha;
        body.vy += (projected.y - Number(body.layout.y || 0)) * 0.58 * alpha;
      });

      bodies.forEach((body) => {
        if (locked.has(body.id)) return;
        body.vx = clamp(body.vx * FORCE_LAYOUT_DAMPING, -FORCE_LAYOUT_MAX_STEP, FORCE_LAYOUT_MAX_STEP);
        body.vy = clamp(body.vy * FORCE_LAYOUT_DAMPING, -FORCE_LAYOUT_MAX_STEP, FORCE_LAYOUT_MAX_STEP);
        moveScopedBody(store, layout, body, body.vx, body.vy, locked);
      });
    }

    bodies.forEach((body) => {
      if (locked.has(body.id)) return;
      const projected = projectBodyCenterIntoParent(body, parent);
      moveScopedBody(store, layout, body, projected.x - Number(body.layout.x || 0), projected.y - Number(body.layout.y || 0), locked);
    });
  };

  const resizeFolderFromOwnChildren = (store, layout, folderId, options = {}) => {
    const lockedIds = options.lockedIds || new Set();
    const folderLayout = layout.folders?.[folderId];
    if (!folderLayout) return;
    const base = estimateBaseFolderSize(store, folderId);
    const bodies = getScopedBodies(store, layout, folderId);
    const areaSize = getBodyAreaSize(bodies, folderId);
    const bounds = getChildBounds(store, layout, folderId, { skipIds: lockedIds });
    let targetRx = Math.max(base.rx, areaSize?.rx || 0);
    let targetRy = Math.max(base.ry, areaSize?.ry || 0);
    if (bounds) {
      const childFolders = getFolderChildren(store, folderId).length;
      const paddingX = folderId === ROOT_ID ? 138 : 20 + childFolders * 5 + Math.sqrt(bounds.count) * 2.0;
      const paddingY = folderId === ROOT_ID ? 100 : 15 + childFolders * 4 + Math.sqrt(bounds.count) * 1.6;
      targetRx = Math.max(targetRx, bounds.width / 2 + paddingX);
      targetRy = Math.max(targetRy, bounds.height / 2 + paddingY);
      if (folderId !== ROOT_ID && !folderLayout.manual && !lockedIds.has(folderId)) {
        const dx = (bounds.cx - Number(folderLayout.x || 0)) * 0.16;
        const dy = (bounds.cy - Number(folderLayout.y || 0)) * 0.16;
        folderLayout.x += dx;
        folderLayout.y += dy;
        translateFolderSubtree(store, layout, folderId, dx, dy);
      }
    }

    let normalized = normalizeFolderSize(targetRx, targetRy, folderId === ROOT_ID
      ? { minRx: 900, minRy: 580, minAspect: 1.18, maxAspect: 2.05 }
      : { minRx: 74, minRy: 50, minAspect: 1.04, maxAspect: 1.86 });
    targetRx = normalized.rx;
    targetRy = normalized.ry;

    if (folderId !== ROOT_ID) {
      const parent = layout.folders?.[getItem(store, folderId)?.parentId] || layout.folders?.[ROOT_ID];
      if (parent) {
        targetRx = Math.min(targetRx, Math.max(62, Number(parent.rx || 1) * 0.82));
        targetRy = Math.min(targetRy, Math.max(44, Number(parent.ry || 1) * 0.82));
      }
    }

    const t = folderId === ROOT_ID ? 0.34 : 0.52;
    folderLayout.rx = Math.max(folderId === ROOT_ID ? 900 : 62, lerp(folderLayout.rx, targetRx, t));
    folderLayout.ry = Math.max(folderId === ROOT_ID ? 580 : 44, lerp(folderLayout.ry, targetRy, t));
  };

  const clampDirectChildrenIntoFolder = (store, layout, folderId, options = {}) => {
    const lockedIds = options.lockedIds || new Set();
    const parentLayout = layout.folders?.[folderId];
    if (!parentLayout) return;
    getChildren(store, folderId).forEach((child) => {
      if (!child || lockedIds.has(child.id)) return;
      if (isFile(child)) {
        const point = layout.files?.[child.id];
        if (!point) return;
        const projected = projectPointIntoFolder(parentLayout, point.x, point.y, FILE_EDGE_PADDING);
        point.x = projected.x;
        point.y = projected.y;
        return;
      }
      const childLayout = layout.folders?.[child.id];
      if (!childLayout) return;
      const oldX = Number(childLayout.x || 0);
      const oldY = Number(childLayout.y || 0);
      clampFolderInsideParent(childLayout, parentLayout);
      translateFolderSubtree(store, layout, child.id, Number(childLayout.x || 0) - oldX, Number(childLayout.y || 0) - oldY);
    });
  };

  const getFolderFileCapacitySize = (store, folderId) => {
    const fileCount = getFileChildren(store, folderId).length;
    const base = estimateBaseFolderSize(store, folderId);
    if (folderId === ROOT_ID) return base;
    if (!fileCount) return base;

    // A folder region should be composed by its dots, not inflated into an
    // empty field. Use a compact packing estimate with a small breathing margin.
    // The old formula used a large area slack and then wrapped the already
    // spread-out dot positions, creating a positive feedback loop: bigger region
    // -> wider dot distribution -> even bigger region. This size is independent
    // of current automatic dot positions, so oversized folders can shrink again.
    const dotRadius = FILE_BODY_RX + 5;
    const columns = Math.max(1, Math.ceil(Math.sqrt(fileCount * 1.28)));
    const rows = Math.max(1, Math.ceil(fileCount / columns));
    const spacingX = 24;
    const spacingY = 21;
    const packedRx = Math.max(
      FREE_FOLDER_MIN_RX,
      (columns - 1) * spacingX * 0.52 + dotRadius + 16,
    );
    const packedRy = Math.max(
      FREE_FOLDER_MIN_RY,
      (rows - 1) * spacingY * 0.52 + dotRadius + 14,
    );
    const areaBased = Math.sqrt(fileCount) * 8.5;
    return normalizeFolderSize(
      Math.max(base.rx, packedRx + areaBased * 0.22),
      Math.max(base.ry, packedRy + areaBased * 0.18),
      {
        minRx: FREE_FOLDER_MIN_RX,
        minRy: FREE_FOLDER_MIN_RY,
        minAspect: 0.92,
        maxAspect: 1.86,
      },
    );
  };

  const getFileCloudWrapHint = (store, layout, folderId, folderLayout, base) => {
    const files = getFileChildren(store, folderId)
      .map((file) => layout.files?.[file.id])
      .filter(Boolean);
    if (!files.length) return { rx: base.rx, ry: base.ry };

    // The visible dot cloud can hint at shape, but must not dictate extreme
    // growth. Use a robust percentile, then cap it relative to the compact
    // capacity. This lets folders gently follow a dense point cloud while
    // preventing a few spread-out automatic dots from locking the folder into a
    // huge empty blob.
    const dxs = files.map((point) => Math.abs(Number(point.x || 0) - Number(folderLayout.x || 0))).sort((a, b) => a - b);
    const dys = files.map((point) => Math.abs(Number(point.y || 0) - Number(folderLayout.y || 0))).sort((a, b) => a - b);
    const percentileIndex = Math.max(0, Math.min(dxs.length - 1, Math.floor((dxs.length - 1) * 0.78)));
    const hintRx = dxs[percentileIndex] + FILE_EDGE_PADDING + 6;
    const hintRy = dys[percentileIndex] + FILE_EDGE_PADDING + 5;
    const maxRx = Math.max(base.rx, FREE_FOLDER_MIN_RX) * 1.32 + Math.sqrt(files.length) * 2.5;
    const maxRy = Math.max(base.ry, FREE_FOLDER_MIN_RY) * 1.32 + Math.sqrt(files.length) * 2.0;
    return {
      rx: clamp(hintRx, base.rx, maxRx),
      ry: clamp(hintRy, base.ry, maxRy),
    };
  };

  const getFreeFolderWrapSize = (store, layout, folderId) => {
    const base = getFolderFileCapacitySize(store, folderId);
    if (folderId === ROOT_ID) return base;
    const folderLayout = layout?.folders?.[folderId];
    if (!folderLayout) return base;
    const fileCloudHint = getFileCloudWrapHint(store, layout, folderId, folderLayout, base);
    let targetRx = Math.max(base.rx, fileCloudHint.rx);
    let targetRy = Math.max(base.ry, fileCloudHint.ry);

    // Child folders define hard containment. Direct file dots only provide the
    // compact cloud hint above; using their max coordinates here caused runaway
    // expansion after each automatic distribution pass.
    getFolderChildren(store, folderId).forEach((child) => {
      const childLayout = layout.folders?.[child.id];
      if (!childLayout) return;
      targetRx = Math.max(
        targetRx,
        Math.abs(Number(childLayout.x || 0) - Number(folderLayout.x || 0))
          + Number(childLayout.rx || FREE_FOLDER_MIN_RX)
          + 18,
      );
      targetRy = Math.max(
        targetRy,
        Math.abs(Number(childLayout.y || 0) - Number(folderLayout.y || 0))
          + Number(childLayout.ry || FREE_FOLDER_MIN_RY)
          + 14,
      );
    });

    const directFileCount = getFileChildren(store, folderId).length;
    const directFolderCount = getFolderChildren(store, folderId).length;
    if (directFileCount && directFolderCount) {
      // Minimal coexistence margin: enough separation for dots near subfolders,
      // not an open field around all children.
      const coexistPadding = clamp(Math.sqrt(directFileCount) * 2.8 + Math.sqrt(directFolderCount) * 3.2, 4, 28);
      targetRx += coexistPadding;
      targetRy += coexistPadding * 0.66;
    }

    const normalized = normalizeFolderSize(targetRx, targetRy, {
      minRx: FREE_FOLDER_MIN_RX,
      minRy: FREE_FOLDER_MIN_RY,
      minAspect: 0.62,
      maxAspect: 3.40,
    });
    return {
      rx: Math.max(targetRx, normalized.rx),
      ry: Math.max(targetRy, normalized.ry),
    };
  };

  const updateFreeFolderSizes = (store, layout, options = {}) => {
    const lockedIds = options.lockedIds || new Set();
    // Size must be settled bottom-up: a parent that wraps child folders needs
    // the child's latest visible size before computing its own region.
    foldersByDepth(store, true).forEach((folder) => {
      const folderLayout = layout.folders?.[folder.id];
      if (!folderLayout || lockedIds.has(folder.id)) return;
      const target = getFreeFolderWrapSize(store, layout, folder.id);
      const force = options.force === true || folder.id === ROOT_ID;
      const t = force ? 1 : 0.44;
      folderLayout.rx = lerp(folderLayout.rx, target.rx, t);
      folderLayout.ry = lerp(folderLayout.ry, target.ry, t);
      if (folder.id !== ROOT_ID) {
        folderLayout.rx = Math.max(FREE_FOLDER_MIN_RX, folderLayout.rx);
        folderLayout.ry = Math.max(FREE_FOLDER_MIN_RY, folderLayout.ry);
      }
    });
  };


  const forceFolderWrapContainment = (store, layout, options = {}) => {
    const lockedIds = options.lockedIds || new Set();
    const p = 2.35;

    // Bottom-up: if a deep child folder grows, every ancestor expands around
    // the existing child position. This preserves the user's free placement of
    // folder regions while preventing nested folders from visually bursting out.
    foldersByDepth(store, true).forEach((folder) => {
      const parent = layout.folders?.[folder.id];
      if (!parent || lockedIds.has(folder.id)) return;
      let requiredScale = 1;
      const directChildren = getChildren(store, folder.id);
      directChildren.forEach((child) => {
        if (isFile(child)) {
          // Direct files are projected back into their compact file cloud during
          // file layout. They should not force parent growth by their temporary
          // automatic positions; otherwise a large region never shrinks again.
          return;
        }
        const childLayout = layout.folders?.[child.id];
        if (!childLayout) return;
        const cx = Number(childLayout.x || 0);
        const cy = Number(childLayout.y || 0);
        const rx = Number(childLayout.rx || FREE_FOLDER_MIN_RX) + 24;
        const ry = Number(childLayout.ry || FREE_FOLDER_MIN_RY) + 20;
        const samples = [
          [cx + rx, cy],
          [cx - rx, cy],
          [cx, cy + ry],
          [cx, cy - ry],
          [cx + rx * 0.72, cy + ry * 0.72],
          [cx - rx * 0.72, cy + ry * 0.72],
          [cx + rx * 0.72, cy - ry * 0.72],
          [cx - rx * 0.72, cy - ry * 0.72],
        ];
        samples.forEach(([x, y]) => {
          const dx = Math.abs((Number(x || 0) - Number(parent.x || 0)) / Math.max(1, Number(parent.rx || 1)));
          const dy = Math.abs((Number(y || 0) - Number(parent.y || 0)) / Math.max(1, Number(parent.ry || 1)));
          const score = Math.pow(dx, p) + Math.pow(dy, p);
          if (score > 0.82) requiredScale = Math.max(requiredScale, Math.pow(score / 0.82, 1 / p) * 1.085);
        });
      });
      if (folder.id === ROOT_ID) {
        const directFiles = directChildren.filter(isFile);
        const directFolders = directChildren.filter(isFolder);
        if (directFiles.length && directFolders.length) {
          requiredScale = Math.max(
            requiredScale,
            1.10 + clamp(Math.sqrt(directFiles.length) * 0.006 + Math.sqrt(directFolders.length) * 0.010, 0, 0.18),
          );
          let largestRx = 0;
          let largestRy = 0;
          directFolders.forEach((child) => {
            const childLayout = layout.folders?.[child.id];
            if (!childLayout) return;
            largestRx = Math.max(largestRx, Math.abs(Number(childLayout.x || 0) - Number(parent.x || 0)) + Number(childLayout.rx || 1));
            largestRy = Math.max(largestRy, Math.abs(Number(childLayout.y || 0) - Number(parent.y || 0)) + Number(childLayout.ry || 1));
          });
          parent.rx = Math.max(parent.rx, largestRx + Math.sqrt(directFiles.length) * 24 + 260);
          parent.ry = Math.max(parent.ry, largestRy + Math.sqrt(directFiles.length) * 18 + 190);
        }
      }
      if (requiredScale > 1.001) {
        const maxScale = folder.id === ROOT_ID ? 1.45 : 1.18;
        parent.rx *= clamp(requiredScale, 1, maxScale);
        parent.ry *= clamp(requiredScale, 1, maxScale);
      }
    });
  };

  const forceWrapFolder = (store, layout, folderId, visited = new Set()) => {
    if (!folderId || folderId === ROOT_ID || visited.has(folderId)) return;
    const folderLayout = layout?.folders?.[folderId];
    if (!folderLayout) return;
    visited.add(folderId);
    const target = getFreeFolderWrapSize(store, layout, folderId);
    folderLayout.rx = Math.max(FREE_FOLDER_MIN_RX, target.rx);
    folderLayout.ry = Math.max(FREE_FOLDER_MIN_RY, target.ry);
    const parentId = getItem(store, folderId)?.parentId || ROOT_ID;
    if (parentId && parentId !== ROOT_ID) forceWrapFolder(store, layout, parentId, visited);
  };

  const makeFileBody = (layout, file) => {
    const point = layout.files?.[file.id];
    if (!point) return null;
    return {
      id: file.id,
      layout: point,
      rx: FILE_BODY_RX,
      ry: FILE_BODY_RY,
      vx: 0,
      vy: 0,
    };
  };

  const getFixedFolderObstacles = (store, layout, folderId) => getChildren(store, folderId)
    .filter(isFolder)
    .map((folder) => {
      const region = layout.folders?.[folder.id];
      if (!region) return null;
      return {
        id: folder.id,
        x: Number(region.x || 0),
        y: Number(region.y || 0),
        rx: Math.max(36, Number(region.rx || 1) + FOLDER_BODY_PADDING_X),
        ry: Math.max(28, Number(region.ry || 1) + FOLDER_BODY_PADDING_Y),
      };
    })
    .filter(Boolean);

  const projectFileIntoScope = (fileBody, scope, obstacles = []) => {
    if (!fileBody || !scope) return;

    // Resolve against the parent scope and sibling folder obstacles in several
    // cheap passes. A single pass can push a dot out of one obstacle and into
    // another, especially in dense nested folders.
    for (let pass = 0; pass < 4; pass += 1) {
      const projected = projectPointIntoFolder(scope, fileBody.layout.x, fileBody.layout.y, FILE_EDGE_PADDING);
      fileBody.layout.x = projected.x;
      fileBody.layout.y = projected.y;

      obstacles.forEach((obstacle) => {
        const dx = Number(fileBody.layout.x || 0) - obstacle.x;
        const dy = Number(fileBody.layout.y || 0) - obstacle.y;
        const rx = Math.max(1, obstacle.rx + FILE_BODY_RX + 12);
        const ry = Math.max(1, obstacle.ry + FILE_BODY_RY + 12);
        const norm = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
        if (norm >= 1) return;
        const angle = norm < 0.001 ? seededAngle(`${obstacle.id}:${fileBody.id}:project`, pass, 11) : Math.atan2(dy / ry, dx / rx);
        const targetX = obstacle.x + Math.cos(angle) * rx * 1.075;
        const targetY = obstacle.y + Math.sin(angle) * ry * 1.075;
        fileBody.layout.x = lerp(fileBody.layout.x, targetX, 0.90);
        fileBody.layout.y = lerp(fileBody.layout.y, targetY, 0.90);
      });
    }

    for (let pass = 0; pass < 2; pass += 1) {
      obstacles.forEach((obstacle) => {
        const dx = Number(fileBody.layout.x || 0) - obstacle.x;
        const dy = Number(fileBody.layout.y || 0) - obstacle.y;
        const rx = Math.max(1, obstacle.rx + FILE_BODY_RX + 14);
        const ry = Math.max(1, obstacle.ry + FILE_BODY_RY + 14);
        const norm = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
        if (norm >= 1) return;
        const angle = norm < 0.001 ? seededAngle(`${obstacle.id}:${fileBody.id}:final-project`, pass, 13) : Math.atan2(dy / ry, dx / rx);
        fileBody.layout.x = obstacle.x + Math.cos(angle) * rx * 1.085;
        fileBody.layout.y = obstacle.y + Math.sin(angle) * ry * 1.085;
      });
      const finalPoint = projectPointIntoFolder(scope, fileBody.layout.x, fileBody.layout.y, FILE_EDGE_PADDING);
      fileBody.layout.x = finalPoint.x;
      fileBody.layout.y = finalPoint.y;
    }
  };


  const fileInsideObstacle = (fileBody, obstacles = [], padding = 8) => obstacles.some((obstacle) => (
    pointInFolder(obstacle, fileBody.layout.x, fileBody.layout.y, FILE_BODY_RX + padding)
  ));

  const resolveFileObstacleOverlap = (fileBody, scope, obstacles = [], token = '') => {
    if (!fileBody || !scope || !obstacles.length) return;
    if (!fileInsideObstacle(fileBody, obstacles, 12)) return;
    const primary = obstacles.find((obstacle) => pointInFolder(obstacle, fileBody.layout.x, fileBody.layout.y, FILE_BODY_RX + 12))
      || obstacles[0];
    let best = null;
    let bestScore = Infinity;
    for (let attempt = 0; attempt < 72; attempt += 1) {
      const obstacle = attempt < 48 ? primary : obstacles[attempt % obstacles.length];
      const angle = seededAngle(`${fileBody.id}:${token}:escape`, attempt, 73);
      const ring = 1.10 + Math.floor(attempt / 18) * 0.16;
      const candidate = projectPointIntoFolder(scope,
        obstacle.x + Math.cos(angle) * (obstacle.rx + FILE_BODY_RX + 22) * ring,
        obstacle.y + Math.sin(angle) * (obstacle.ry + FILE_BODY_RY + 22) * ring,
        FILE_EDGE_PADDING,
      );
      const blocked = obstacles.some((other) => pointInFolder(other, candidate.x, candidate.y, FILE_BODY_RX + 12));
      const centerCost = Math.hypot(candidate.x - Number(scope.x || 0), candidate.y - Number(scope.y || 0)) * 0.002;
      const movementCost = Math.hypot(candidate.x - Number(fileBody.layout.x || 0), candidate.y - Number(fileBody.layout.y || 0)) * 0.004;
      const score = (blocked ? 1000 : 0) + centerCost + movementCost + attempt * 0.0008;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
        if (!blocked) break;
      }
    }
    if (best) {
      fileBody.layout.x = best.x;
      fileBody.layout.y = best.y;
    }
  };


  const getObstacleClearance = (obstacle, x, y, padding = 0) => {
    if (!obstacle) return Infinity;
    const rx = Math.max(1, Number(obstacle.rx || 1) + padding);
    const ry = Math.max(1, Number(obstacle.ry || 1) + padding);
    const dx = Number(x || 0) - Number(obstacle.x || 0);
    const dy = Number(y || 0) - Number(obstacle.y || 0);
    const norm = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    return (norm - 1) * Math.min(rx, ry);
  };

  const isCandidateBlockedByObstacles = (candidate, obstacles = [], padding = 0) => obstacles.some((obstacle) => (
    getObstacleClearance(obstacle, candidate.x, candidate.y, padding) < 0
  ));

  const getCandidateObstacleClearance = (candidate, obstacles = [], padding = 0) => {
    if (!obstacles.length) return 96;
    let clearance = Infinity;
    obstacles.forEach((obstacle) => {
      clearance = Math.min(clearance, getObstacleClearance(obstacle, candidate.x, candidate.y, padding));
    });
    return Number.isFinite(clearance) ? clearance : 96;
  };

  const makeFileDistributionCandidates = (scope, obstacles = [], token = '', fileCount = 1) => {
    if (!scope) return [];
    const count = clamp(
      Math.ceil(Math.max(FILE_DISTRIBUTION_MIN_CANDIDATES, fileCount * 10 + obstacles.length * 16)),
      FILE_DISTRIBUTION_MIN_CANDIDATES,
      FILE_DISTRIBUTION_MAX_CANDIDATES,
    );
    const golden = Math.PI * (3 - Math.sqrt(5));
    const seed = (hashString(`${token}:distribution`) % 6283) / 1000;
    const usableRx = Math.max(28, Number(scope.rx || 1) - FILE_EDGE_PADDING - FILE_DISTRIBUTION_EDGE_MARGIN);
    const usableRy = Math.max(28, Number(scope.ry || 1) - FILE_EDGE_PADDING - FILE_DISTRIBUTION_EDGE_MARGIN);
    const candidates = [];
    for (let i = 0; i < count; i += 1) {
      // Low-discrepancy spiral samples fill the whole ellipse without making a
      // visible grid. The radial permutation prevents early samples from sitting
      // mostly near the center when file ids are stable.
      const permuted = (i * 37 + (hashString(`${token}:permute`) % count)) % count;
      const angle = i * golden + seed;
      const radial = Math.sqrt((permuted + 0.5) / count) * 0.965;
      const x = Number(scope.x || 0) + Math.cos(angle) * usableRx * radial;
      const y = Number(scope.y || 0) + Math.sin(angle) * usableRy * radial;
      const candidate = { x, y, radial };
      if (!pointInFolder(scope, x, y, -FILE_EDGE_PADDING * 0.65)) continue;
      if (isCandidateBlockedByObstacles(candidate, obstacles, FILE_BODY_RX + 15)) continue;
      candidates.push(candidate);
    }

    // If obstacles consume most of the scope, keep a permissive fallback so the
    // solver can still distribute points around the remaining boundary instead
    // of collapsing them at the center.
    if (candidates.length < Math.max(8, fileCount)) {
      for (let i = 0; i < count; i += 1) {
        const angle = i * golden + seed * 1.7;
        const radial = Math.sqrt((i + 0.5) / count) * 0.92;
        const x = Number(scope.x || 0) + Math.cos(angle) * usableRx * radial;
        const y = Number(scope.y || 0) + Math.sin(angle) * usableRy * radial;
        const candidate = projectPointIntoFolder(scope, x, y, FILE_EDGE_PADDING);
        if (isCandidateBlockedByObstacles(candidate, obstacles, FILE_BODY_RX + 6)) continue;
        candidates.push({ ...candidate, radial });
        if (candidates.length >= Math.max(12, fileCount * 2)) break;
      }
    }
    return candidates;
  };

  const buildFileDistributionAnchors = (fileBodies = [], scope, obstacles = [], folderId = ROOT_ID) => {
    const anchors = Object.create(null);
    if (!fileBodies.length || !scope) return anchors;
    const candidates = makeFileDistributionCandidates(scope, obstacles, folderId, fileBodies.length);
    if (!candidates.length) return anchors;
    const ordered = fileBodies.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));

    // Large folders are the common hot path. The previous greedy assignment
    // compared every candidate with every already-placed file, which becomes
    // expensive as file count grows. For dense scopes, use the low-discrepancy
    // candidate order directly and pick evenly spaced samples. This keeps the
    // whole region covered while making anchor assignment near-linear.
    if (ordered.length > FILE_ANCHOR_GREEDY_LIMIT) {
      const sortedCandidates = candidates.slice().sort((a, b) => {
        const ar = Number(a.radial || 0);
        const br = Number(b.radial || 0);
        if (Math.abs(ar - br) > 0.035) return ar - br;
        return Math.atan2(a.y - Number(scope.y || 0), a.x - Number(scope.x || 0))
          - Math.atan2(b.y - Number(scope.y || 0), b.x - Number(scope.x || 0));
      });
      const used = new Set();
      ordered.forEach((body, index) => {
        const baseIndex = Math.floor(((index + 0.5) / Math.max(1, ordered.length)) * sortedCandidates.length);
        let bestIndex = -1;
        let bestScore = Infinity;
        const windowSize = Math.min(18, sortedCandidates.length);
        for (let offset = -windowSize; offset <= windowSize; offset += 1) {
          const candidateIndex = clamp(baseIndex + offset, 0, sortedCandidates.length - 1);
          if (used.has(candidateIndex)) continue;
          const candidate = sortedCandidates[candidateIndex];
          const currentDistance = Math.hypot(candidate.x - Number(body.layout.x || 0), candidate.y - Number(body.layout.y || 0));
          const obstaclePenalty = isCandidateBlockedByObstacles(candidate, obstacles, FILE_BODY_RX + 10) ? 10000 : 0;
          const score = Math.abs(offset) * 4 + currentDistance * 0.018 + obstaclePenalty;
          if (score < bestScore) {
            bestScore = score;
            bestIndex = candidateIndex;
          }
        }
        if (bestIndex < 0) {
          for (let candidateIndex = 0; candidateIndex < sortedCandidates.length; candidateIndex += 1) {
            if (!used.has(candidateIndex)) { bestIndex = candidateIndex; break; }
          }
        }
        if (bestIndex < 0) return;
        used.add(bestIndex);
        const chosen = sortedCandidates[bestIndex];
        anchors[body.id] = { x: chosen.x, y: chosen.y };
      });
      return anchors;
    }

    const used = new Set();
    const placed = [];
    ordered.forEach((body, orderIndex) => {
      let bestIndex = -1;
      let bestScore = -Infinity;
      candidates.forEach((candidate, index) => {
        if (used.has(index)) return;
        let minPlacedDistance = placed.length ? Infinity : 72;
        placed.forEach((placedPoint) => {
          const d = Math.hypot(candidate.x - placedPoint.x, candidate.y - placedPoint.y);
          minPlacedDistance = Math.min(minPlacedDistance, d);
        });
        const obstacleClearance = clamp(getCandidateObstacleClearance(candidate, obstacles, FILE_BODY_RX + 10), -40, 96);
        const currentDistance = Math.hypot(candidate.x - Number(body.layout.x || 0), candidate.y - Number(body.layout.y || 0));
        const edgeBalance = 1 - Math.abs(Number(candidate.radial || 0.5) - 0.66) * 0.24;
        const stableNoise = ((hashString(`${folderId}:${body.id}:${index}:anchor`) % 1000) / 1000) * 0.08;
        const score = Math.min(minPlacedDistance, 105) * 1.35
          + obstacleClearance * 0.38
          + edgeBalance * 18
          - currentDistance * 0.018
          - orderIndex * 0.0001
          + stableNoise;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });
      if (bestIndex < 0) return;
      const chosen = candidates[bestIndex];
      used.add(bestIndex);
      placed.push(chosen);
      anchors[body.id] = { x: chosen.x, y: chosen.y };
    });
    return anchors;
  };

  const seedFilesInScope = (store, layout, folderId, fileBodies, scope, obstacles, locked) => {
    if (!scope || !fileBodies.length) return;
    let needsSeed = false;
    for (let i = 0; i < fileBodies.length; i += 1) {
      const body = fileBodies[i];
      if (locked.has(body.id)) continue;
      if (!pointInFolder(scope, body.layout.x, body.layout.y, -FILE_EDGE_PADDING * 0.55)) needsSeed = true;
      obstacles.forEach((obstacle) => {
        if (pointInFolder(obstacle, body.layout.x, body.layout.y, FILE_BODY_RX + 12)) needsSeed = true;
      });
      if (fileBodies.length <= FILE_PAIRWISE_GRID_LIMIT) {
        for (let j = i + 1; j < fileBodies.length; j += 1) {
          const other = fileBodies[j];
          const dx = Number(other.layout.x || 0) - Number(body.layout.x || 0);
          const dy = Number(other.layout.y || 0) - Number(body.layout.y || 0);
          if (Math.sqrt(dx * dx + dy * dy) < FILE_BODY_RX * 1.9) needsSeed = true;
        }
      }
    }
    if (!needsSeed && fileBodies.length > FILE_PAIRWISE_GRID_LIMIT) {
      const seenClose = { value: false };
      forEachSpatialPair(fileBodies, FILE_BODY_RX * 2.4, (a, b) => {
        if (seenClose.value) return;
        const dx = Number(b.layout.x || 0) - Number(a.layout.x || 0);
        const dy = Number(b.layout.y || 0) - Number(a.layout.y || 0);
        if (Math.sqrt(dx * dx + dy * dy) < FILE_BODY_RX * 1.9) seenClose.value = true;
      });
      needsSeed = seenClose.value;
    }
    if (!needsSeed) return;

    // Obsidian-like initial placement: golden-angle dots around the container
    // center, not a visible grid. The force solver will then relax the dots.
    const golden = Math.PI * (3 - Math.sqrt(5));
    const usableRx = Math.max(20, Number(scope.rx || 1) - FILE_EDGE_PADDING * 1.8);
    const usableRy = Math.max(20, Number(scope.ry || 1) - FILE_EDGE_PADDING * 1.8);
    const count = Math.max(1, fileBodies.length);
    fileBodies.forEach((body, index) => {
      if (locked.has(body.id)) return;
      const hash = hashString(`${folderId}:${body.id}:file-seed`);
      const angle = index * golden + (hash % 628) / 100;
      const radiusRatio = count <= 1 ? 0 : Math.sqrt((index + 0.5) / count) * 0.74;
      const jitter = ((hash % 100) / 100 - 0.5) * 0.045;
      body.layout.x = Number(scope.x || 0) + Math.cos(angle) * usableRx * (radiusRatio + jitter);
      body.layout.y = Number(scope.y || 0) + Math.sin(angle) * usableRy * (radiusRatio + jitter) * 0.92;
      projectFileIntoScope(body, scope, obstacles);
    });
  };

  const settleFilesInFixedScope = (store, layout, folderId, options = {}) => {
    const locked = options.lockedIds || new Set();
    const scope = layout.folders?.[folderId] || layout.folders?.[ROOT_ID];
    if (!scope) return;
    const files = getFileChildren(store, folderId);
    const fileBodies = files.map((file) => makeFileBody(layout, file)).filter(Boolean);
    if (!fileBodies.length) return;
    const obstacles = getFixedFolderObstacles(store, layout, folderId);

    seedFilesInScope(store, layout, folderId, fileBodies, scope, obstacles, locked);
    const distributionAnchors = buildFileDistributionAnchors(fileBodies, scope, obstacles, folderId);

    // Dense folders are dominated by the cost of iterative pairwise relaxation.
    // For these scopes the anchor field is already the best representation of
    // the final distribution: it is deterministic, obstacle-aware and covers the
    // available area. Jump automatic dots to those anchors and reserve force
    // relaxation for small/medium scopes where it adds visible polish.
    if (fileBodies.length >= 48) {
      fileBodies.forEach((body) => {
        if (locked.has(body.id)) return;
        const anchor = distributionAnchors[body.id];
        if (anchor) {
          body.layout.x = anchor.x;
          body.layout.y = anchor.y;
        }
        projectFileIntoScope(body, scope, obstacles);
        resolveFileObstacleOverlap(body, scope, obstacles, folderId);
        projectFileIntoScope(body, scope, obstacles);
      });
      return;
    }

    const passes = Math.max(6, Number(options.passes || 64));
    for (let pass = 0; pass < passes; pass += 1) {
      const alpha = Math.pow(1 - pass / Math.max(1, passes), 1.18);
      fileBodies.forEach((body) => { body.vx = 0; body.vy = 0; });

      const applyFilePairForce = (a, b) => {
        const aLocked = locked.has(a.id);
        const bLocked = locked.has(b.id);
        if (aLocked && bLocked) return;
        let dx = Number(b.layout.x || 0) - Number(a.layout.x || 0);
        let dy = Number(b.layout.y || 0) - Number(a.layout.y || 0);
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (!Number.isFinite(dist) || dist < 0.001) {
          const angle = seededAngle(`${folderId}:${a.id}:${b.id}`, pass, fileBodies.length + 11);
          dx = Math.cos(angle) * 0.01;
          dy = Math.sin(angle) * 0.01;
          dist = 0.01;
        }
        const desired = 20;
        if (dist > desired * 2.1) return;
        const force = dist < desired
          ? Math.pow((desired - dist) / desired, 1.35) * 7.4 * alpha
          : Math.pow((desired * 2.1 - dist) / (desired * 2.1), 2.2) * 0.82 * alpha;
        const ux = dx / Math.max(0.001, dist);
        const uy = dy / Math.max(0.001, dist);
        if (!aLocked) { a.vx -= ux * force; a.vy -= uy * force; }
        if (!bLocked) { b.vx += ux * force; b.vy += uy * force; }
      };
      if (fileBodies.length > FILE_PAIRWISE_GRID_LIMIT) {
        forEachSpatialPair(fileBodies, 44, applyFilePairForce);
      } else {
        for (let i = 0; i < fileBodies.length; i += 1) {
          const a = fileBodies[i];
          for (let j = i + 1; j < fileBodies.length; j += 1) {
            applyFilePairForce(a, fileBodies[j]);
          }
        }
      }

      fileBodies.forEach((body) => {
        if (locked.has(body.id)) return;
        obstacles.forEach((obstacle) => {
          const dx = Number(body.layout.x || 0) - obstacle.x;
          const dy = Number(body.layout.y || 0) - obstacle.y;
          const safeX = Math.max(1, obstacle.rx + FILE_BODY_RX + 14);
          const safeY = Math.max(1, obstacle.ry + FILE_BODY_RY + 14);
          const norm = Math.sqrt((dx / safeX) ** 2 + (dy / safeY) ** 2);
          if (norm > 1.72) return;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = norm < 1
            ? Math.pow(1 - norm, 1.38) * 12.0 * alpha
            : Math.pow((1.72 - norm) / 1.72, 2.4) * 1.5 * alpha;
          body.vx += (dx / dist) * force;
          body.vy += (dy / dist) * force;
        });

        const anchor = distributionAnchors[body.id];
        if (anchor) {
          body.vx += (Number(anchor.x || 0) - Number(body.layout.x || 0)) * FILE_DISTRIBUTION_ANCHOR_PULL * alpha;
          body.vy += (Number(anchor.y || 0) - Number(body.layout.y || 0)) * FILE_DISTRIBUTION_ANCHOR_PULL * alpha;
        }

        // A very weak center pull prevents edge sticking, but the distribution
        // anchors decide coverage. The previous stronger pull made dense folders
        // collapse into one area even when plenty of region remained empty.
        const centerPull = folderId === ROOT_ID ? 0.00075 : 0.00115;
        body.vx += (Number(scope.x || 0) - Number(body.layout.x || 0)) * centerPull * alpha;
        body.vy += (Number(scope.y || 0) - Number(body.layout.y || 0)) * centerPull * alpha;

        const projected = projectPointIntoFolder(scope, body.layout.x, body.layout.y, FILE_EDGE_PADDING);
        body.vx += (projected.x - Number(body.layout.x || 0)) * 0.30 * alpha;
        body.vy += (projected.y - Number(body.layout.y || 0)) * 0.30 * alpha;
      });

      fileBodies.forEach((body) => {
        if (locked.has(body.id)) return;
        body.vx = clamp(body.vx * 0.72, -12, 12);
        body.vy = clamp(body.vy * 0.72, -12, 12);
        body.layout.x = Number(body.layout.x || 0) + body.vx;
        body.layout.y = Number(body.layout.y || 0) + body.vy;
        projectFileIntoScope(body, scope, obstacles);
      });
    }

    fileBodies.forEach((body) => {
      if (locked.has(body.id)) return;
      const anchor = distributionAnchors[body.id];
      if (anchor) {
        body.layout.x = lerp(body.layout.x, anchor.x, 0.10);
        body.layout.y = lerp(body.layout.y, anchor.y, 0.10);
      }
      projectFileIntoScope(body, scope, obstacles);
      resolveFileObstacleOverlap(body, scope, obstacles, folderId);
      projectFileIntoScope(body, scope, obstacles);
    });
  };

  const makeFolderRegionBody = (layout, folder) => {
    const region = layout.folders?.[folder.id];
    if (!region) return null;
    return {
      id: folder.id,
      type: 'folder',
      layout: region,
      rx: Math.max(FREE_FOLDER_MIN_RX, Number(region.rx || 1) + FOLDER_REPEL_PADDING_X),
      ry: Math.max(FREE_FOLDER_MIN_RY, Number(region.ry || 1) + FOLDER_REPEL_PADDING_Y),
      vx: 0,
      vy: 0,
      mass: Math.max(2.2, Math.sqrt(Math.max(1, Number(region.rx || 1) * Number(region.ry || 1))) / 20),
    };
  };

  const makeRegionFileBody = (layout, file) => {
    const point = layout.files?.[file.id];
    if (!point) return null;
    return {
      id: file.id,
      type: 'file',
      layout: point,
      rx: FILE_BODY_RX + 10,
      ry: FILE_BODY_RY + 10,
      vx: 0,
      vy: 0,
      mass: 0.72,
    };
  };

  const projectFolderRegionIntoScope = (body, scope) => {
    if (!body || !scope) return { x: body?.layout?.x || 0, y: body?.layout?.y || 0 };
    if (body.type === 'file') return projectPointIntoFolder(scope, body.layout.x, body.layout.y, FILE_EDGE_PADDING);
    const marginX = Math.max(26, Number(body.rx || 1) * 0.88);
    const marginY = Math.max(22, Number(body.ry || 1) * 0.88);
    const safeScope = {
      x: scope.x,
      y: scope.y,
      rx: Math.max(24, Number(scope.rx || 1) - marginX),
      ry: Math.max(24, Number(scope.ry || 1) - marginY),
    };
    return projectPointIntoFolder(safeScope, body.layout.x, body.layout.y, 0);
  };

  const moveFolderRegionBody = (store, layout, body, dx, dy, locked) => {
    if (!body || locked.has(body.id)) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const stepX = clamp(dx, -FOLDER_REPEL_MAX_STEP, FOLDER_REPEL_MAX_STEP);
    const stepY = clamp(dy, -FOLDER_REPEL_MAX_STEP, FOLDER_REPEL_MAX_STEP);
    if (Math.abs(stepX) < 0.0001 && Math.abs(stepY) < 0.0001) return;
    body.layout.x = Number(body.layout.x || 0) + stepX;
    body.layout.y = Number(body.layout.y || 0) + stepY;
    if (body.type === 'folder') translateFolderSubtree(store, layout, body.id, stepX, stepY);
  };

  const settleFolderRegionsInScope = (store, layout, folderId, options = {}) => {
    const locked = options.lockedIds || new Set();
    const scope = layout.folders?.[folderId] || layout.folders?.[ROOT_ID];
    if (!scope) return;
    const children = getChildren(store, folderId);
    const folderBodies = children
      .filter(isFolder)
      .map((child) => makeFolderRegionBody(layout, child))
      .filter(Boolean);
    if (!folderBodies.length) return;
    let fileBodies = children
      .filter(isFile)
      .map((child) => makeRegionFileBody(layout, child))
      .filter(Boolean);
    // Folder regions are the primary movable bodies here. Direct file points are
    // only sampled as soft occupancy hints; full file distribution is handled by
    // settleFilesInFixedScope. Sampling prevents large folders with many files
    // from turning folder-region settlement back into a file-count squared pass.
    const maxFileHints = Math.max(24, Math.min(72, folderBodies.length * 14));
    if (fileBodies.length > maxFileHints) {
      const stride = fileBodies.length / maxFileHints;
      fileBodies = Array.from({ length: maxFileHints }, (_, index) => fileBodies[Math.floor(index * stride)]).filter(Boolean);
    }
    const bodies = [...folderBodies, ...fileBodies].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });
    if (!bodies.length) return;

    const passes = Math.max(6, Number(options.passes || FOLDER_REPEL_PASSES));
    for (let pass = 0; pass < passes; pass += 1) {
      const alpha = Math.pow(1 - pass / Math.max(1, passes), 1.22);
      bodies.forEach((body) => { body.vx = 0; body.vy = 0; });

      const applyRegionPairForce = (a, b) => {
        const aLocked = locked.has(a.id);
        const bLocked = locked.has(b.id);
        if (aLocked && bLocked) return;
        let dx = Number(b.layout.x || 0) - Number(a.layout.x || 0);
        let dy = Number(b.layout.y || 0) - Number(a.layout.y || 0);
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (!Number.isFinite(dist) || dist < 0.001) {
          const angle = seededAngle(`${folderId}:${a.id}:${b.id}:folder-repel`, pass, bodies.length + 17);
          dx = Math.cos(angle) * 0.01;
          dy = Math.sin(angle) * 0.01;
          dist = 0.01;
        }
        const safeX = Math.max(1, a.rx + b.rx + 14);
        const safeY = Math.max(1, a.ry + b.ry + 12);
        const norm = Math.sqrt((dx / safeX) ** 2 + (dy / safeY) ** 2);
        if (norm > 1.42) return;
        const collision = norm < 1 ? Math.pow(1 - norm, 1.32) * 1.18 : 0;
        const soft = norm < 1.42 ? Math.pow((1.42 - norm) / 1.42, 2.15) * 0.12 : 0;
        const force = (collision + soft) * alpha;
        const dirX = dx / Math.max(0.001, dist);
        const dirY = dy / Math.max(0.001, dist);
        const totalMass = a.mass + b.mass;
        const aShare = b.mass / Math.max(0.001, totalMass);
        const bShare = a.mass / Math.max(0.001, totalMass);
        const step = Math.min(FOLDER_REPEL_MAX_STEP, Math.max(safeX, safeY) * force * 0.20);
        if (!aLocked) { a.vx -= dirX * step * (bLocked ? 1 : aShare); a.vy -= dirY * step * (bLocked ? 1 : aShare); }
        if (!bLocked) { b.vx += dirX * step * (aLocked ? 1 : bShare); b.vy += dirY * step * (aLocked ? 1 : bShare); }
      };
      const largestBody = bodies.reduce((max, body) => Math.max(max, Number(body.rx || 1), Number(body.ry || 1)), 1);
      if (bodies.length > 34) {
        forEachSpatialPair(bodies, Math.max(64, largestBody * 1.15), applyRegionPairForce);
      } else {
        for (let i = 0; i < bodies.length; i += 1) {
          const a = bodies[i];
          for (let j = i + 1; j < bodies.length; j += 1) {
            applyRegionPairForce(a, bodies[j]);
          }
        }
      }

      bodies.forEach((body) => {
        if (locked.has(body.id)) return;
        const projected = projectFolderRegionIntoScope(body, scope);
        body.vx += (projected.x - Number(body.layout.x || 0)) * 0.18 * alpha;
        body.vy += (projected.y - Number(body.layout.y || 0)) * 0.18 * alpha;
        body.vx = clamp(body.vx * FOLDER_REPEL_DAMPING, -FOLDER_REPEL_MAX_STEP, FOLDER_REPEL_MAX_STEP);
        body.vy = clamp(body.vy * FOLDER_REPEL_DAMPING, -FOLDER_REPEL_MAX_STEP, FOLDER_REPEL_MAX_STEP);
        moveFolderRegionBody(store, layout, body, body.vx, body.vy, locked);
      });
    }

    bodies.forEach((body) => {
      if (locked.has(body.id)) return;
      const projected = projectFolderRegionIntoScope(body, scope);
      moveFolderRegionBody(
        store,
        layout,
        body,
        (projected.x - Number(body.layout.x || 0)) * 0.85,
        (projected.y - Number(body.layout.y || 0)) * 0.85,
        locked,
      );
    });
  };

  const growScopesForFileObstacleConflicts = (store, layout, options = {}) => {
    const lockedIds = options.lockedIds || new Set();
    getItems(store).filter(isFolder).forEach((folder) => {
      if (lockedIds.has(folder.id)) return;
      const scope = layout.folders?.[folder.id];
      if (!scope) return;
      const obstacles = getFixedFolderObstacles(store, layout, folder.id);
      if (!obstacles.length) return;
      let conflicts = 0;
      getFileChildren(store, folder.id).forEach((file) => {
        const point = layout.files?.[file.id];
        if (!point) return;
        if (obstacles.some((obstacle) => pointInFolder(obstacle, point.x, point.y, FILE_BODY_RX + 12))) conflicts += 1;
      });
      if (!conflicts) return;
      const scale = 1 + clamp(Math.sqrt(conflicts) * 0.020, 0.025, folder.id === ROOT_ID ? 0.18 : 0.10);
      scope.rx *= scale;
      scope.ry *= scale;
    });
  };

  const getLayoutScopes = (store) => [ROOT_ID, ...foldersByDepth(store, false)
    .map((folder) => folder.id)
    .filter((id) => id !== ROOT_ID)];

  const getActiveLayoutScopes = (store) => getLayoutScopes(store)
    .filter((folderId) => getChildren(store, folderId).length > 0);

  const getScopeComplexity = (store, folderId) => {
    const files = getFileChildren(store, folderId).length;
    const folders = getFolderChildren(store, folderId).length;
    return { files, folders, total: files + folders * 3 };
  };

  const getAdaptiveFilePasses = (store, folderId, base = 1) => {
    const { files, folders } = getScopeComplexity(store, folderId);
    if (!files) return 0;
    const weighted = files + folders * 2;
    const multiplier = folderId === ROOT_ID ? 1.05 : 1;
    // Anchors now provide the primary even distribution. The force pass only
    // resolves local overlaps and obstacle pressure, so dense scopes should not
    // run dozens of expensive relaxation rounds.
    const target = weighted > 260 ? 8
      : weighted > 160 ? 10
        : weighted > 90 ? 12
          : weighted > 45 ? 14
            : 18;
    return Math.max(4, Math.round(target * base * multiplier));
  };

  const getAdaptiveFolderPasses = (store, folderId, base = 1) => {
    const { folders, files } = getScopeComplexity(store, folderId);
    if (!folders && files < 2) return 0;
    const weighted = folders * 3 + files * 0.28;
    const target = weighted > 120 ? 14
      : weighted > 60 ? 18
        : weighted > 22 ? 22
          : 18;
    return Math.max(5, Math.round(target * base));
  };

  const settleLayout = (store, layout, options = {}) => {
    if (!layout?.folders || !layout?.files) return;
    const lockedIds = options.lockedIds || new Set();
    const activeScopes = getActiveLayoutScopes(store);

    // The earlier solver repeatedly settled every scope with fixed large pass
    // counts. That is robust but scales poorly when many files exist. The new
    // pipeline separates folder geometry and file placement, uses adaptive pass
    // counts, and only visits scopes that actually contain direct children.
    console.time('cycle folder stage');
    for (let cycle = 0; cycle < 2; cycle += 1) {
      console.time('updateFreeFolderSizes cycle '+cycle); updateFreeFolderSizes(store, layout, { lockedIds, force: true }); console.timeEnd('updateFreeFolderSizes cycle '+cycle);
      console.time('forceFolderWrapContainment cycle '+cycle); forceFolderWrapContainment(store, layout, { lockedIds }); console.timeEnd('forceFolderWrapContainment cycle '+cycle);
      console.time('folderRegions cycle '+cycle); activeScopes.forEach((folderId) => {
        const passes = getAdaptiveFolderPasses(store, folderId, cycle === 0 ? 0.95 : 0.62);
        if (passes > 0) settleFolderRegionsInScope(store, layout, folderId, { lockedIds, passes });
      }); console.timeEnd('folderRegions cycle '+cycle);
    }
    console.timeEnd('cycle folder stage');

    console.time('pre files sizes'); updateFreeFolderSizes(store, layout, { lockedIds, force: true }); console.timeEnd('pre files sizes');
    console.time('pre files wrap'); forceFolderWrapContainment(store, layout, { lockedIds }); console.timeEnd('pre files wrap');

    console.time('files main'); activeScopes.forEach((folderId) => {
      const passes = getAdaptiveFilePasses(store, folderId, 1);
      if (passes > 0) settleFilesInFixedScope(store, layout, folderId, { lockedIds, passes });
    }); console.timeEnd('files main');

    // File dots can expand a parent envelope. Re-wrap once, then apply a short
    // correction pass. This preserves the existing behavior without the old
    // multi-cycle full recomputation.
    console.time('post1 sizes'); updateFreeFolderSizes(store, layout, { lockedIds, force: true }); console.timeEnd('post1 sizes');
    console.time('post1 wrap'); forceFolderWrapContainment(store, layout, { lockedIds }); console.timeEnd('post1 wrap');
    console.time('post1 folders'); activeScopes.forEach((folderId) => {
      const folderPasses = getAdaptiveFolderPasses(store, folderId, 0.42);
      if (folderPasses > 0) settleFolderRegionsInScope(store, layout, folderId, { lockedIds, passes: folderPasses });
    }); console.timeEnd('post1 folders');
    console.time('post2 sizes'); updateFreeFolderSizes(store, layout, { lockedIds, force: true }); console.timeEnd('post2 sizes');
    console.time('post2 wrap'); forceFolderWrapContainment(store, layout, { lockedIds }); console.timeEnd('post2 wrap');
    console.time('files correction'); activeScopes.forEach((folderId) => {
      const passes = getAdaptiveFilePasses(store, folderId, 0.45);
      if (passes > 0) settleFilesInFixedScope(store, layout, folderId, { lockedIds, passes });
    }); console.timeEnd('files correction');

    console.time('grow conflicts'); growScopesForFileObstacleConflicts(store, layout, { lockedIds }); console.timeEnd('grow conflicts');
    console.time('final wrap'); forceFolderWrapContainment(store, layout, { lockedIds }); console.timeEnd('final wrap');
    console.time('files final'); activeScopes.forEach((folderId) => {
      const passes = getAdaptiveFilePasses(store, folderId, 0.28);
      if (passes > 0) settleFilesInFixedScope(store, layout, folderId, { lockedIds, passes });
    }); console.timeEnd('files final');
    console.time('final sizes'); updateFreeFolderSizes(store, layout, { lockedIds, force: true }); console.timeEnd('final sizes');
    console.time('final containment'); forceFolderWrapContainment(store, layout, { lockedIds }); console.timeEnd('final containment');
    // Final safety clamp: the compact sizing model intentionally no longer
    // grows folders around every automatic dot position, so make sure any dots
    // displaced by the last wrap pass are projected back into their own scope.
    console.time('final clamp'); getLayoutScopes(store).forEach((folderId) => clampDirectChildrenIntoFolder(store, layout, folderId, { lockedIds })); console.timeEnd('final clamp');
  };

  const folderOverlapNorm = (a, b, padding = 18) => {
    const dx = Number(b.x || 0) - Number(a.x || 0);
    const dy = Number(b.y || 0) - Number(a.y || 0);
    const safeX = Math.max(1, Number(a.rx || 1) + Number(b.rx || 1) + padding);
    const safeY = Math.max(1, Number(a.ry || 1) + Number(b.ry || 1) + padding * 0.82);
    return Math.sqrt((dx / safeX) ** 2 + (dy / safeY) ** 2);
  };

  const findFreeFolderPosition = (store, layout, folder, index = 0) => {
    const root = layout.folders?.[ROOT_ID] || { x: 0, y: 0, rx: ROOT_WORLD_MIN_RX, ry: ROOT_WORLD_MIN_RY };
    const base = estimateBaseFolderSize(store, folder.id);
    // In the free-region model folder geometry is spatial, not a solved
    // hierarchy. New/migrated folders are placed in the warehouse field first;
    // users can then freely drag them anywhere they want.
    const centerX = Number(root.x ?? 0);
    const centerY = Number(root.y ?? 0);
    const existing = Object.entries(layout.folders || {})
      .filter(([id]) => id !== ROOT_ID && id !== folder.id)
      .map(([, value]) => value)
      .filter(Boolean);

    let best = null;
    let bestScore = Infinity;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 180; i += 1) {
      const ring = Math.floor(Math.sqrt(i + 1));
      const radius = 120 + ring * 96;
      const angle = seededAngle(`${folder.id}:free-folder-slot`, index + i, 181) + i * golden;
      const candidate = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius * 0.78,
        rx: base.rx,
        ry: base.ry,
      };
      const inRoot = pointInFolder(root, candidate.x, candidate.y, -Math.max(base.rx, base.ry));
      if (!inRoot) continue;
      let overlap = 0;
      existing.forEach((other) => {
        const norm = folderOverlapNorm(candidate, other, 42);
        if (norm < 1) overlap += (1 - norm) ** 2 * 120;
        else if (norm < 1.28) overlap += (1.28 - norm) * 6;
      });
      const parentDistance = Math.hypot(candidate.x - centerX, candidate.y - centerY) * 0.003;
      const score = overlap + parentDistance + i * 0.002;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
        if (score < 0.18) break;
      }
    }
    return best || placeInside(root, `${folder.id}:fallback-free-folder`, index, Math.max(1, existing.length + 1), 0.72);
  };

  const ensureLayout = (store = {}, options = {}) => {
    if (!options.__indexed) {
      return withStoreIndex(store, () => ensureLayout(store, { ...options, __indexed: true }));
    }
    const items = getItems(store);
    const itemIds = new Set(items.map((item) => item.id));
    const folderIds = new Set(items.filter(isFolder).map((item) => item.id));
    const fileIds = new Set(items.filter(isFile).map((item) => item.id));

    const layout = store.graphLayout && typeof store.graphLayout === 'object' ? store.graphLayout : {};
    const previousLayoutVersion = Number(layout.version || 0);
    layout.version = LAYOUT_VERSION;
    layout.viewport = normalizeViewport(layout.viewport);
    layout.folders = layout.folders && typeof layout.folders === 'object' ? layout.folders : {};
    layout.files = layout.files && typeof layout.files === 'object' ? layout.files : {};
    layout.selectedFileIds = Array.isArray(layout.selectedFileIds)
      ? layout.selectedFileIds.filter((id) => fileIds.has(id))
      : [];

    const rootSize = estimateBaseFolderSize(store, ROOT_ID);
    const previousRoot = layout.folders[ROOT_ID] || {};
    layout.folders[ROOT_ID] = {
      x: Number.isFinite(Number(previousRoot.x)) ? Number(previousRoot.x) : 0,
      y: Number.isFinite(Number(previousRoot.y)) ? Number(previousRoot.y) : 0,
      rx: Math.max(rootSize.rx, Number(previousRoot.rx) || 0),
      ry: Math.max(rootSize.ry, Number(previousRoot.ry) || 0),
      color: previousRoot.color || colorForId(ROOT_ID),
      seed: Number.isFinite(Number(previousRoot.seed)) ? Number(previousRoot.seed) : hashString(ROOT_ID) / 997,
      manual: Boolean(previousRoot.manual),
    };

    // Version 10 changed the model: root is virtual and folder regions are free.
    // Only pre-v10 layouts need a one-time free-space migration. Later upgrades
    // must preserve the user's manual folder positions and viewport.
    const needsFreeFolderMigration = previousLayoutVersion > 0 && previousLayoutVersion < 10;
    // Version 16 replaces runaway max-point wrapping with compact cloud sizing.
    // Preserve explicitly dragged dots, but let old automatic dot positions reseed
    // so oversized folders can shrink back around their actual content.
    const needsFileLayoutMigration = previousLayoutVersion > 0 && previousLayoutVersion < 16;
    if (needsFreeFolderMigration) {
      Object.keys(layout.folders).forEach((id) => {
        if (id !== ROOT_ID) delete layout.folders[id];
      });
    }

    const folderList = items
      .filter((item) => isFolder(item) && item.id !== ROOT_ID)
      .sort((a, b) => getDepth(store, a.id) - getDepth(store, b.id));

    folderList.forEach((folder, index) => {
      const previous = layout.folders[folder.id] || {};
      const base = estimateBaseFolderSize(store, folder.id);
      const shouldReseed = needsFreeFolderMigration
        || !Number.isFinite(Number(previous.x))
        || !Number.isFinite(Number(previous.y));
      const position = shouldReseed
        ? findFreeFolderPosition(store, layout, folder, index)
        : { x: Number(previous.x), y: Number(previous.y) };
      layout.folders[folder.id] = {
        x: position.x,
        y: position.y,
        rx: needsFreeFolderMigration ? base.rx : Math.max(base.rx, Number(previous.rx) || 0),
        ry: needsFreeFolderMigration ? base.ry : Math.max(base.ry, Number(previous.ry) || 0),
        color: previous.color || colorForId(folder.id),
        seed: Number.isFinite(Number(previous.seed)) ? Number(previous.seed) : hashString(folder.id) / 997,
        manual: true,
      };
    });

    items.filter(isFile).forEach((file, index) => {
      const previous = layout.files[file.id] || {};
      const parentLayout = layout.folders[file.parentId] || layout.folders[ROOT_ID];
      const siblings = getChildren(store, file.parentId || ROOT_ID);
      const childIndex = siblings.findIndex((item) => item.id === file.id);
      const preservePrevious = Number.isFinite(Number(previous.x))
        && Number.isFinite(Number(previous.y))
        && (!needsFileLayoutMigration || Boolean(previous.manual));
      const position = preservePrevious
        ? { x: Number(previous.x), y: Number(previous.y) }
        : placeInside(parentLayout, `${file.id}:v14-dot-seed`, childIndex >= 0 ? childIndex : index, siblings.length || 1, 0.64);
      layout.files[file.id] = {
        x: position.x,
        y: position.y,
        manual: Boolean(previous.manual),
      };
    });

    Object.keys(layout.folders).forEach((id) => { if (!folderIds.has(id)) delete layout.folders[id]; });
    Object.keys(layout.files).forEach((id) => { if (!fileIds.has(id)) delete layout.files[id]; });
    layout.selectedFileIds = layout.selectedFileIds.filter((id) => itemIds.has(id));

    const structureSignature = makeLayoutSignature(store);
    const lockedIds = options.lockedIds || new Set();
    const hasLockedIds = lockedIds && typeof lockedIds.size === 'number' && lockedIds.size > 0;
    const previousSettleMeta = layout.settleMeta && typeof layout.settleMeta === 'object' ? layout.settleMeta : {};
    const shouldSettle = options.settle !== false && (
      options.forceSettle === true
      || previousLayoutVersion < LAYOUT_VERSION
      || previousSettleMeta.signature !== structureSignature
      || hasLockedIds
    );

    if (shouldSettle) {
      withStoreIndex(store, () => {
        settleLayout(store, layout, {
          lockedIds,
          freezeFolders: Boolean(options.freezeFolders),
          forceResize: previousLayoutVersion < LAYOUT_VERSION,
        });
      });
      layout.settleMeta = {
        version: LAYOUT_VERSION,
        signature: structureSignature,
        itemCount: items.length,
        settledAt: Date.now(),
      };
    } else {
      layout.settleMeta = {
        ...previousSettleMeta,
        version: LAYOUT_VERSION,
        signature: structureSignature,
        itemCount: items.length,
      };
    }
    store.graphLayout = layout;
    return layout;
  };

  const angleDistance = (a, b) => {
    let diff = Math.abs(a - b) % (Math.PI * 2);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    return diff;
  };

  const closedCatmullRomPath = (points = []) => {
    if (!points.length) return '';
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for (let i = 0; i < points.length; i += 1) {
      const p0 = points[(i - 1 + points.length) % points.length];
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const p3 = points[(i + 2) % points.length];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return `${d} Z`;
  };

  const getFolderInfluencePoints = (store, layout, folderId) => {
    const points = [];
    const push = (x, y, weight = 1, radius = 0) => {
      if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return;
      points.push({ x: Number(x), y: Number(y), weight, radius });
    };
    getChildren(store, folderId).forEach((child) => {
      if (isFile(child)) {
        const point = layout.files?.[child.id];
        if (point) push(point.x, point.y, 0.72, 20);
        return;
      }
      const childFolder = layout.folders?.[child.id];
      if (childFolder) {
        push(
          childFolder.x,
          childFolder.y,
          1.10,
          Math.max(Number(childFolder.rx || 1), Number(childFolder.ry || 1)) * 0.60,
        );
      }
    });
    return points;
  };

  const smoothCircularProfile = (values = [], passes = 1) => {
    let result = values.slice();
    for (let pass = 0; pass < passes; pass += 1) {
      result = result.map((value, index) => {
        const prev2 = result[(index - 2 + result.length) % result.length];
        const prev = result[(index - 1 + result.length) % result.length];
        const next = result[(index + 1) % result.length];
        const next2 = result[(index + 2) % result.length];
        return prev2 * 0.06 + prev * 0.20 + value * 0.48 + next * 0.20 + next2 * 0.06;
      });
    }
    return result;
  };

  const makeFolderPath = (folder, influencePoints = [], pointCount = FOLDER_SHAPE_POINTS) => {
    const cx = Number(folder.x || 0);
    const cy = Number(folder.y || 0);
    const rx = Math.max(1, Number(folder.rx || 1));
    const ry = Math.max(1, Number(folder.ry || 1));
    const seed = Number(folder.seed || 1);
    const count = Math.max(36, Number(pointCount || FOLDER_SHAPE_POINTS));
    const profile = [];

    for (let i = 0; i < count; i += 1) {
      const t = (Math.PI * 2 * i) / count;
      let bulge = 0;
      influencePoints.forEach((point) => {
        const vx = Number(point.x || 0) - cx;
        const vy = Number(point.y || 0) - cy;
        const norm = Math.sqrt((vx / rx) ** 2 + (vy / ry) ** 2);
        if (!Number.isFinite(norm) || norm < 0.08) return;
        const angle = Math.atan2(vy / ry, vx / rx);
        const align = Math.max(0, Math.cos(angleDistance(t, angle)));
        const radiusPressure = clamp(Number(point.radius || 0) / Math.max(rx, ry), 0, 0.22);
        const edgePressure = clamp((norm - 0.18) / 0.82, 0, 1);
        bulge += Number(point.weight || 1) * Math.pow(align, 8.5) * (edgePressure + radiusPressure) * 0.070;
      });

      // Keep a quiet organic border, but do not let randomness dominate the
      // content envelope. This makes regions feel alive while staying readable.
      const quietWave = 0.0075 * Math.sin(t * 3 + seed) + 0.0055 * Math.sin(t * 5 + seed * 0.43);
      profile.push(1 + clamp(bulge, 0, FOLDER_SHAPE_MAX_BULGE) + quietWave);
    }

    const smoothed = smoothCircularProfile(profile, FOLDER_SHAPE_SMOOTH_PASSES)
      .map((value) => clamp(value, 0.965, 1 + FOLDER_SHAPE_MAX_BULGE));
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const t = (Math.PI * 2 * i) / count;
      const factor = smoothed[i];
      points.push({
        x: cx + Math.cos(t) * rx * factor,
        y: cy + Math.sin(t) * ry * factor,
      });
    }
    return closedCatmullRomPath(points);
  };

  const createKnowledgeMapController = ({
    shell,
    mapView = document.querySelector('.knowledge-map-view'),
    getStore,
    saveStore,
    renderList,
    openFile,
    enterFolder,
    moveItemsToFolder,
    deleteItems,
    rootId = ROOT_ID,
  } = {}) => {
    const viewportEl = mapView?.querySelector?.('.knowledge-map-viewport') || null;
    const svg = mapView?.querySelector?.('.knowledge-map-svg') || null;
    const worldLayer = svg?.querySelector?.('.knowledge-map-world') || null;
    const folderLayer = svg?.querySelector?.('.knowledge-map-folder-layer') || null;
    const fileLayer = svg?.querySelector?.('.knowledge-map-file-layer') || null;
    const overlayLayer = svg?.querySelector?.('.knowledge-map-overlay-layer') || null;
    const titleEl = mapView?.querySelector?.('[data-knowledge-map-title]') || null;
    const hintEl = mapView?.querySelector?.('[data-knowledge-map-hint]') || null;

    const selectedFileIds = new Set();
    let selectedFolderId = rootId;
    let hoverFolderId = '';
    let dragState = null;
    let panState = null;
    let selectionState = null;
    let rafId = 0;
    let viewportAnimation = null;
    let suppressNextOpen = false;
    let armedFolderId = '';
    let armedFolderUntil = 0;
    let lastFolderClick = { id: '', time: 0, x: 0, y: 0 };
    let lastFileClick = { id: '', time: 0, x: 0, y: 0 };
    let lastRenderAt = 0;
    const visualState = {
      folders: Object.create(null),
      files: Object.create(null),
      pulses: Object.create(null),
      cluster: null,
      lastTickAt: 0,
      animating: false,
      enteredAt: 0,
    };
    const deletingVisualItems = new Map();
    const renderCache = {
      folders: new Map(),
      files: new Map(),
    };
    let revealPrewarmToken = 0;

    const scheduleRevealPrewarm = () => {
      if (!mapView || isReducedMotion()) return;
      const token = revealPrewarmToken + 1;
      revealPrewarmToken = token;
      mapView.classList.add('is-render-prewarm');
      requestRender();
      const clear = () => {
        if (revealPrewarmToken !== token) return;
        mapView.classList.remove('is-render-prewarm');
      };
      window.requestAnimationFrame?.(() => window.requestAnimationFrame?.(clear) || window.setTimeout(clear, 32)) || window.setTimeout(clear, 32);
    };

    const getStoreSafe = () => getStore?.() || {};
    const getLayout = (options = {}) => ensureLayout(getStoreSafe(), {
      settle: options.settle ?? false,
      lockedIds: options.lockedIds || new Set(),
      freezeFolders: Boolean(options.freezeFolders),
    });

    const settleAndSave = (options = {}) => {
      const layout = ensureLayout(getStoreSafe(), {
        settle: true,
        lockedIds: options.lockedIds || new Set(),
        freezeFolders: Boolean(options.freezeFolders),
      });
      layout.selectedFileIds = Array.from(selectedFileIds);
      saveStore?.();
      return layout;
    };

    const getViewportSize = () => {
      const rect = viewportEl?.getBoundingClientRect?.();
      return {
        width: Math.max(1, Number(rect?.width || viewportEl?.clientWidth || 1)),
        height: Math.max(1, Number(rect?.height || viewportEl?.clientHeight || 1)),
      };
    };

    const getFolderScreenBox = (folderLayout, layout, factor = 1.18) => {
      if (!folderLayout || !layout?.viewport) return null;
      const scale = Math.max(0.01, Number(layout.viewport.scale || 1));
      const cx = Number(folderLayout.x || 0) * scale + Number(layout.viewport.x || 0);
      const cy = Number(folderLayout.y || 0) * scale + Number(layout.viewport.y || 0);
      const rx = Math.max(1, Number(folderLayout.rx || 1)) * scale * factor;
      const ry = Math.max(1, Number(folderLayout.ry || 1)) * scale * factor;
      return {
        left: cx - rx,
        right: cx + rx,
        top: cy - ry,
        bottom: cy + ry,
        width: rx * 2,
        height: ry * 2,
        cx,
        cy,
      };
    };

    const intersectsViewportBox = (box, size, marginPx = 0) => Boolean(box
      && box.right >= -marginPx
      && box.left <= size.width + marginPx
      && box.bottom >= -marginPx
      && box.top <= size.height + marginPx);

    const getViewportWorldRect = (layout, marginPx = 0) => {
      const size = getViewportSize();
      const scale = Math.max(0.01, Number(layout?.viewport?.scale || 1));
      const x = Number(layout?.viewport?.x || 0);
      const y = Number(layout?.viewport?.y || 0);
      return {
        left: (-x - marginPx) / scale,
        top: (-y - marginPx) / scale,
        right: (size.width - x + marginPx) / scale,
        bottom: (size.height - y + marginPx) / scale,
        width: (size.width + marginPx * 2) / scale,
        height: (size.height + marginPx * 2) / scale,
      };
    };

    const pointInWorldRect = (point, rect, margin = 0) => Boolean(point && rect
      && Number(point.x || 0) >= rect.left - margin
      && Number(point.x || 0) <= rect.right + margin
      && Number(point.y || 0) >= rect.top - margin
      && Number(point.y || 0) <= rect.bottom + margin);

    const folderInWorldRect = (folder, rect, margin = 0) => Boolean(folder && rect
      && Number(folder.x || 0) + Number(folder.rx || 1) >= rect.left - margin
      && Number(folder.x || 0) - Number(folder.rx || 1) <= rect.right + margin
      && Number(folder.y || 0) + Number(folder.ry || 1) >= rect.top - margin
      && Number(folder.y || 0) - Number(folder.ry || 1) <= rect.bottom + margin);

    const makeRoundedRectPath = (left, top, right, bottom, radius = 0) => {
      const x1 = Math.min(left, right);
      const x2 = Math.max(left, right);
      const y1 = Math.min(top, bottom);
      const y2 = Math.max(top, bottom);
      const r = clamp(Number(radius || 0), 0, Math.min((x2 - x1) / 2, (y2 - y1) / 2));
      if (r <= 0.001) {
        return `M ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x1.toFixed(2)} ${y2.toFixed(2)} Z`;
      }
      return [
        `M ${(x1 + r).toFixed(2)} ${y1.toFixed(2)}`,
        `L ${(x2 - r).toFixed(2)} ${y1.toFixed(2)}`,
        `Q ${x2.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${(y1 + r).toFixed(2)}`,
        `L ${x2.toFixed(2)} ${(y2 - r).toFixed(2)}`,
        `Q ${x2.toFixed(2)} ${y2.toFixed(2)} ${(x2 - r).toFixed(2)} ${y2.toFixed(2)}`,
        `L ${(x1 + r).toFixed(2)} ${y2.toFixed(2)}`,
        `Q ${x1.toFixed(2)} ${y2.toFixed(2)} ${x1.toFixed(2)} ${(y2 - r).toFixed(2)}`,
        `L ${x1.toFixed(2)} ${(y1 + r).toFixed(2)}`,
        `Q ${x1.toFixed(2)} ${y1.toFixed(2)} ${(x1 + r).toFixed(2)} ${y1.toFixed(2)}`,
        'Z',
      ].join(' ');
    };

    const makeViewportSafeSurfacePath = (layout, folderLayout) => {
      const scale = Math.max(0.01, Number(layout?.viewport?.scale || 1));
      const marginPx = FOLDER_SAFE_SURFACE_MARGIN_PX;
      const rect = getViewportWorldRect(layout, marginPx);
      const radius = Math.max(18 / scale, Math.min(Number(folderLayout.rx || 1), Number(folderLayout.ry || 1)) * 0.035);
      return makeRoundedRectPath(rect.left, rect.top, rect.right, rect.bottom, radius);
    };

    const getFolderRenderInfo = (folderLayout, layout) => {
      const size = getViewportSize();
      const box = getFolderScreenBox(folderLayout, layout);
      const visible = intersectsViewportBox(box, size, FOLDER_SAFE_RENDER_MARGIN_PX);
      if (!visible) {
        return { visible: false, dominant: false, safeSurface: false, offscreen: true, box };
      }
      const areaRatio = (box.width * box.height) / Math.max(1, size.width * size.height);
      const dimensionDominant = box.width > size.width * FOLDER_SAFE_SURFACE_DIM_RATIO
        || box.height > size.height * FOLDER_SAFE_SURFACE_DIM_RATIO;
      const areaDominant = areaRatio > FOLDER_SAFE_SURFACE_AREA_RATIO;
      const safeSurface = areaDominant || dimensionDominant;
      return {
        visible: true,
        dominant: safeSurface,
        safeSurface,
        offscreen: false,
        areaRatio,
        box,
      };
    };

    const isViewportDominantFolder = (folderLayout, layout) => getFolderRenderInfo(folderLayout, layout).dominant;

    const isReducedMotion = () => Boolean(
      typeof window !== 'undefined'
        && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );

    const isDraggedVisualId = (kind, id) => {
      if (!dragState) return false;
      if (dragState.type === 'files' && kind === 'file') return dragState.ids?.includes(id);
      if (dragState.type === 'folder' && dragState.ids?.has?.(id)) return true;
      return false;
    };

    const isDeletingVisualItem = (id) => Boolean(id && deletingVisualItems.has(id));

    const collectDeletionVisualIds = (itemIds = []) => {
      const store = getStoreSafe();
      const fileIds = new Set();
      const folderIds = new Set();
      const ids = [...new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).filter(Boolean))];
      ids.forEach((id) => {
        const item = getItem(store, id);
        if (!item || item.id === rootId) return;
        const all = new Set([item.id]);
        if (isFolder(item)) collectDescendants(store, item.id).forEach((childId) => all.add(childId));
        all.forEach((targetId) => {
          const target = getItem(store, targetId);
          if (!target || target.id === rootId) return;
          if (isFile(target)) fileIds.add(target.id);
          else folderIds.add(target.id);
        });
      });
      return { fileIds, folderIds };
    };

    const animateDeleteItems = (itemIds = []) => {
      const { fileIds, folderIds } = collectDeletionVisualIds(itemIds);
      const ids = [...folderIds, ...fileIds];
      if (!ids.length) return Promise.resolve(false);
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const startedAt = now();
      ids.forEach((id) => deletingVisualItems.set(id, { token, startedAt }));
      fileIds.forEach((id) => selectedFileIds.delete(id));
      if (selectedFolderId && folderIds.has(selectedFolderId)) selectedFolderId = rootId;
      if (armedFolderId && folderIds.has(armedFolderId)) clearFolderDragArm();
      syncClusterPreviewFromSelection();
      requestRender();
      const duration = isReducedMotion() ? 0 : DELETE_ANIMATION_MS;
      return new Promise((resolve) => {
        const done = () => {
          ids.forEach((id) => {
            const entry = deletingVisualItems.get(id);
            if (!entry || entry.token === token) deletingVisualItems.delete(id);
          });
          requestRender();
          resolve(true);
        };
        if (duration <= 0) done();
        else window.setTimeout?.(done, duration) || done();
      });
    };

    const pulseVisual = (kind, id, strength = 1) => {
      if (!id) return;
      visualState.pulses[`${kind}:${id}`] = { startedAt: now(), strength: clamp(Number(strength || 1), 0.15, 1.8) };
      visualState.animating = true;
      requestRender();
    };

    const getPulseValue = (kind, id) => {
      const key = `${kind}:${id}`;
      const pulse = visualState.pulses[key];
      if (!pulse) return 0;
      const t = clamp((now() - pulse.startedAt) / VISUAL_PULSE_MS, 0, 1);
      if (t >= 1) {
        delete visualState.pulses[key];
        return 0;
      }
      // A quick rise and a soft fade reads as feedback without looking flashy.
      return Math.sin(Math.PI * t) * Math.pow(1 - t, 0.35) * Number(pulse.strength || 1);
    };

    const makeFolderVisual = (target = {}) => ({
      x: Number(target.x || 0),
      y: Number(target.y || 0),
      rx: Number(target.rx || 1),
      ry: Number(target.ry || 1),
      color: target.color,
      seed: Number(target.seed || 1),
      manual: Boolean(target.manual),
    });

    const makeFileVisual = (target = {}) => ({
      x: Number(target.x || 0),
      y: Number(target.y || 0),
      manual: Boolean(target.manual),
    });

    const getClusterFileTarget = (id, baseTarget = {}) => {
      const cluster = visualState.cluster;
      if (!cluster || !Array.isArray(cluster.ids) || !cluster.ids.includes(id)) return baseTarget;
      const offset = cluster.offsets?.[id] || { x: 0, y: 0 };
      return {
        ...baseTarget,
        x: Number(cluster.center?.x || 0) + Number(offset.x || 0),
        y: Number(cluster.center?.y || 0) + Number(offset.y || 0),
        clusterTarget: true,
      };
    };

    const clearClusterPreview = () => {
      if (!visualState.cluster) return;
      visualState.cluster = null;
      visualState.animating = true;
    };

    const springValue = (current, target, factor) => Number(current || 0) + (Number(target || 0) - Number(current || 0)) * factor;

    const stepVisualState = (layout, store) => {
      const time = now();
      const dt = visualState.lastTickAt ? clamp(time - visualState.lastTickAt, 8, 48) : 16;
      visualState.lastTickAt = time;
      const instant = isReducedMotion() || !visualState.enteredAt;
      const folderFactor = instant ? 1 : 1 - Math.exp(-dt / VISUAL_FOLDER_EASE_MS);
      const fileFactor = instant ? 1 : 1 - Math.exp(-dt / VISUAL_FILE_EASE_MS);
      const clusterFormFactor = instant ? 1 : 1 - Math.exp(-dt / VISUAL_CLUSTER_FORM_EASE_MS);
      const folderIds = new Set(Object.keys(layout.folders || {}));
      const fileIds = new Set(Object.keys(layout.files || {}));
      const visualWorldRect = getViewportWorldRect(layout, VISUAL_ANIMATION_CULL_MARGIN_PX);
      let active = false;

      folderIds.forEach((id) => {
        const target = layout.folders[id];
        if (!target) return;
        const offscreen = id !== rootId && !folderInWorldRect(target, visualWorldRect, VISUAL_ANIMATION_CULL_MARGIN_PX);
        const direct = offscreen || isDraggedVisualId('folder', id) || (dragState?.type === 'files' && dragState.folderSnapshot?.[id]);
        let visual = visualState.folders[id];
        if (!visual || direct || instant) {
          visual = makeFolderVisual(target);
          visualState.folders[id] = visual;
        } else {
          visual.x = springValue(visual.x, target.x, folderFactor);
          visual.y = springValue(visual.y, target.y, folderFactor);
          visual.rx = springValue(visual.rx, target.rx, folderFactor * 0.82);
          visual.ry = springValue(visual.ry, target.ry, folderFactor * 0.82);
          visual.color = target.color;
          visual.seed = target.seed;
          visual.manual = target.manual;
          if (Math.abs(visual.x - target.x) > VISUAL_SETTLE_EPSILON
            || Math.abs(visual.y - target.y) > VISUAL_SETTLE_EPSILON
            || Math.abs(visual.rx - target.rx) > VISUAL_SETTLE_EPSILON
            || Math.abs(visual.ry - target.ry) > VISUAL_SETTLE_EPSILON) {
            active = true;
          } else {
            visual.x = target.x;
            visual.y = target.y;
            visual.rx = target.rx;
            visual.ry = target.ry;
          }
        }
      });

      fileIds.forEach((id) => {
        const baseTarget = layout.files[id];
        if (!baseTarget) return;
        const target = getClusterFileTarget(id, baseTarget);
        const isDraggedFile = dragState?.type === 'files' && dragState.ids?.includes(id);
        const isGroupFile = Boolean(target.clusterTarget);
        const offscreen = !pointInWorldRect(target, visualWorldRect, 48)
          && !selectedFileIds.has(id)
          && !isDeletingVisualItem(id)
          && !visualState.pulses[`file:${id}`]
          && !isGroupFile;
        const direct = instant || isDraggedFile || offscreen;
        const factor = target.clusterTarget ? clusterFormFactor : fileFactor;
        let visual = visualState.files[id];
        if (!visual || direct) {
          visual = makeFileVisual(target);
          visualState.files[id] = visual;
        } else {
          visual.x = springValue(visual.x, target.x, factor);
          visual.y = springValue(visual.y, target.y, factor);
          visual.manual = target.manual;
          const epsilon = isGroupFile ? VISUAL_SETTLE_EPSILON * 0.72 : VISUAL_SETTLE_EPSILON;
          if (Math.abs(visual.x - target.x) > epsilon
            || Math.abs(visual.y - target.y) > epsilon) {
            active = true;
          } else {
            visual.x = target.x;
            visual.y = target.y;
          }
        }
      });

      Object.keys(visualState.folders).forEach((id) => { if (!folderIds.has(id)) delete visualState.folders[id]; });
      Object.keys(visualState.files).forEach((id) => { if (!fileIds.has(id)) delete visualState.files[id]; });
      Object.keys(visualState.pulses).forEach((key) => {
        const pulse = visualState.pulses[key];
        if (!pulse || time - pulse.startedAt >= VISUAL_PULSE_MS) delete visualState.pulses[key];
        else active = true;
      });

      visualState.animating = active;
      return active;
    };

    const getVisualFolderLayout = (folderId, fallback) => visualState.folders[folderId] || fallback;
    const getVisualFileLayout = (fileId, fallback) => visualState.files[fileId] || fallback;

    const worldPointFromEvent = (event) => {
      const layout = getLayout();
      const rect = viewportEl?.getBoundingClientRect?.() || { left: 0, top: 0 };
      const sx = Number(event.clientX || 0) - rect.left;
      const sy = Number(event.clientY || 0) - rect.top;
      return {
        x: (sx - layout.viewport.x) / layout.viewport.scale,
        y: (sy - layout.viewport.y) / layout.viewport.scale,
      };
    };

    const getFolderLayoutForHit = (folderId) => {
      if (dragState?.type === 'files' && dragState.folderSnapshot?.[folderId]) {
        return dragState.folderSnapshot[folderId];
      }
      return getLayout().folders?.[folderId];
    };

    const getDeepestFolderAt = (x, y, options = {}) => {
      const store = getStoreSafe();
      const exclude = options.exclude || new Set();
      const folders = foldersByDepth(store, true);
      for (const folder of folders) {
        if (!folder || folder.id === rootId || exclude.has(folder.id)) continue;
        const folderLayout = getFolderLayoutForHit(folder.id);
        if (pointInFolder(folderLayout, x, y, Number(options.padding || 0))) return folder.id;
      }
      return exclude.has(rootId) ? '' : rootId;
    };

    const makeDropZones = (store, layout, exclude = new Set()) => foldersByDepth(store, true)
      .filter((folder) => folder && folder.id !== rootId && !exclude.has(folder.id))
      .map((folder) => ({
        id: folder.id,
        depth: getDepth(store, folder.id),
        layout: cloneFolderLayout(layout.folders?.[folder.id] || {}),
      }))
      .filter((zone) => zone.layout && Number.isFinite(zone.layout.x) && Number.isFinite(zone.layout.rx));

    const pickDropZone = (zones = [], x, y, padding = DROP_ENTER_PADDING) => {
      for (const zone of zones) {
        if (pointInFolder(zone.layout, x, y, padding)) return zone.id;
      }
      return rootId;
    };

    const isPointInsideDropZone = (zones = [], folderId, x, y, padding = 0) => {
      if (!folderId || folderId === rootId) return false;
      const zone = zones.find((item) => item.id === folderId);
      return Boolean(zone && pointInFolder(zone.layout, x, y, padding));
    };

    const updateStableDropTarget = () => {
      if (!dragState) {
        hoverFolderId = '';
        return;
      }
      const zones = dragState.dropZones || [];
      const x = dragState.type === 'folder'
        ? (getLayout({ settle: false }).folders[dragState.folderId]?.x || dragState.pointer.x)
        : dragState.pointer.x;
      const y = dragState.type === 'folder'
        ? (getLayout({ settle: false }).folders[dragState.folderId]?.y || dragState.pointer.y)
        : dragState.pointer.y;
      const previous = hoverFolderId || dragState.dropTargetId || rootId;
      const candidate = pickDropZone(zones, x, y, DROP_ENTER_PADDING);
      let next = candidate || rootId;

      // Hysteresis: crossing a soft folder boundary should not flip the target
      // back and forth on every pointer sample. Keep the current target until
      // the pointer has clearly left its enlarged boundary. A deeper folder that
      // is actually entered still wins immediately, so nested drops stay clear.
      if (previous && previous !== rootId && candidate !== previous) {
        const stillInsidePrevious = isPointInsideDropZone(zones, previous, x, y, DROP_EXIT_PADDING);
        const candidateIsReal = candidate && candidate !== rootId;
        const candidateInsideTightly = candidateIsReal
          && isPointInsideDropZone(zones, candidate, x, y, Math.max(0, DROP_ENTER_PADDING - DROP_SWITCH_DISTANCE));
        if (stillInsidePrevious && (!candidateIsReal || !candidateInsideTightly)) next = previous;
      }

      if (next !== hoverFolderId) {
        hoverFolderId = next;
        dragState.dropTargetId = next;
        dragState.dropTargetChangedAt = now();
        shell?.setAttribute?.('data-knowledge-map-drop', next && next !== rootId ? 'folder' : 'root');
      }
    };

    const updateChrome = () => {
      const store = getStoreSafe();
      const folder = getItem(store, store.currentFolderId || rootId) || getItem(store, rootId);
      if (titleEl) titleEl.textContent = folder?.id === rootId ? '知识点图谱' : `知识点图谱 · ${folder?.name || '未命名文件夹'}`;
      if (!hintEl) return;
      if (dragState?.type === 'folder') hintEl.textContent = '正在拖动文件夹区域：内部文件点和子文件夹会整体跟随。';
      else if (dragState?.type === 'files' && hoverFolderId) hintEl.textContent = hoverFolderId === rootId ? '松手后移动到根知识仓库。' : '松手后移动到该文件夹区域。';
      else if (armedFolderId && now() <= armedFolderUntil) hintEl.textContent = '文件夹已进入拖动准备：再次按住该文件夹区域即可拖动。';
      else if (selectedFileIds.size > 1) hintEl.textContent = `已选择 ${selectedFileIds.size} 个知识点，拖动任意一个会聚拢为点群。`;
      else hintEl.textContent = '左键拖动画布；右键框选文件点；文件点直接跟随光标；左键双击文件夹区域并按住第二次点击可拖动文件夹。';
    };

    const applyWorldTransform = () => {
      const layout = getLayout();
      if (!worldLayer) return;
      worldLayer.setAttribute('transform', `translate(${layout.viewport.x.toFixed(2)} ${layout.viewport.y.toFixed(2)}) scale(${layout.viewport.scale.toFixed(4)})`);
    };

    const createFolderNode = (folderId) => {
      const g = createSvg('g', 'knowledge-map-folder');
      g.dataset.folderId = folderId;

      const halo = createSvg('path', 'knowledge-map-folder-halo');
      const path = createSvg('path', 'knowledge-map-folder-blob');
      const rim = createSvg('path', 'knowledge-map-folder-rim');
      const label = createSvg('text', 'knowledge-map-folder-label');

      [halo, path, rim, label].forEach((node) => {
        node.addEventListener('pointerdown', (event) => handleFolderPointerDown(event, folderId));
        node.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      });

      g.appendChild(halo);
      g.appendChild(path);
      g.appendChild(rim);
      g.appendChild(label);
      return { g, halo, path, rim, label };
    };

    const removeCachedFolderNode = (id) => {
      const cached = renderCache.folders.get(id);
      if (cached?.g?.parentNode) cached.g.parentNode.removeChild(cached.g);
      renderCache.folders.delete(id);
    };

    const renderFolders = () => {
      if (!folderLayer) return;
      const store = getStoreSafe();
      const layout = getLayout({ settle: false });
      const visibleIds = new Set();
      const viewportWorldRect = getViewportWorldRect(layout, RENDER_FOLDER_CULL_MARGIN_PX);
      foldersByDepth(store, false).forEach((folder) => {
        if (folder.id === rootId) return;
        const targetFolderLayout = dragState?.type === 'files' && dragState.folderSnapshot?.[folder.id]
          ? dragState.folderSnapshot[folder.id]
          : layout.folders[folder.id];
        if (!targetFolderLayout) {
          removeCachedFolderNode(folder.id);
          return;
        }
        const folderLayout = getVisualFolderLayout(folder.id, targetFolderLayout);
        if (!folderInWorldRect(folderLayout, viewportWorldRect, RENDER_FOLDER_CULL_MARGIN_PX)) {
          removeCachedFolderNode(folder.id);
          return;
        }
        const renderInfo = getFolderRenderInfo(folderLayout, layout);
        if (!renderInfo.visible) {
          removeCachedFolderNode(folder.id);
          return;
        }
        visibleIds.add(folder.id);
        let cached = renderCache.folders.get(folder.id);
        if (!cached) {
          cached = createFolderNode(folder.id);
          renderCache.folders.set(folder.id, cached);
        }
        if (cached.g.parentNode !== folderLayer) folderLayer.appendChild(cached.g);
        else folderLayer.appendChild(cached.g);

        const depth = getDepth(store, folder.id);
        const isRoot = folder.id === rootId;
        const { g, halo, path, rim, label } = cached;
        g.classList.toggle('is-root', isRoot);
        g.classList.toggle('is-selected', selectedFolderId === folder.id);
        g.classList.toggle('is-drop-target', hoverFolderId === folder.id);
        g.classList.toggle('is-dragging', dragState?.type === 'folder' && dragState.folderId === folder.id);
        g.classList.toggle('is-drag-armed', armedFolderId === folder.id && now() <= armedFolderUntil);
        g.classList.toggle('is-deleting', isDeletingVisualItem(folder.id));
        const pulse = getPulseValue('folder', folder.id);
        g.style.setProperty('--map-pulse', pulse.toFixed(3));
        if (pulse > 0.001 && !renderInfo.dominant) {
          g.style.filter = `drop-shadow(0 0 ${(10 + pulse * 16).toFixed(1)}px rgba(132,216,255,${(0.10 + pulse * 0.16).toFixed(3)}))`;
        } else {
          g.style.removeProperty('filter');
        }

        const isDominantSurface = renderInfo.dominant;
        const isSafeSurface = renderInfo.safeSurface;
        g.classList.toggle('is-dominant-surface', isDominantSurface);
        g.classList.toggle('is-safe-surface', isSafeSurface);
        const influence = (dragState?.type === 'files' || isDominantSurface) ? [] : getFolderInfluencePoints(store, layout, folder.id);
        const pathD = isSafeSurface
          ? makeViewportSafeSurfacePath(layout, folderLayout)
          : makeFolderPath(folderLayout, influence, isRoot ? 84 : 72);
        const color = folderLayout.color || colorForId(folder.id);

        halo.setAttribute('d', pathD);
        halo.setAttribute('stroke', color);
        halo.style.setProperty('--folder-depth', String(depth));

        path.setAttribute('d', pathD);
        path.setAttribute('fill', color);
        path.setAttribute('stroke', color);
        path.style.setProperty('--folder-depth', String(depth));

        rim.setAttribute('d', pathD);
        rim.setAttribute('stroke', color);
        rim.style.setProperty('--folder-depth', String(depth));

        label.setAttribute('x', String(folderLayout.x));
        label.setAttribute('y', String(folderLayout.y - Math.max(30, folderLayout.ry * 0.62)));
        const nextLabel = isRoot ? '知识仓库' : (folder.name || '未命名文件夹');
        if (label.textContent !== nextLabel) label.textContent = nextLabel;
      });
      Array.from(renderCache.folders.keys()).forEach((id) => {
        if (!visibleIds.has(id)) removeCachedFolderNode(id);
      });
    };

    const makeDragPressureContext = (store, layout, visibleFiles = []) => {
      if (!dragState || dragState.type !== 'files') return null;
      const activeIds = dragState.ids || [];
      const activeSet = new Set(activeIds);
      const activeParents = new Set(activeIds.map((id) => getItem(store, id)?.parentId || rootId));
      const activePoints = activeIds.map((id) => layout.files?.[id]).filter(Boolean);
      const visibleParentCounts = Object.create(null);
      visibleFiles.forEach((file) => {
        const parentId = file.parentId || rootId;
        visibleParentCounts[parentId] = (visibleParentCounts[parentId] || 0) + 1;
      });
      let cluster = null;
      if (activePoints.length > DRAG_PRESSURE_CLUSTER_LIMIT) {
        const cx = activePoints.reduce((sum, point) => sum + Number(point.x || 0), 0) / activePoints.length;
        const cy = activePoints.reduce((sum, point) => sum + Number(point.y || 0), 0) / activePoints.length;
        let radius = 0;
        activePoints.forEach((point) => {
          radius = Math.max(radius, Math.hypot(Number(point.x || 0) - cx, Number(point.y || 0) - cy));
        });
        cluster = { x: cx, y: cy, radius: Math.min(92, radius + 12) };
      }
      return { activeIds, activeSet, activeParents, activePoints, cluster, visibleParentCounts };
    };

    const getDragPressureOffset = (file, visualPoint, layout, pressureContext = null) => {
      if (!pressureContext || !dragState || dragState.type !== 'files' || pressureContext.activeSet.has(file.id)) return { x: 0, y: 0 };
      const fileParent = file.parentId || rootId;
      if (!pressureContext.activeParents.has(fileParent)) return { x: 0, y: 0 };

      let ox = 0;
      let oy = 0;
      const parentCount = pressureContext.visibleParentCounts[fileParent] || 0;
      const useCluster = pressureContext.cluster || parentCount > DRAG_PRESSURE_PARENT_FILE_LIMIT;
      if (useCluster) {
        const active = pressureContext.cluster || (() => {
          const points = pressureContext.activePoints;
          const cx = points.reduce((sum, point) => sum + Number(point.x || 0), 0) / Math.max(1, points.length);
          const cy = points.reduce((sum, point) => sum + Number(point.y || 0), 0) / Math.max(1, points.length);
          return { x: cx, y: cy, radius: 18 };
        })();
        const dx = Number(visualPoint.x || 0) - Number(active.x || 0);
        const dy = Number(visualPoint.y || 0) - Number(active.y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const influence = DRAG_PRESSURE_DISTANCE + Number(active.radius || 0) * 0.36;
        if (dist < influence) {
          const t = 1 - dist / influence;
          const force = t * t * DRAG_PRESSURE_MAX_OFFSET;
          ox += (dx / dist) * force;
          oy += (dy / dist) * force;
        }
      } else {
        pressureContext.activePoints.forEach((activePoint) => {
          const dx = Number(visualPoint.x || 0) - Number(activePoint.x || 0);
          const dy = Number(visualPoint.y || 0) - Number(activePoint.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist >= DRAG_PRESSURE_DISTANCE) return;
          const t = 1 - dist / DRAG_PRESSURE_DISTANCE;
          const force = t * t * DRAG_PRESSURE_MAX_OFFSET;
          ox += (dx / dist) * force;
          oy += (dy / dist) * force;
        });
      }

      const mag = Math.sqrt(ox * ox + oy * oy);
      if (mag > DRAG_PRESSURE_MAX_OFFSET) {
        const scale = DRAG_PRESSURE_MAX_OFFSET / mag;
        ox *= scale;
        oy *= scale;
      }
      return { x: ox, y: oy };
    };

    const createFileNode = (fileId) => {
      const g = createSvg('g', 'knowledge-map-file');
      g.dataset.fileId = fileId;
      const title = createSvg('title');
      const hit = createSvg('circle', 'knowledge-map-file-hit');
      hit.setAttribute('r', '16');
      const dot = createSvg('circle', 'knowledge-map-file-dot');
      g.addEventListener('pointerdown', (event) => handleFilePointerDown(event, fileId));
      g.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFileFromMap(fileId, { fromNativeDblClick: true });
      });
      g.appendChild(title);
      g.appendChild(hit);
      g.appendChild(dot);
      return { g, title, hit, dot };
    };

    const removeCachedFileNode = (id) => {
      const cached = renderCache.files.get(id);
      if (cached?.g?.parentNode) cached.g.parentNode.removeChild(cached.g);
      renderCache.files.delete(id);
    };

    const renderFiles = () => {
      if (!fileLayer) return;
      const store = getStoreSafe();
      const layout = getLayout({ settle: false });
      const viewportWorldRect = getViewportWorldRect(layout, RENDER_FILE_CULL_MARGIN_PX);
      const visibleFiles = [];
      getItems(store).filter(isFile).forEach((file) => {
        const targetPoint = layout.files[file.id];
        if (!targetPoint) return;
        const point = getVisualFileLayout(file.id, targetPoint);
        const mustRender = selectedFileIds.has(file.id)
          || isDeletingVisualItem(file.id)
          || getPulseValue('file', file.id) > 0.001
          || (dragState?.type === 'files' && dragState.ids?.includes(file.id));
        if (!mustRender && !pointInWorldRect(point, viewportWorldRect, 36)) {
          removeCachedFileNode(file.id);
          return;
        }
        visibleFiles.push(file);
      });
      const visibleIds = new Set(visibleFiles.map((file) => file.id));
      const pressureContext = makeDragPressureContext(store, layout, visibleFiles);
      visibleFiles.forEach((file) => {
        const targetPoint = layout.files[file.id];
        if (!targetPoint) {
          removeCachedFileNode(file.id);
          return;
        }
        const point = getVisualFileLayout(file.id, targetPoint);
        const pressure = getDragPressureOffset(file, point, layout, pressureContext);
        let cached = renderCache.files.get(file.id);
        if (!cached) {
          cached = createFileNode(file.id);
          renderCache.files.set(file.id, cached);
        }
        if (cached.g.parentNode !== fileLayer) fileLayer.appendChild(cached.g);
        else fileLayer.appendChild(cached.g);

        const { g, title, dot } = cached;
        const filePulse = getPulseValue('file', file.id);
        const isDraggingFile = dragState?.type === 'files' && dragState.ids?.includes(file.id);
        const scale = isDraggingFile ? 1.22 : (1 + filePulse * 0.34);
        g.setAttribute('transform', `translate(${Number(point.x + pressure.x).toFixed(2)} ${Number(point.y + pressure.y).toFixed(2)}) scale(${scale.toFixed(3)})`);
        g.style.setProperty('--map-pulse', filePulse.toFixed(3));
        g.classList.toggle('is-selected', selectedFileIds.has(file.id));
        g.classList.toggle('is-dragging', isDraggingFile);
        g.classList.toggle('is-deleting', isDeletingVisualItem(file.id));
        dot.setAttribute('r', selectedFileIds.has(file.id) ? '4.7' : '4.2');
        const nextTitle = file.name || '未命名文件';
        if (title.textContent !== nextTitle) title.textContent = nextTitle;
      });
      Array.from(renderCache.files.keys()).forEach((id) => {
        if (!visibleIds.has(id)) removeCachedFileNode(id);
      });
    };

    const renderOverlay = () => {
      if (!overlayLayer) return;
      overlayLayer.replaceChildren();
      if (selectionState) {
        const x1 = Math.min(selectionState.start.x, selectionState.current.x);
        const y1 = Math.min(selectionState.start.y, selectionState.current.y);
        const x2 = Math.max(selectionState.start.x, selectionState.current.x);
        const y2 = Math.max(selectionState.start.y, selectionState.current.y);
        const rect = createSvg('rect', 'knowledge-map-selection-rect');
        rect.setAttribute('x', String(x1));
        rect.setAttribute('y', String(y1));
        rect.setAttribute('width', String(x2 - x1));
        rect.setAttribute('height', String(y2 - y1));
        overlayLayer.appendChild(rect);
      }
      if (dragState && hoverFolderId && hoverFolderId !== rootId) {
        const layout = getLayout({ settle: false });
        const target = getVisualFolderLayout(hoverFolderId, layout.folders?.[hoverFolderId]);
        if (target) {
          const ring = createSvg('ellipse', 'knowledge-map-drop-ring');
          ring.setAttribute('cx', String(Number(target.x || 0)));
          ring.setAttribute('cy', String(Number(target.y || 0)));
          ring.setAttribute('rx', String(Math.max(1, Number(target.rx || 1) * 1.045)));
          ring.setAttribute('ry', String(Math.max(1, Number(target.ry || 1) * 1.045)));
          overlayLayer.appendChild(ring);
        }
      }
    };

    const render = () => {
      if (!mapView || !svg || !worldLayer) return;
      const store = getStoreSafe();
      const layout = ensureLayout(store, { settle: false });
      const stillAnimating = stepVisualState(layout, store);
      mapView.classList?.toggle?.('is-settling', Boolean(stillAnimating));
      applyWorldTransform();
      renderFolders();
      renderFiles();
      renderOverlay();
      updateChrome();
      lastRenderAt = now();
      if (stillAnimating || visualState.animating) {
        requestRender();
      }
    };

    const requestRender = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame?.(() => {
        rafId = 0;
        render();
      }) || window.setTimeout(() => {
        rafId = 0;
        render();
      }, 16);
    };

    const saveLayoutOnly = () => {
      const layout = getLayout();
      layout.selectedFileIds = Array.from(selectedFileIds);
      saveStore?.();
    };

    const syncStore = (options = {}) => {
      const layout = settleAndSave({ lockedIds: options.lockedIds || new Set() });
      selectedFileIds.clear();
      (layout.selectedFileIds || []).forEach((id) => selectedFileIds.add(id));
      syncClusterPreviewFromSelection();
      const targetFolderId = options.focusFolderId || '';
      const shouldFocus = Boolean(
        targetFolderId
          && (options.forceFocus || options.initialFocus || !layout.viewport.userControlled)
      );
      if (shouldFocus) {
        focusFolder(targetFolderId, {
          immediate: Boolean(options.immediate),
          persist: false,
          force: Boolean(options.forceFocus || options.initialFocus),
        });
      } else {
        selectedFolderId = targetFolderId || selectedFolderId || rootId;
        requestRender();
      }
    };

    const moveViewportTo = (target, options = {}) => {
      const layout = getLayout();
      const from = { ...layout.viewport };
      const to = normalizeViewport(target);
      const nextViewport = {
        ...to,
        userControlled: options.userControlled ?? Boolean(to.userControlled),
        focusedFolderId: String(options.focusedFolderId || to.focusedFolderId || ''),
        updatedAt: now(),
      };
      if (options.immediate) {
        layout.viewport = normalizeViewport(nextViewport);
        saveLayoutOnly();
        render();
        return;
      }
      viewportAnimation = { from, to: normalizeViewport(nextViewport), startedAt: now(), duration: 520 };
      tickViewportAnimation();
    };

    function tickViewportAnimation() {
      if (!viewportAnimation) return;
      const layout = getLayout();
      const t = clamp((now() - viewportAnimation.startedAt) / viewportAnimation.duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      layout.viewport = normalizeViewport({
        x: viewportAnimation.from.x + (viewportAnimation.to.x - viewportAnimation.from.x) * eased,
        y: viewportAnimation.from.y + (viewportAnimation.to.y - viewportAnimation.from.y) * eased,
        scale: viewportAnimation.from.scale + (viewportAnimation.to.scale - viewportAnimation.from.scale) * eased,
        userControlled: viewportAnimation.to.userControlled,
        focusedFolderId: viewportAnimation.to.focusedFolderId,
        updatedAt: viewportAnimation.to.updatedAt,
      });
      render();
      if (t < 1) window.requestAnimationFrame?.(tickViewportAnimation);
      else {
        viewportAnimation = null;
        saveLayoutOnly();
      }
    }

    function focusFolder(folderId = rootId, options = {}) {
      const layout = settleAndSave();
      const folder = layout.folders[folderId] || layout.folders[rootId];
      if (!folder || !viewportEl) {
        requestRender();
        return;
      }
      selectedFolderId = folderId;
      const rect = viewportEl.getBoundingClientRect?.() || { width: 900, height: 560 };
      const width = Math.max(320, rect.width || 900);
      const height = Math.max(240, rect.height || 560);
      const scaleX = width / Math.max(1, folder.rx * 2.42);
      const scaleY = height / Math.max(1, folder.ry * 2.55);
      const targetScale = clamp(Math.min(scaleX, scaleY), 0.22, folderId === rootId ? 1.08 : 1.78);
      moveViewportTo({
        x: width / 2 - folder.x * targetScale,
        y: height / 2 - folder.y * targetScale,
        scale: targetScale,
        userControlled: options.force ? false : Boolean(layout.viewport.userControlled),
        focusedFolderId: folderId,
      }, {
        ...options,
        userControlled: options.force ? false : Boolean(layout.viewport.userControlled),
        focusedFolderId: folderId,
      });
      if (options.persist) saveLayoutOnly();
    }

    const makeClusterOffsets = (ids = []) => {
      const offsets = {};
      if (ids.length <= 1) {
        if (ids[0]) offsets[ids[0]] = { x: 0, y: 0 };
        return offsets;
      }

      // A selected group should read as a small organic cluster, not a square
      // grid. Use a deterministic golden-angle packing with tiny per-id jitter:
      // compact enough for dragging, round enough to feel natural, and stable
      // enough that the same selection does not reshuffle every frame.
      const ordered = ids.map((id, index) => ({ id, index }));
      const seed = hashString(ordered.map((entry) => entry.id).join('|'));
      const angleOffset = ((seed % 720) / 720) * Math.PI * 2;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      const raw = ordered.map(({ id, index }) => {
        if (index === 0) return { id, x: 0, y: 0 };
        const jitterSeed = hashString(`${id}:${index}:${seed}`);
        const jitterA = ((jitterSeed % 997) / 997 - 0.5) * 2;
        const jitterB = (((jitterSeed >>> 8) % 991) / 991 - 0.5) * 2;
        const angle = angleOffset + index * goldenAngle + jitterA * 0.13;
        const radius = FILE_CLUSTER_GAP * (0.42 + Math.sqrt(index) * 0.58);
        const oval = 0.86 + ((seed >>> 5) % 18) / 100;
        return {
          id,
          x: Math.cos(angle) * radius + jitterB * 1.4,
          y: Math.sin(angle) * radius * oval + jitterA * 1.2,
        };
      });

      const mean = raw.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
      mean.x /= raw.length;
      mean.y /= raw.length;
      raw.forEach((point) => {
        offsets[point.id] = { x: point.x - mean.x, y: point.y - mean.y };
      });
      return offsets;
    };

    const getFileVisualOrLayoutPoint = (layout, id) => {
      const visual = visualState.files[id];
      const target = layout.files?.[id];
      if (visual) return { x: Number(visual.x || 0), y: Number(visual.y || 0) };
      if (target) return { x: Number(target.x || 0), y: Number(target.y || 0) };
      return null;
    };

    const getClusterCenter = (ids = [], layout = getLayout()) => {
      const points = ids.map((id) => getFileVisualOrLayoutPoint(layout, id)).filter(Boolean);
      if (!points.length) return { x: 0, y: 0 };
      return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      };
    };

    const startClusterPreview = (ids = [], options = {}) => {
      const cleanIds = Array.from(new Set(ids)).filter((id) => getLayout().files?.[id]);
      if (cleanIds.length <= 1) {
        clearClusterPreview();
        return;
      }
      const offsets = options.offsets || makeClusterOffsets(cleanIds);
      const center = options.center || getClusterCenter(cleanIds, getLayout());
      visualState.cluster = {
        ids: cleanIds,
        offsets,
        center: { x: Number(center.x || 0), y: Number(center.y || 0) },
        startedAt: now(),
      };
      visualState.animating = true;
      requestRender();
    };

    const syncClusterPreviewFromSelection = () => {
      const ids = Array.from(selectedFileIds).filter((id) => getLayout().files?.[id]);
      if (ids.length > 1) startClusterPreview(ids);
      else clearClusterPreview();
    };

    const getVisibleFilePointForSelection = (fileId, layout) => {
      const target = layout?.files?.[fileId];
      if (!target) return null;
      const visual = getVisualFileLayout(fileId, target) || target;
      return {
        x: Number.isFinite(Number(visual.x)) ? Number(visual.x) : Number(target.x || 0),
        y: Number.isFinite(Number(visual.y)) ? Number(visual.y) : Number(target.y || 0),
        targetX: Number(target.x || 0),
        targetY: Number(target.y || 0),
      };
    };

    const selectionHitPadding = (layout) => {
      const scale = Math.max(0.2, Number(layout?.viewport?.scale || 1));
      return Math.max(5, Math.min(18, 12 / scale));
    };

    const isVisibleFileInsideSelectionRect = (fileId, rect, layout) => {
      const point = getVisibleFilePointForSelection(fileId, layout);
      if (!point) return false;
      const pad = selectionHitPadding(layout);
      const insideVisible = point.x >= rect.x1 - pad
        && point.x <= rect.x2 + pad
        && point.y >= rect.y1 - pad
        && point.y <= rect.y2 + pad;
      if (insideVisible) return true;

      // During the short settle animation after dropping a point group into a
      // folder, the user sees the animated visual point while graphLayout already
      // holds the post-drop target. Accept both coordinates so right-box select
      // always matches what is on screen and never gets lost at folder boundaries.
      return point.targetX >= rect.x1 - pad
        && point.targetX <= rect.x2 + pad
        && point.targetY >= rect.y1 - pad
        && point.targetY <= rect.y2 + pad;
    };

    const snapshotFolders = () => {
      const layout = getLayout();
      const snapshot = {};
      Object.keys(layout.folders || {}).forEach((id) => {
        snapshot[id] = cloneFolderLayout(layout.folders[id]);
      });
      return snapshot;
    };

    const clearFileDoubleState = () => {
      lastFileClick = { id: '', time: 0, x: 0, y: 0 };
    };

    const detectFileDoubleDown = (event, fileId) => {
      if (!fileId) {
        clearFileDoubleState();
        return false;
      }
      const t = now();
      const dx = Number(event.clientX || 0) - Number(lastFileClick.x || 0);
      const dy = Number(event.clientY || 0) - Number(lastFileClick.y || 0);
      const matched = lastFileClick.id === fileId
        && t - Number(lastFileClick.time || 0) <= FILE_DOUBLE_CLICK_MS
        && Math.sqrt(dx * dx + dy * dy) <= FILE_DOUBLE_CLICK_DISTANCE;
      lastFileClick = { id: fileId, time: t, x: Number(event.clientX || 0), y: Number(event.clientY || 0) };
      return matched;
    };

    const openFileFromMap = (fileId, options = {}) => {
      if (!fileId || mapView?.classList?.contains?.('is-opening-file')) return false;
      // The SVG node is rebuilt during the first click's selection render, so
      // relying on native dblclick is unreliable. When our pointer-down double
      // detector opens a file, suppress the following browser dblclick fallback
      // if it still arrives.
      if (options.fromNativeDblClick && suppressNextOpen) {
        suppressNextOpen = false;
        return false;
      }
      suppressNextOpen = true;
      window.setTimeout?.(() => { suppressNextOpen = false; }, FILE_DOUBLE_CLICK_MS + 80);
      clearFileDoubleState();
      clearFolderDoubleState();
      selectedFileIds.clear();
      clearClusterPreview();
      openFile?.(fileId, { source: 'knowledge-map', animateMapTransition: true });
      return true;
    };

    const detectFolderDoubleDown = (event, folderId) => {
      if (!folderId || folderId === rootId) {
        lastFolderClick = { id: '', time: 0, x: 0, y: 0 };
        return false;
      }
      const t = now();
      const dx = Number(event.clientX || 0) - Number(lastFolderClick.x || 0);
      const dy = Number(event.clientY || 0) - Number(lastFolderClick.y || 0);
      const matched = lastFolderClick.id === folderId
        && t - Number(lastFolderClick.time || 0) <= FOLDER_DOUBLE_CLICK_MS
        && Math.sqrt(dx * dx + dy * dy) <= FOLDER_DOUBLE_CLICK_DISTANCE;
      lastFolderClick = { id: folderId, time: t, x: Number(event.clientX || 0), y: Number(event.clientY || 0) };
      return matched;
    };

    const clearFolderDoubleState = () => {
      lastFolderClick = { id: '', time: 0, x: 0, y: 0 };
    };

    const armFolderDrag = (folderId) => {
      if (!folderId || folderId === rootId) return;
      armedFolderId = folderId;
      armedFolderUntil = now() + 1600;
      selectedFolderId = folderId;
      requestRender();
    };

    const isFolderDragArmed = (folderId) => folderId
      && folderId !== rootId
      && armedFolderId === folderId
      && now() <= armedFolderUntil;

    const clearFolderDragArm = () => {
      armedFolderId = '';
      armedFolderUntil = 0;
    };

    function beginFileDrag(event, fileId) {
      event.preventDefault();
      event.stopPropagation();
      const layout = getLayout();
      if (!event.shiftKey && !selectedFileIds.has(fileId)) selectedFileIds.clear();
      if (event.shiftKey && selectedFileIds.has(fileId)) selectedFileIds.delete(fileId);
      else selectedFileIds.add(fileId);
      const ids = Array.from(selectedFileIds).filter((id) => layout.files[id]);
      const start = worldPointFromEvent(event);
      const clusterOffsets = makeClusterOffsets(ids);
      dragState = {
        type: 'files',
        ids,
        start,
        pointer: start,
        moved: false,
        folderSnapshot: snapshotFolders(),
        clusterOffsets,
        dropZones: makeDropZones(getStoreSafe(), layout, new Set()),
        dropTargetId: rootId,
        dropTargetChangedAt: now(),
      };
      if (ids.length > 1) {
        clearClusterPreview();
        ids.forEach((id) => {
          const file = layout.files[id];
          const offset = clusterOffsets[id] || { x: 0, y: 0 };
          if (!file) return;
          file.x = start.x + offset.x;
          file.y = start.y + offset.y;
          file.manual = true;
        });
      } else {
        clearClusterPreview();
      }
      window.addEventListener('pointermove', handleDragMove, true);
      window.addEventListener('pointerup', handleDragEnd, true);
      requestRender();
    }

    function beginFolderDrag(event, folderId) {
      if (!folderId || folderId === rootId) return;
      event.preventDefault();
      event.stopPropagation();
      const store = getStoreSafe();
      const layout = getLayout();
      const descendants = collectDescendants(store, folderId);
      const ids = new Set([folderId, ...descendants]);
      const start = worldPointFromEvent(event);
      const baseFolders = {};
      const baseFiles = {};
      ids.forEach((id) => {
        if (layout.folders[id]) baseFolders[id] = { x: layout.folders[id].x, y: layout.folders[id].y };
        if (layout.files[id]) baseFiles[id] = { x: layout.files[id].x, y: layout.files[id].y };
      });
      dragState = {
        type: 'folder',
        folderId,
        ids,
        start,
        pointer: start,
        moved: false,
        baseFolders,
        baseFiles,
        dropZones: makeDropZones(store, layout, ids),
        dropTargetId: rootId,
        dropTargetChangedAt: now(),
      };
      selectedFolderId = folderId;
      clearFolderDoubleState();
      clearFolderDragArm();
      window.addEventListener('pointermove', handleDragMove, true);
      window.addEventListener('pointerup', handleDragEnd, true);
      requestRender();
    }

    function handleFilePointerDown(event, fileId) {
      if (event.button !== 0) return;
      if (mapView?.classList?.contains?.('is-opening-file')) {
        event.preventDefault?.();
        event.stopPropagation?.();
        return;
      }
      if (detectFileDoubleDown(event, fileId)) {
        event.preventDefault?.();
        event.stopPropagation?.();
        openFileFromMap(fileId);
        return;
      }
      beginFileDrag(event, fileId);
    }

    function handleFolderPointerDown(event, folderId) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (folderId === rootId) {
        selectedFolderId = rootId;
        clearFolderDoubleState();
        beginPan(event);
        return;
      }
      selectedFolderId = folderId;
      if (isFolderDragArmed(folderId) || detectFolderDoubleDown(event, folderId)) {
        beginFolderDrag(event, folderId);
        return;
      }
      beginPan(event);
    }

    function updateDropTarget() {
      updateStableDropTarget();
    }

    function repelOtherFilesDuringDrag(layout) {
      if (!dragState || dragState.type !== 'files') return;
      const store = getStoreSafe();
      const active = new Set(dragState.ids);
      const activePoints = dragState.ids.map((id) => layout.files[id]).filter(Boolean);
      if (!activePoints.length) return;
      const activeParents = new Set(dragState.ids.map((id) => getItem(store, id)?.parentId || rootId));
      getItems(store).filter(isFile).forEach((file) => {
        if (active.has(file.id)) return;
        if (!activeParents.has(file.parentId || rootId)) return;
        const point = layout.files[file.id];
        if (!point) return;
        activePoints.forEach((activePoint) => {
          const dx = Number(point.x || 0) - Number(activePoint.x || 0);
          const dy = Number(point.y || 0) - Number(activePoint.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist >= FILE_REPEL_DISTANCE) return;
          const force = (FILE_REPEL_DISTANCE - dist) * 0.13;
          point.x += (dx / dist) * force;
          point.y += (dy / dist) * force;
        });
      });
    }

    function handleDragMove(event) {
      if (!dragState) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      const point = worldPointFromEvent(event);
      const dx = point.x - dragState.start.x;
      const dy = point.y - dragState.start.y;
      if (Math.abs(dx) + Math.abs(dy) > MIN_DRAG_DISTANCE) dragState.moved = true;
      dragState.pointer = point;
      const layout = getLayout({ settle: false });
      if (dragState.type === 'files') {
        dragState.ids.forEach((id) => {
          const file = layout.files[id];
          if (!file) return;
          const offset = dragState.clusterOffsets[id] || { x: 0, y: 0 };
          file.x = point.x + offset.x;
          file.y = point.y + offset.y;
          file.manual = true;
        });
        // Neighbor reaction is visual-only during drag; real layout is settled on drop.
      } else if (dragState.type === 'folder') {
        Object.entries(dragState.baseFolders).forEach(([id, base]) => {
          const folder = layout.folders[id];
          if (!folder) return;
          folder.x = base.x + dx;
          folder.y = base.y + dy;
          folder.manual = true;
        });
        Object.entries(dragState.baseFiles).forEach(([id, base]) => {
          const file = layout.files[id];
          if (!file) return;
          file.x = base.x + dx;
          file.y = base.y + dy;
          file.manual = true;
        });
      }
      updateDropTarget();
      requestRender();
    }

    async function handleDragEnd(event) {
      if (!dragState) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      window.removeEventListener('pointermove', handleDragMove, true);
      window.removeEventListener('pointerup', handleDragEnd, true);
      const finished = dragState;
      const layout = getLayout({ settle: false });
      dragState = null;
      shell?.removeAttribute?.('data-knowledge-map-drop');
      hoverFolderId = '';
      if (finished.moved) {
        suppressNextOpen = true;
        if (finished.type === 'files') clearFileDoubleState();
      }

      if (finished.type === 'files' && finished.moved) {
        const targetFolderId = finished.dropTargetId || hoverFolderId || pickDropZone(finished.dropZones || [], finished.pointer.x, finished.pointer.y, DROP_ENTER_PADDING) || rootId;
        const droppedIds = [...new Set(finished.ids || [])].filter((id) => getStoreSafe().items?.some?.((item) => item?.id === id && item.type === 'file'));
        await moveItemsToFolder?.(finished.ids, targetFolderId);
        // A multi-point group is a temporary operation state. Once it has been
        // dropped into a folder area, leave selection mode so the points settle
        // naturally inside the destination. They can still be selected again by
        // right-drag boxing their visible positions.
        if (targetFolderId && targetFolderId !== rootId && droppedIds.length > 1) {
          selectedFileIds.clear();
        }
        pulseVisual('folder', targetFolderId, 1);
        finished.ids.forEach((id) => pulseVisual('file', id, 0.85));
        syncClusterPreviewFromSelection();
      } else if (finished.type === 'files' && !finished.moved) {
        syncClusterPreviewFromSelection();
      } else if (finished.type === 'folder' && !finished.moved) {
        armFolderDrag(finished.folderId);
      } else if (finished.type === 'folder' && finished.moved) {
        const folderLayout = layout.folders[finished.folderId];
        const testX = folderLayout?.x || finished.pointer.x;
        const testY = folderLayout?.y || finished.pointer.y;
        const targetFolderId = finished.dropTargetId || hoverFolderId || pickDropZone(finished.dropZones || [], testX, testY, DROP_ENTER_PADDING) || rootId;
        const movedToNewParent = await moveItemsToFolder?.([finished.folderId], targetFolderId);
        if (movedToNewParent && targetFolderId && targetFolderId !== rootId) {
          const wrappedLayout = getLayout({ settle: false });
          forceWrapFolder(getStoreSafe(), wrappedLayout, targetFolderId);
        }
        pulseVisual('folder', finished.folderId, 0.95);
        if (targetFolderId) pulseVisual('folder', targetFolderId, 1.10);
      }

      settleAndSave({ lockedIds: finished.type === 'folder' ? new Set([finished.folderId]) : new Set() });
      renderList?.({ source: 'knowledge-map-drag' });
      requestRender();
      window.setTimeout(() => { suppressNextOpen = false; }, 180);
    }

    function beginPan(event) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const layout = getLayout();
      panState = {
        startClientX: Number(event.clientX || 0),
        startClientY: Number(event.clientY || 0),
        baseViewport: { ...layout.viewport },
        moved: false,
      };
      mapView?.classList?.add('is-panning');
      window.addEventListener('pointermove', handlePanMove, true);
      window.addEventListener('pointerup', handlePanEnd, true);
    }

    function handlePanMove(event) {
      if (!panState) return;
      event.preventDefault?.();
      const dx = Number(event.clientX || 0) - panState.startClientX;
      const dy = Number(event.clientY || 0) - panState.startClientY;
      if (Math.abs(dx) + Math.abs(dy) > MIN_DRAG_DISTANCE) panState.moved = true;
      const layout = getLayout();
      layout.viewport = normalizeViewport({
        x: panState.baseViewport.x + dx,
        y: panState.baseViewport.y + dy,
        scale: panState.baseViewport.scale,
        userControlled: true,
        focusedFolderId: layout.viewport.focusedFolderId,
        updatedAt: now(),
      });
      requestRender();
    }

    function handlePanEnd(event) {
      if (!panState) return;
      event.preventDefault?.();
      window.removeEventListener('pointermove', handlePanMove, true);
      window.removeEventListener('pointerup', handlePanEnd, true);
      const moved = panState.moved;
      panState = null;
      mapView?.classList?.remove('is-panning');
      if (!moved && !event.shiftKey) selectedFileIds.clear();
      syncClusterPreviewFromSelection();
      saveLayoutOnly();
      requestRender();
    }

    function beginSelection(event) {
      event.preventDefault?.();
      event.stopPropagation?.();
      const start = worldPointFromEvent(event);
      selectionState = { start, current: start, append: event.shiftKey };
      mapView?.classList?.add('is-selecting');
      window.addEventListener('pointermove', handleSelectionMove, true);
      window.addEventListener('pointerup', handleSelectionEnd, true);
      requestRender();
    }

    function handleSelectionMove(event) {
      if (!selectionState) return;
      event.preventDefault?.();
      selectionState.current = worldPointFromEvent(event);
      requestRender();
    }

    function handleSelectionEnd(event) {
      if (!selectionState) return;
      event.preventDefault?.();
      window.removeEventListener('pointermove', handleSelectionMove, true);
      window.removeEventListener('pointerup', handleSelectionEnd, true);
      const start = selectionState.start;
      const current = selectionState.current;
      const rect = {
        x1: Math.min(start.x, current.x),
        y1: Math.min(start.y, current.y),
        x2: Math.max(start.x, current.x),
        y2: Math.max(start.y, current.y),
      };
      const area = Math.abs(rect.x2 - rect.x1) * Math.abs(rect.y2 - rect.y1);
      const append = selectionState.append;
      selectionState = null;
      mapView?.classList?.remove('is-selecting');
      if (area < 16) {
        if (!append) selectedFileIds.clear();
        syncClusterPreviewFromSelection();
        saveLayoutOnly();
        requestRender();
        return;
      }
      const layout = getLayout();
      if (!append) selectedFileIds.clear();
      getItems(getStoreSafe()).filter(isFile).forEach((file) => {
        if (isVisibleFileInsideSelectionRect(file.id, rect, layout)) selectedFileIds.add(file.id);
      });
      syncClusterPreviewFromSelection();
      saveLayoutOnly();
      requestRender();
    }

    function handleBackgroundPointerDown(event) {
      if (!mapView) return;
      if (event.button === 2) {
        beginSelection(event);
        return;
      }
      if (event.target?.closest?.('.knowledge-map-file, .knowledge-map-folder')) return;
      if (event.button === 0) {
        clearFolderDoubleState();
        clearFolderDragArm();
        beginPan(event);
      }
    }

    function handleWheel(event) {
      if (!viewportEl || !mapView || mapView.getAttribute('aria-hidden') === 'true') return;
      event.preventDefault();
      const layout = getLayout();
      const rect = viewportEl.getBoundingClientRect();
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const before = {
        x: (screen.x - layout.viewport.x) / layout.viewport.scale,
        y: (screen.y - layout.viewport.y) / layout.viewport.scale,
      };
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = clamp(layout.viewport.scale * factor, 0.2, 2.6);
      layout.viewport = normalizeViewport({
        scale: nextScale,
        x: screen.x - before.x * nextScale,
        y: screen.y - before.y * nextScale,
        userControlled: true,
        focusedFolderId: layout.viewport.focusedFolderId,
        updatedAt: now(),
      });
      saveLayoutOnly();
      render();
    }

    function show(options = {}) {
      if (!mapView) return;
      clearFileOpenLeaveState();
      const wasHidden = mapView.getAttribute('aria-hidden') === 'true' || mapView.hidden;
      mapView.hidden = false;
      mapView.setAttribute('aria-hidden', 'false');
      shell && (shell.dataset.knowledgeMap = 'visible');
      if (wasHidden) scheduleRevealPrewarm();
      if (!visualState.enteredAt) visualState.enteredAt = now();
      const layout = getLayout();
      const defaultViewport = Math.abs(layout.viewport.x) < 0.001
        && Math.abs(layout.viewport.y) < 0.001
        && Math.abs(layout.viewport.scale - 1) < 0.001;
      syncStore({
        focusFolderId: options.focusFolderId || getStoreSafe()?.currentFolderId || rootId,
        immediate: Boolean(options.immediate),
        initialFocus: Boolean(wasHidden && !layout.viewport.userControlled && defaultViewport),
        forceFocus: Boolean(options.forceFocus),
      });
    }

    const clearFileOpenLeaveState = () => {
      if (!mapView) return;
      mapView.classList.remove('is-opening-file');
      delete mapView.dataset.openingFileId;
    };

    async function leaveForFileOpen(options = {}) {
      if (!mapView) return false;
      const fileId = String(options.fileId || '');
      clearFileOpenLeaveState();
      mapView.hidden = false;
      mapView.setAttribute('aria-hidden', 'true');
      if (fileId) mapView.dataset.openingFileId = fileId;
      mapView.classList.add('is-opening-file');
      shell && (shell.dataset.knowledgeMap = 'leaving-file-open');
      requestRender();
      if (!isReducedMotion()) {
        await wait(MAP_TO_FILE_LEAVE_MS);
      }
      clearFileOpenLeaveState();
      shell && (shell.dataset.knowledgeMap = 'hidden');
      return true;
    }

    function hide() {
      if (!mapView) return;
      clearFileOpenLeaveState();
      mapView.setAttribute('aria-hidden', 'true');
      shell && (shell.dataset.knowledgeMap = 'hidden');
    }

    function attachEvents() {
      if (!viewportEl || attachEvents._attached) return;
      attachEvents._attached = true;
      viewportEl.addEventListener('pointerdown', handleBackgroundPointerDown, true);
      viewportEl.addEventListener('contextmenu', (event) => event.preventDefault());
      viewportEl.addEventListener('wheel', handleWheel, { passive: false });
      window.addEventListener('resize', () => {
        if (shell?.dataset?.module !== 'knowledge' || shell?.dataset?.knowledgeHasFile === 'true') return;
        const layout = getLayout();
        if (layout.viewport.userControlled) requestRender();
        else focusFolder(getStoreSafe()?.currentFolderId || rootId, { initial: true });
      });
    }

    attachEvents();
    requestRender();

    return {
      show,
      hide,
      render,
      requestRender,
      syncStore,
      focusFolder,
      animateDeleteItems,
      leaveForFileOpen,
      ensureLayout: () => ensureLayout(getStoreSafe(), { settle: true }),
      debugSelectedFileIds: () => Array.from(selectedFileIds),
      debugLastRenderAt: () => lastRenderAt,
    };
  };

  window.KnowledgeMap = {
    createKnowledgeMapController,
    ensureLayout,
    pointInFolder,
    debugCollectDescendants: collectDescendants,
  };
}());
