# Project Enhancements (Consolidated)

This document consolidates optional enhancements and feature ideas discovered across the repository. Each suggestion includes a short description, source attribution, and a recommended priority/next step.

Files used as sources:
- `Optional_Enhancements.MD` (root)
- `PDFModularity.MD` (root)
- `RealtimeCollabfeatures.md` (root)
- `docs/archive/Optional_Enhancements.MD`
- `docs/archive/PDFModularity.MD`
- `docs/archive/RealtimeCollabfeatures.md`

## Consolidated enhancement list

These are the feature ideas and enhancements collected from the repository docs. Where helpful I added a brief implementation note or recommended next step.

1. Backend sync (sessions persistence & multi-device)

    - Description: Add a lightweight backend to persist sessions, charts, and optionally annotations so sessions can be resumed on another device.
    - Source: `Optional_Enhancements.MD`, `README.md`
    - Priority: High for multi-device testing (medium for MVP)
    - Next step: Finalize API contracts under `server/` and add authentication/validation.

2. Real-time collaboration (WebSocket driven)

    - Description: Use WebSockets to share per-page updates and chat messages across connected clients. Consider OT/CRDT conflict-resolution for concurrent annotation edits.
    - Source: `RealtimeCollabfeatures.md`, `Optional_Enhancements.MD`, `README.md`
    - Priority: High (complex)
    - Next step: Add a message schema (page:update, chart:reorder, chat:message) and a server-side dispatcher; wire a simple authoritative-merge or CRDT approach.

3. Page-level modularity (PageManager + PDF.js)

    - Description: Treat each PDF page as an independent object with its own annotation layer, enabling per-page reorder/duplicate/delete and per-page serialization.
    - Source: `PDFModularity.MD`, `docs/archive/PDFModularity.MD`
    - Priority: High (enables many UI improvements)
    - Next step: Introduce PDF.js rendering per page and refactor current monolithic PDF logic into `PageManager`.

4. Sidebar plugin system (SidebarManager + Module API)

    - Description: Convert the right-hand dock into a pluggable module system. Modules (Quick Jump / Thumbnails, Chat, Timers, Cues) implement a small API (id, title, render, resize, collapse, destroy).
    - Source: `RealtimeCollabfeatures.md`, `docs/archive/RealtimeCollabfeatures.md`
    - Priority: High
    - Next step: Scaffold `SidebarManager` and define the Module API; migrate existing thumbnails/quick-jump and chat into the new contract.

5. Quick Jump / Thumbnails improvements

    - Description: Quick Jump should show a compact preview list (first page per uploaded chart by default), numeric order badges, and be reorder-aware (use `AppState.charts` when available). Ensure the floating Quick Jump and sidebar module render identically.
    - Source: repo issues and `RealtimeCollabfeatures.md` (implementation notes exist in code)
    - Priority: Medium
    - Next step: Keep Quick Jump rendering consistent with Organize mode ordering and ensure it reacts to `charts:changed` events.

6. Reorder & merge policy (server vs local ordering)

    - Description: When reorders happen locally and server echoes arrive, implement a deterministic merge that preserves the director's local relative order and appends server-only additions. Add a short grace window to ignore immediate server echoes of the local action.
    - Source: internal notes (implemented/experimented in `app.js`) and `RealtimeCollabfeatures.md`
    - Priority: Medium
    - Next step: Add unit tests for merge behavior and observe in multi-client testing.

7. Annotation tools / UX improvements

    - Description: Expand annotation tooling beyond the red pen: colors, shapes, text insertion, eraser, and layer locking; add Undo/Redo across pages and sessions.
    - Source: `Optional_Enhancements.MD`, `PDFModularity.MD`, `README.md`
    - Priority: Medium
    - Next step: Design a plugin for annotation tools and wire the undo stack per page in `PageManager`.

8. Export annotated PDFs

    - Description: Merge annotation canvases back into a single PDF for download using `pdf-lib` or similar.
    - Source: `ENHANCEMENTS.md`, `Optional_Enhancements.MD`, `PDFModularity.MD`
    - Priority: Medium
    - Next step: Prototype a serverless export using `pdf-lib` in the browser and evaluate performance for large scores.

9. Cloud storage and user accounts

    - Description: Optional integration with S3/Firebase/Supabase for persistent PDF storage and user accounts for libraries and access control.
    - Source: `Optional_Enhancements.MD`, `README.md`
    - Priority: Low–Medium
    - Next step: Decide on auth model (session codes vs full accounts) and create a storage adapter interface.

10. Mobile packaging

    - Description: Wrap the app with Capacitor or Cordova for an installable app and improved offline behavior.
    - Source: `Optional_Enhancements.MD`, `README.md`
    - Priority: Low
    - Next step: Evaluate touch/gestures and build a minimal Capacitor wrapper.

11. UI accessibility and readability

    - Description: Ensure Live/Concert Mode uses large, readable pages; make Quick Jump small and unobtrusive; support keyboard shortcuts, large font chat, and high-contrast annotation colors.
    - Source: `PDFModularity.MD`, `RealtimeCollabfeatures.md`, `README.md`
    - Priority: High (for performance use)

12. Testing and CI

    - Description: Add unit tests for pure logic (merge algorithm, session lifecycle), and jsdom-based smoke tests for UI modules (Quick Jump). Add a GitHub Actions job to run the smoke test on push/PR.
    - Source: `README.md` (smoke test mention) and test files already added in repo
    - Priority: Medium
    - Next step: Add a lightweight action that runs Node and the smoke test; require green checks on PRs.

13. Security and production hardening

    - Description: Harden server API (rate limits, auth), sanitize uploads, and add logging/observability for session lifecycle events.
    - Source: `ENHANCEMENTS.md`, `README.md`
    - Priority: High for production deployments

## Recommended immediate roadmap (short list)

1. Stabilize session lifecycle and API contracts (server) — critical for multi-device testing.
2. Implement SidebarManager & Module API and migrate Quick Jump + Chat into it.
3. Refactor to PageManager + PDF.js page-by-page rendering.
4. Add server WebSocket plumbing and a simple authoritative merge for urgent collaboration needs; iterate toward CRDT/OT for annotation-level concurrency.
5. Add export via `pdf-lib` and write tests for export correctness.

## Archive and sources

Full original notes and diagrams are preserved in `docs/archive/`:
- `docs/archive/Optional_Enhancements.MD`
- `docs/archive/PDFModularity.MD`
- `docs/archive/RealtimeCollabfeatures.md`

If you want a shorter roadmap or a proposed sprint breakdown (2–4 week plan), tell me how many dev-weeks you want to budget and I will produce a sprint-by-sprint plan and rough task estimates.

---
_This ENHANCEMENTS.md was updated by consolidating suggestions from the repository's top-level docs and archived planning notes._

