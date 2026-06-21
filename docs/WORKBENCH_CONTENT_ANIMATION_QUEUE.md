# Workbench Content Animation Queue

This version adds a dedicated transition boundary for the workbench content panel.

## Goals

- Deleting/resetting the current learning tree keeps the content text mounted long enough to fade out.
- Switching between different questions fades the old content out, swaps the DOM once, then fades the new content in.
- Typewriter completion no longer triggers a destructive full content re-render, so the scroll position is not forced back to the top.
- Selection, attachments, graph pan/zoom, and other transient UI states remain outside the content-page transition path.

## Implementation

`frontend/modules/workbench-renderer.js` owns a small promise queue:

1. `runContentLeave()` applies `.content-stream.is-content-leaving`.
2. After the leave duration, the content DOM is swapped once.
3. `runContentEnter()` applies `.content-stream.is-content-entering`.
4. New render requests during a transition are serialized and stale requests are skipped by request id.

The queue only animates when the active question id changes. Same-node updates, such as request state changes, loading text, or answer body updates, do not use the page switch animation.

## Scroll rule

`renderActiveNodePage()` only scrolls to the top when the active question changes, or when the caller explicitly passes `scrollTop: true`.

`answer-typewriter:tick` and `answer-typewriter:completed` are ignored by the content render subscription because the typewriter patches the answer body directly.

## CSS

The classes are defined in `frontend/styles.css`:

- `.content-stream.is-content-leaving`
- `.content-stream.is-content-entering`
- `@keyframes workbenchContentPageOut`
- `@keyframes workbenchContentPageIn`

Reduced-motion users get no transition animation.
