# Knowledge File Q0 First Screen And Fingerprint Navigation Fix

## Problem

Opening a knowledge file should always show that file's `Q0` first. However,
that first-screen rule must not make the file behave as a locked Q0 page.
After the file is open, clicking a fingerprint / selected-text marker in the
content area should still navigate to the corresponding follow-up node and show
that node's question and answer.

The previous version restored knowledge files with `activeQuestionId = Q0`, but
some unforced content renders were still blocked by the workbench history-panel
render guard. Knowledge files reuse the same content renderer as the workbench,
but they are not workbench history sessions. Therefore, when the shell was in
knowledge mode and the workbench panel dataset still looked like `history`, a
fingerprint click could update `activeQuestionId` without remounting the content
page.

## Fix

`frontend/renderer.js` now separates these two cases:

- Workbench history list: still blocks generic unforced content renders to avoid
  the old post-enter flash.
- Knowledge file active: bypasses that history-list guard, so node navigation
  inside the current knowledge file can render normally.

A helper was added:

```js
const isKnowledgeFileActive = () =>
  shell?.dataset?.module === 'knowledge' && Boolean(knowledgeWarehouseController?.getActiveFileId?.());
```

The content-render wrapper and `learningContentRenderKey` subscription both use
this helper. This keeps the intended first-open behavior:

```text
open knowledge file -> show Q0 first
```

but preserves normal in-file navigation afterward:

```text
click Q0 fingerprint -> active child node renders -> child answer is shown
click tree / graph node -> corresponding node renders
```

## Files changed

- `frontend/renderer.js`
