# Attachment menu plus-button anchor final fix

This patch fixes the prompt attachment menu position after the previous fixed-position implementation could still drift toward the middle of the prompt.

## Root cause

The menu should visually behave like ChatGPT: it should open above the `+` button at the left side of the prompt box.

The previous implementation tried to position the menu using viewport coordinates, but the menu lived inside the prompt dock. Under custom Electron window layouts, sidebar widths, zoom, and prompt transitions, the fixed-position coordinates could diverge from the prompt box's visual position, so the popover appeared near the middle of the prompt.

## Fix

`frontend/modules/attachment-controller.js` now:

1. Measures the real `.prompt-dock`, `.prompt-box`, and `.prompt-attach` rectangles.
2. Uses the `+` button as the visual anchor.
3. Places the menu above the prompt box with the first menu icon aligned near the `+` icon.
4. Clamps the viewport position inside `.workspace` so it cannot be hidden under the left sidebar.
5. Converts the final viewport coordinates back into `.prompt-dock` local coordinates.

`frontend/styles.css` changes `.attach-menu` back to `position: absolute` so the local coordinates are applied consistently.

## Expected behavior

The popover should open above the prompt's left `+` button, not centered over the prompt input and not hidden behind the auxiliary/history column.
