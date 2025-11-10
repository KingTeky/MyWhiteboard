# Changelog

All notable changes to this project will be documented in this file.

## [v0.1.0] - 2025-11-10
- MVP snapshot
  - Implemented PageManager (per-page objects, thumbnails, annotation storage)
  - SidebarManager and Quick Jump module (first-page-only thumbnails, order badges)
  - WebSocket server and session persistence for development (`server/index.js`)
  - Deterministic server/local merge policy for chart ordering
  - jsdom smoke test for Quick Jump (`tests/quickjump-smoke.js`)
  - Documented enhancements and consolidated roadmap in `ENHANCEMENTS.md`
