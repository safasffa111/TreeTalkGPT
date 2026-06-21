# Knowledge warehouse: workbench switch preservation and delete icon animation

## Fixed: workbench content disappeared when switching to knowledge warehouse

Previously `enterKnowledgeModule()` treated the knowledge warehouse idle state as a destructive reset:

```text
switch to knowledge warehouse with no active knowledge file
→ appStore.resetLearningTree()
→ clear content
→ switch back to workbench
→ current question/answer disappeared
```

This is incorrect because the knowledge warehouse idle state is only a UI state. The workbench session and any in-flight AI request must remain alive.

Now switching to an empty knowledge warehouse:

```text
saves current session
clears only visible content DOM
keeps appStore learning tree
keeps questionStack
keeps in-flight request lifecycle
```

When switching back to workbench, `renderer.js` forces a content re-render from the preserved store when the workbench is in session mode.

## Fixed: delete mode icons animate in/out with a queue

The delete mode no longer re-renders the file list when toggled. The delete buttons already exist in each row, so toggling mode only changes shell data state. This allows CSS exit animations to complete.

Delete icon animation now uses:

```text
enter: rotate + blur fade-in
exit: rotate + blur fade-out
```

Fast clicks are managed by a delete-mode transition queue:

```text
requestDeleteMode(target)
→ applyDeleteModeTransition(target)
→ pending target is drained after the current transition
```

This prevents animation overlap and avoids cutting off exit animations with `replaceChildren()`.
