# Knowledge Warehouse File Right-click Rename Fix

## Problem

The knowledge warehouse list supported inline rename for folders through right-click, but files could only be opened from the list. Users expected files to behave the same way as folders: right-click an item in the knowledge warehouse list, edit its display name inline, press Enter or blur to commit.

## Fix

- Added a generic `startRenameItem(itemId)` path for both folders and files.
- Kept `startRenameFolder(itemId)` as a compatibility wrapper.
- Added `startRenameFile(itemId)` for tests and future callers.
- Changed list item `contextmenu` handling so any non-root item can enter inline rename mode.
- File rename now:
  - updates the file item's `name`;
  - keeps sibling file names unique by appending ` 2`, ` 3`, ... when needed;
  - updates file session metadata title when a session snapshot exists;
  - refreshes the list and knowledge map labels;
  - preserves the file's Q0/Q1 tree, answer text, follow-up state, and folder location.

## Behavior

- Right-click a file in the knowledge warehouse list: enter inline rename.
- Press Enter: commit.
- Blur outside input: commit.
- Press Escape with an empty value: fall back to a safe default name.
- Right-click folders still works as before.

## Tests

Added:

```bash
node tests/test_knowledge_file_rename.js
```

Validated with the existing syntax and regression tests.
