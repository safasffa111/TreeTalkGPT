# Central State Migration Completion Notes

This version finishes the migration that should be completed before removing the legacy stackState mirror.

## What is now migrated

- Learning node creation, patching, messages, request lifecycle, pop, reset, selection, attachments, rich-context mode, and graph viewport all go through appStore commands first.
- Workbench content/tree/graph renderers read from appStore first.
- The learning state machine derives its phase from appStore first.
- Prompt construction and attachment UI read appStore first.
- Graph pan/zoom/layout state lives in `appStore.ui.graph` and syncs back to the legacy mirror only for compatibility.
- API request side effects are isolated in `workbench-effects.js`.

## Stability boundary added in this version

The renderer no longer subscribes to the whole `learningData` object. It subscribes to narrow render keys instead:

- `learningContentRenderKey`: only changes when the active content page really needs to rebuild.
- `learningTreeRenderKey`: only changes when the tree needs to rebuild.
- `learningGraphRenderKey`: only changes when graph nodes/edges need to rebuild.
- `promptUiRenderKey`: selection, attachments, rich-context chip, send/pop state, and placeholder.
- `graphViewport`: pan/zoom transform only, no content rebuild.

This prevents transient UI state from destroying the content panel DOM.

## Content panel rule

`renderActiveNodePage()` is destructive because it calls `replaceChildren()`. It now has a render key guard, so repeated store notifications do not rebuild the content panel unless the active node content actually changed.

These events must never force a content rebuild:

- mouse selection / `selectionchange`
- attachment add/remove
- rich context toggle
- graph pan/zoom/position updates
- hover / focus / button enabled state

## Remaining legacy code

Some `state` / `stackState` fallback code intentionally remains. It is no longer the preferred runtime path. It exists so older controllers and emergency fallback behavior still work.

Do not delete `stack-state.js` yet. The safe next step is to keep it as a compatibility mirror until persistence/export is added and the Electron UI has been manually tested.

## Estimated migration state

- Required central-store migration: complete enough for continued product work.
- Legacy fallback removal: intentionally deferred.
- Recommended next work: persistence, export, streaming, and a small regression checklist, not more broad migration.
