# Knowledge warehouse folder back header fix

This change updates the normal-width knowledge warehouse file list navigation.

## Changes

- Removed the breadcrumb row such as `全部 / 矩阵` from the visible UI.
- Removed the separate `返回上级` row from the file list.
- Added an icon-only, borderless left-arrow button next to the knowledge warehouse title.
- The title now displays the current folder name when inside a folder.
- Clicking the left-arrow title button returns to the parent folder.
- At the root level, the left-arrow button is hidden.

## Scope

This change only affects the normal-width knowledge warehouse list view. It does not change file opening, tree/graph switching, workbench logic, or the content area.
