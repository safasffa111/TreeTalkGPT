# Content flicker final stability fix

This patch targets the two remaining post-animation flashes in the workbench content panel:

1. Creating a main question while the assist panel is in the history-list state.
2. Popping the last open stack item so the bottom action changes from pop/output to return-history.

## Root causes

### History list -> new Q0

Q0 creation triggered request/status effects while the assist panel was still in `history` mode. Those effects called `renderActiveNodePage()` directly. Later `workbench-history.enterSessionView()` also rendered the same content through the queued history/session transition. The same content could therefore be mounted once before the transition and once during the transition; after the enter animation settled, the follow-up request/status render replayed the default `.content-message` animation.

### Pop state -> return-history state

The content render key included `stackStatus`. Popping a node changes tree/button state, but it does not change the visible question or answer. Including `stackStatus` caused the same content to remount when only the bottom action state changed, which looked like a flash after the content enter animation.

## Fixes

- `renderer.js` now blocks unforced content renders while the workbench panel is still in history mode. Only `workbench-history.enterSessionView()` owns the content enter render for history -> session transitions.
- `app-store.js` and the renderer fallback key now exclude `stackStatus` from the content render key. Tree and graph keys still include it, so stack status indicators remain correct.
- `workbench-renderer.js` marks non-transition content mounts as settled immediately. This prevents the base `.content-message { animation: messageIn }` animation from replaying after store-driven same-node updates such as request-started/request-settled.
- `workbench-effects.js` calls content rendering with `animate: false` for API lifecycle updates.

## Regression rules

- History-list mode must not mount Q0 content before `enterSessionView()`.
- `stackStatus` changes must update tree/graph/buttons, not remount content.
- Same-node content updates should not replay default message entry animations.
