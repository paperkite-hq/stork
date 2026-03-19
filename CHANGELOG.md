# Changelog

## v0.1.0-alpha (2026-03-19)

First tagged release. Core functionality is working:

- **IMAP sync** — incremental sync from any IMAP server with proper MIME parsing and attachment extraction
- **SQLite storage** — local storage with FTS5 full-text search
- **SMTP sending** — compose, reply, and reply-all via configured SMTP server
- **Web UI** — inbox view, message threads, compose modal, search panel, keyboard shortcuts, dark mode, mobile responsive
- **Sync scheduling** — connection pooling and automatic refresh for multi-account setups
- **Docker deployment** — single-container with Docker Compose or direct `docker run`
- **First-run experience** — welcome screen guides new users through IMAP configuration
