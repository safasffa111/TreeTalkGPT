# Workbench Save Subtree To Knowledge Fix

This patch tightens the workbench "save problem subtree to knowledge warehouse" flow.

## Changes

1. Saving from the workbench tree now creates a truly independent knowledge file tree.
   - The clicked workbench question becomes the new root node `Q0`.
   - Its descendant questions are remapped to `Q1`, `Q2`, ... in preorder.
   - Parent/child links are rebuilt against the new ids.
   - The original ids are preserved on each node as `sourceNodeId` and in session metadata as `sourceIdMap`.

2. The saved file keeps the important learning context.
   - Question text
   - Follow-up descendants
   - Selected source text / formula / code context
   - Full answer and displayed/typing answer fields
   - Messages linked to the included subtree only
   - Node status and annotations

3. The saved knowledge file is always inserted into the knowledge warehouse root folder.

4. The workbench title plus button was visually aligned with the title text.
