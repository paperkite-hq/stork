# Stork vs Bichon

Stork and Bichon are both self-hosted, Docker-friendly tools for managing your email locally. But they solve different problems: Stork is an email client; Bichon is an email archiver. This page explains the differences.

## At a Glance

| | Stork | Bichon |
|---|---|---|
| **What it is** | Self-hosted email client | Self-hosted email archiver |
| **Primary use** | Read, search, compose, send email | Archive and search email (read-only) |
| **Deployment** | Docker (single container) | Docker or standalone binary |
| **Encryption at rest** | ✅ AES-256 via SQLCipher | ❌ |
| **Storage format** | SQLite (encrypted) | EML files + Tantivy index |
| **Full-text search** | ✅ FTS5 | ✅ Tantivy (Rust-based) |
| **Web UI** | ✅ React | ✅ React |
| **Compose & send** | ✅ SMTP | ❌ Read-only |
| **Label-based organization** | ✅ | ❌ |
| **Recovery key** | ✅ BIP39 mnemonic | ❌ |
| **Self-contained** | ✅ | ✅ |

## Architecture Differences

**Bichon** is an email archiver, not a client. It ingests email from IMAP (or other sources) and stores each message as an individual EML file on disk, with a Tantivy search index for fast retrieval. The web UI lets you browse and search your archive, but you can't reply, forward, or compose new messages. Bichon is designed for long-term preservation — it's optimized for ingesting large mailboxes and making them searchable.

**Stork** is a full email client. It syncs from IMAP into an encrypted SQLite database, provides full-text search, and lets you compose, reply, forward, and send email via SMTP. It's designed to replace your webmail interface, not just archive old mail.

```
Bichon architecture:
  Browser → Bichon server → EML files (plain text on disk)
                           → Tantivy index (search)
                           → IMAP server (ingest source)

Stork architecture:
  Browser → Stork server → SQLite/SQLCipher (encrypted, single file)
                          → IMAP server (sync source)
                          → SMTP server (sending)
```

### Storage Model

Bichon stores each email as an individual `.eml` file. This has advantages for archival: EML is a standard format, and you can process the files with any tool that reads RFC 5322. The downside is managing potentially hundreds of thousands of small files, and no encryption at rest — your email is readable on disk.

Stork stores everything in a single SQLite database encrypted with AES-256. This is simpler to manage (one file to back up), but the data isn't in a universally portable format — you'd need Stork (or SQLCipher tools) to access it.

## When to Choose Bichon

- **Pure archival** — if you just need to preserve and search old email without interacting with it, Bichon is purpose-built for this. It's lean and focused.
- **Portable storage format** — EML files are a standard format. Your archive isn't locked into any tool — you can grep, process, or import EML files into any client.
- **Very large mailboxes** — Bichon's Tantivy search engine (Rust-based, Lucene-inspired) is designed for high-volume indexing. If you're archiving decades of email from multiple accounts, Bichon's architecture is tuned for this.
- **No encryption requirement** — if your server's disk is already encrypted (LUKS, ZFS encryption) and you don't need application-level encryption, Bichon's simpler storage model avoids the overhead.

## When to Choose Stork

- **Daily email client** — if you want to read, reply, and send email, Stork is a full client. Bichon is read-only.
- **Encryption at rest** — Stork encrypts your entire mailbox with AES-256. Bichon stores EML files in plain text.
- **Connector mode** — Stork can fetch mail and delete it from the server, making your instance the permanent encrypted home for your email. Bichon ingests but doesn't offer a similar "take ownership" workflow.
- **Label-based organization** — Stork maps IMAP folders to labels and lets you create custom labels. Bichon doesn't have an organizational layer beyond search.
- **Recovery key** — Stork's BIP39 mnemonic ensures you can recover your encrypted mailbox if you forget your password. Bichon doesn't encrypt, so there's nothing to recover.

## Migration Path

### From Bichon to Stork

Bichon stores email as EML files. Stork doesn't currently import EML files directly (mbox/EML import is on the [roadmap](../README.md#planned)). For now, the migration path is:

1. Ensure your mail is still accessible on the IMAP server.
2. Deploy Stork and connect it to the same IMAP server.
3. Stork syncs the mailbox into encrypted local storage.
4. Verify completeness, then decommission Bichon.

If Bichon was your only copy (mail deleted from the IMAP server), you'd need to re-upload the EML files to an IMAP server first using a tool like `imapsync` or a script that appends messages via IMAP APPEND.

### From Stork to Bichon

In mirror mode, mail is still on the IMAP server — point Bichon at it. In connector mode, mail exists only in Stork's encrypted database. There's no direct Stork-to-Bichon export path today.

## Feature Comparison Detail

### Search

Both tools have strong full-text search. Bichon uses Tantivy, a Rust implementation of the Lucene architecture — fast and memory-efficient for large corpora. Stork uses SQLite FTS5, which is tightly integrated with the database and excellent for the scale of a typical personal mailbox. Both handle hundreds of thousands of messages well.

### Use Together?

You can run both. Use Stork as your daily email client (reading, composing, searching current mail) and Bichon as a long-term archive for historical email. They connect to the same IMAP server independently and don't interfere with each other.
