# Design Decisions

## Labels Over Folders

Stork is **deliberately opinionated** about email organization: it uses **labels** instead of folders.

Most email clients mirror the IMAP folder tree — rigid, single-parent hierarchies where a message can only live in one place. This made sense when browsing folders was the primary way to find email. It doesn't anymore. If your email client has good search, you rarely navigate by folder.

Stork takes the Gmail approach: when email syncs from an IMAP folder, the folder name becomes a **suggested label** automatically applied to incoming messages. But labels aren't folders — a message can have multiple labels, labels are easy to create and manage, and your organizational system isn't locked to what your IMAP server happens to expose.

**How it works:**
- IMAP folders are still synced for tracking sync state (UIDs, UIDVALIDITY)
- Each folder name automatically becomes a label (source: `imap`)
- New messages get the label matching their IMAP folder
- You can add, remove, and create your own labels freely
- The sidebar shows labels with unread counts, not a folder tree
- Search works across all labels — no more hunting through folders

This is a deliberate design choice: **search is the primary navigation, labels are the primary organization**. If you want traditional folder-based browsing, Stork isn't the right fit — and that's okay.
