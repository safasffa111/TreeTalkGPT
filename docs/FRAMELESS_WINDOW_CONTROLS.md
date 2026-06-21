# Frameless Window Controls

Baseline: `codex_style_desktop_shell_v9_background_request_lifecycle_fix`.

This patch adds three borderless icon buttons in the top-right corner of the frameless Electron window:

- Hide window: calls `window:minimize`.
- Maximize / restore window: calls `window:maximize`, which toggles between maximized and normal size.
- Close window: calls `window:close`.

## Files changed

- `frontend/index.html`
- `frontend/modules/dom-refs.js`
- `frontend/renderer.js`
- `frontend/styles.css`
- `backend/preload.js`
- `backend/main.js`

## Notes

The buttons are fixed outside the main app grid and use `-webkit-app-region: no-drag`, while the surrounding frameless surface remains draggable. The maximize button tracks window state through a small IPC state event so its icon and label can switch between maximize and restore.
