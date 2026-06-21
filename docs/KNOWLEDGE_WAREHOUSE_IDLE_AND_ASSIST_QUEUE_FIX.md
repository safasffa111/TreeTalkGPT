# Knowledge Warehouse Idle State & Assist Transition Queue Fix

Base: `v9_attach_menu_plus_button_anchor_final_fix` + knowledge warehouse MVP.

## Changes

1. When the knowledge warehouse has no active file, the workspace content area is intentionally blank:
   - the content stream is cleared;
   - the prompt dock is hidden;
   - attachments and attach menu are hidden;
   - prompt submission stays disabled until a file is opened.

2. Module switching now uses a queued transition runner:
   - rapid switching between Knowledge Warehouse, Workbench, Settings, and Error Logs keeps only the latest requested target;
   - assist-panel fade-out/fade-in animations no longer overlap by clearing timers mid-animation.

3. In wide assist mode, the knowledge warehouse does not show any list/tree/graph by default.
   - It stays empty unless a knowledge file is active and the user explicitly enters the file's logic view with the arrow button.
   - Normal assist mode remains the file/folder list.

## Notes

The knowledge file content page still reuses the workbench content renderer, selection, follow-up, tree, graph, and stack behavior after a file has been opened.
