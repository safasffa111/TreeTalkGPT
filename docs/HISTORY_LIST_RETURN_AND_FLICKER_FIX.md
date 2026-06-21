# History list return and assist flicker fix

This patch fixes two history/workbench behavior issues:

1. When switching from the history list into the tree/graph session panel, the
   assist panel could visually flicker once after the fade-in completed. The root
   cause was a late overlap between the outer panel fade and inner tree/graph
   node entry animations. The history controller now uses a queued assist-panel
   transition guard (`is-assist-panel-transitioning`) and a settled class so the
   active panel does not fall back into a second transition after its own fade-in
   completes.

2. The previous delete/reset entry points are now non-destructive history returns.
   Pressing Enter in the former reset state or clicking the bottom reset/delete
   button now saves the current learning session and returns to the history list
   instead of clearing the historical session. The visible content fades out before
   the workspace mirror is cleared for the new-history-list state.

The original `main-tree-reset` controller is intentionally kept as a fallback for
older embeddings, but the v9 workbench flow routes the UI entry points through
`workbenchHistoryController.enterHistoryList({ clearWorkspace: true })`.
