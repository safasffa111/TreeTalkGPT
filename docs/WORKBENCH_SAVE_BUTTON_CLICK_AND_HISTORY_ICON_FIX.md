# Workbench save icon click and history back icon fix

## Fixes

1. The per-question save-to-knowledge button in the workbench tree is now mounted above the full-width tree row button.
   The tree row button spans the full row, so the save icon needs its own z-index layer and pointer-event guards.
2. The save icon now stops `pointerdown`, `mousedown`, and `click` propagation before the tree node can open itself.
3. The workbench history return button is rendered as a visible borderless left-arrow icon (`←`) and is re-synchronized after returning from the knowledge module.

## Verified

- `node --check frontend/*.js`
- `node --check frontend/modules/*.js`
- `node --check backend/*.js`
- Static checks for the tree save button z-index / event guards and the history back arrow glyph.
