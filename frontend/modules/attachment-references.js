// Shared attachment-reference helpers used before physical file deletion.
(function () {
  const normalizeAttachmentId = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 96);
  };

  const addAttachmentList = (list = [], target = new Set()) => {
    (Array.isArray(list) ? list : []).forEach((attachment) => {
      const id = normalizeAttachmentId(attachment?.id);
      if (id) target.add(id);
    });
    return target;
  };

  const collectFromLearningData = (learning = {}, target = new Set()) => {
    if (!learning || typeof learning !== 'object') return target;
    addAttachmentList(learning.selectedAttachments, target);
    (Array.isArray(learning.nodes) ? learning.nodes : []).forEach((node) => {
      addAttachmentList(node?.attachments, target);
    });
    return target;
  };

  const collectFromSession = (snapshot = {}, target = new Set()) => {
    if (!snapshot || typeof snapshot !== 'object') return target;
    collectFromLearningData(snapshot.learning || {}, target);
    addAttachmentList(snapshot.attachments?.selectedAttachments, target);
    return target;
  };

  const collectFromKnowledgeItems = (items = [], target = new Set()) => {
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (item?.type === 'file' && item.session) collectFromSession(item.session, target);
    });
    return target;
  };

  const toArray = (ids = new Set()) => [...ids].filter(Boolean);

  window.AttachmentReferences = {
    addAttachmentList,
    collectFromKnowledgeItems,
    collectFromLearningData,
    collectFromSession,
    normalizeAttachmentId,
    toArray,
  };
}());
