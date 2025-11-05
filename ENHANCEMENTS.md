# Project Enhancements (Consolidated)

This document consolidates optional enhancements, feature ideas, and the current status for the MyWhiteboard project. The original, more verbose notes have been archived under `docs/archive/` for reference.

## Summary

- Location of archived originals: `docs/archive/`
- Purpose: keep the repository root clean while preserving the original planning notes.

## High-level status (selected items)

- Backend sync (sessions persistence & multi-device): IN PROGRESS / PARTIALLY IMPLEMENTED
  - A lightweight server exists under `server/` and now supports persisting `pages` with validation limits.
  - Next: formalize API contracts and authentication for production readiness.

- Real-time collaboration (WebSocket): PARTIALLY IMPLEMENTED
  - Server and client support a `page:update` WebSocket message for single-page updates; clients receive and apply per-page updates.
  - Next: add conflict resolution strategy (OT/CRDT) for concurrent edits.

- Per-page modularity and PageManager: IMPLEMENTED
  - `pageManager.js` was added to split PDFs into page objects, manage per-page annotations (vector strokes), serialize/deserialize pages, and emit page-level events.

- Annotation tools & UI (undo, color, clear): IMPLEMENTED (basic)
  - Per-page annotation toolbar added. Undo stack and clear are implemented. Additional tools (text, shapes) remain to be added.

- Thumbnail sidebar & SidebarManager: PARTIALLY IMPLEMENTED
  - Sidebar thumbs exist and reflect page changes with a soft flash and changed-badge.
  - Full plugin API (reorderable modules, persisted layout) is scaffolded but not finished.

- Export annotated PDFs: TODO / PLANNED
  - Recommended approach: integrate `pdf-lib` to merge annotation canvases back into a single PDF for download.

- Cloud storage / user accounts / auth: TODO


## Files archived

The original optional/notes files have been moved to `docs/archive/`:

- `docs/archive/Optional_Enhancements.MD` (original optional enhancements and roadmap)
- `docs/archive/PDFModularity.MD` (notes on treating each PDF page as an independent object)
- `docs/archive/RealtimeCollabfeatures.md` (ideas and diagrams for the modular sidebar, chat, thumbnails)

If you need to restore them to the repo root, copy from `docs/archive/` back to the repo root. The archive is intended as a read-only reference.

## Next recommended steps

1. Finalize SidebarManager module API and persist layout (order/size/collapsed state) in `localStorage` or session config.
2. Add export support via `pdf-lib` to produce annotated PDFs.
3. Harden the server API (auth, rate limits, partial uploads) and document the session API.
4. Stabilize real-time sync: choose a conflict-resolution strategy and add tests for concurrent edits.
5. Add more annotation tools (text, shapes, multiple colors) and tests for stroke serialization.

## Notes

- The three archived docs contain more detailed proposals and diagrams (Mermaid) for SidebarManager, PageManager, and deployment approaches. Consult `docs/archive/` for full text.

---
Generated and consolidated by the project maintainer tooling.
