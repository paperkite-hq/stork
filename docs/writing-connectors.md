# Writing Custom Connectors

Stork uses a pluggable connector architecture to separate "how mail arrives and leaves" from "how it's stored and displayed." This guide explains how to implement custom connectors.

## Architecture Overview

There are two connector interfaces:

- **`IngestConnector`** — how mail enters the system (pull or push)
- **`SendConnector`** — how mail leaves the system

Each connector is a TypeScript class that implements one of these interfaces. The registry (`src/connectors/registry.ts`) maps configuration objects to connector instances via factory functions.

```
Identity Settings
       │
       ▼
  Registry (factory)
       │
       ├── IngestConnector (imap, cloudflare-email, ...)
       │        │
       │        ▼
       │   Sync Engine → SQLite Storage
       │
       └── SendConnector (smtp, ses, ...)
                │
                ▼
          Outbound Mail
```

## IngestConnector Interface

```typescript
interface IngestConnector {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listFolders(): Promise<FolderInfo[]>;
  fetchMessages(folder: string, sinceUid: number): AsyncIterable<RawMessage>;
  deleteMessages?(folder: string, uids: number[]): Promise<void>;
}
```

### Methods

| Method | Purpose |
|--------|---------|
| `connect()` | Establish connection to the mail source. Called before any data operations. |
| `disconnect()` | Clean up resources and close connections. |
| `listFolders()` | Return available mailbox folders. At minimum, return an INBOX. |
| `fetchMessages(folder, sinceUid)` | Yield messages from `folder` with UIDs greater than `sinceUid`. Must be an async generator/iterable. |
| `deleteMessages?(folder, uids)` | Optional. Delete messages by UID from the source after local storage. |

### Supporting Types

```typescript
interface FolderInfo {
  path: string;       // Full folder path (e.g., "INBOX", "INBOX/Receipts")
  name: string;       // Display name (e.g., "Receipts")
  delimiter: string;  // Hierarchy delimiter (e.g., "/", ".")
  flags: string[];    // Folder flags (e.g., ["\\HasNoChildren"])
}

interface RawMessage {
  uid: number;                                      // Unique ID within the folder
  messageId?: string;                               // RFC 2822 Message-ID
  inReplyTo?: string;                               // For threading
  subject?: string;
  from?: { address: string; name?: string };
  to?: { address: string; name?: string }[];
  cc?: { address: string; name?: string }[];
  date?: Date;
  textBody?: string;
  htmlBody?: string;
  flags?: string[];                                 // e.g., ["\\Seen", "\\Flagged"]
  size?: number;                                    // Message size in bytes
  hasAttachments?: boolean;
}
```

### Pull vs Push Connectors

Connectors can be **pull-based** (like IMAP — the sync scheduler polls periodically) or **push-based** (like Cloudflare Email Workers — messages arrive via webhook).

For push-based connectors:
- Buffer incoming messages in memory with auto-incrementing UIDs
- `connect()` / `disconnect()` manage the ready state (no network connection needed)
- `fetchMessages()` yields buffered messages
- Provide an `acknowledge()` method to clear processed messages
- The identity's `ingest_connector_type` must be set so the sync scheduler skips it (only IMAP identities are polled)

See `CloudflareEmailIngestConnector` for a complete push-based example.

## SendConnector Interface

```typescript
interface SendConnector {
  readonly name: string;
  send(message: OutgoingMessage): Promise<SendResult>;
  verify(): Promise<boolean>;
}
```

### Methods

| Method | Purpose |
|--------|---------|
| `send(message)` | Send an email. Returns message ID and accepted/rejected recipients. |
| `verify()` | Test that credentials and configuration are valid. Returns `true` on success. |

### Supporting Types

```typescript
interface OutgoingMessage {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  inReplyTo?: string;          // For threading
  references?: string[];       // For threading
  attachments?: OutgoingAttachment[];
}

interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

interface SendResult {
  messageId: string;           // RFC 2822 Message-ID assigned to the sent message
  accepted: string[];          // Recipients that accepted the message
  rejected: string[];          // Recipients that rejected the message
}
```

## Step-by-Step: Adding a New Connector

### 1. Create the Implementation

Create a new file in `src/connectors/`:

```typescript
// src/connectors/my-connector.ts
import type { IngestConnector, FolderInfo, RawMessage } from "./types.js";

export interface MyConnectorConfig {
  apiKey: string;
  endpoint: string;
}

export class MyIngestConnector implements IngestConnector {
  readonly name = "my-connector";
  private config: MyConnectorConfig;

  constructor(config: MyConnectorConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // Initialize connection
  }

  async disconnect(): Promise<void> {
    // Clean up
  }

  async listFolders(): Promise<FolderInfo[]> {
    return [{ path: "INBOX", name: "Inbox", delimiter: "/", flags: [] }];
  }

  async *fetchMessages(folder: string, sinceUid: number): AsyncIterable<RawMessage> {
    // Fetch and yield messages with uid > sinceUid
  }
}
```

### 2. Register in the Registry

Add your connector type and factory case to `src/connectors/registry.ts`:

```typescript
// Add to the type union
export type IngestConnectorType = "imap" | "cloudflare-email" | "my-connector";

// Add config field to the config interface
export interface IngestConnectorConfig {
  type: IngestConnectorType;
  imap?: ImapConnectorConfig;
  cloudflareEmail?: CloudflareEmailConfig;
  myConnector?: MyConnectorConfig;
}

// Add factory case
export function createIngestConnector(config: IngestConnectorConfig): IngestConnector {
  switch (config.type) {
    // ... existing cases ...
    case "my-connector": {
      if (!config.myConnector) {
        throw new Error("MyConnector configuration required");
      }
      return new MyIngestConnector(config.myConnector);
    }
  }
}
```

### 3. Add Database Columns

Add a schema migration in `src/storage/schema.ts` for any connector-specific configuration columns:

```sql
ALTER TABLE identities ADD COLUMN my_connector_api_key TEXT;
ALTER TABLE identities ADD COLUMN my_connector_endpoint TEXT;
```

### 4. Update the Identity API

In `src/api/routes/identities.ts`:
- Add new columns to the `allowedFields` array in the PUT handler
- Add validation for required fields in the POST handler
- Include new columns in SELECT queries

### 5. Export from the Barrel

Add exports to `src/connectors/index.ts`:

```typescript
export { MyIngestConnector, type MyConnectorConfig } from "./my-connector.js";
```

### 6. Write Tests

Create `src/connectors/my-connector.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { MyIngestConnector } from "./my-connector.js";

describe("MyIngestConnector", () => {
  test("implements IngestConnector interface", () => {
    const connector = new MyIngestConnector({ apiKey: "test", endpoint: "http://localhost" });
    expect(connector.name).toBe("my-connector");
    expect(typeof connector.connect).toBe("function");
    expect(typeof connector.disconnect).toBe("function");
    expect(typeof connector.listFolders).toBe("function");
    expect(typeof connector.fetchMessages).toBe("function");
  });

  // ... more tests
});
```

### 7. Update the Registry Test

Add cases for your connector in `src/connectors/registry.test.ts`.

## Health Checks

The `GET /api/identities/:identityId/connector-health` endpoint tests both connectors for an identity:

- **IMAP**: Connects, lists folders, disconnects
- **Cloudflare Email**: Verifies webhook secret is configured
- **SMTP**: Calls `verify()` to test credentials
- **SES**: Calls `verify()` to test AWS credentials via `GetAccount`

The response includes sync scheduler status for IMAP identities:

```json
{
  "ingest": { "type": "imap", "ok": true, "details": { "folders": 12 } },
  "send": { "type": "smtp", "ok": true },
  "sync": {
    "running": false,
    "lastSync": 1711123456789,
    "lastError": null,
    "consecutiveErrors": 0
  }
}
```

## Built-in Connectors

| Connector | Type | Transport | Notes |
|-----------|------|-----------|-------|
| `ImapIngestConnector` | Ingest | Pull (IMAP) | Default. Polls server periodically via sync scheduler. |
| `CloudflareEmailIngestConnector` | Ingest | Push (webhook) | Receives mail from Cloudflare Email Workers. No polling needed. |
| `SmtpSendConnector` | Send | SMTP | Default. Uses Nodemailer. |
| `SesSendConnector` | Send | AWS SES v2 | Optional `@aws-sdk/client-sesv2` peer dependency. |

## Design Guidelines

1. **Keep connectors stateless where possible.** Connection state should be managed within the connector, not leaked to callers.
2. **Use optional peer dependencies** for heavy SDKs (like the AWS SDK). Dynamically import them at runtime.
3. **UIDs must be monotonically increasing** within a folder for incremental sync to work.
4. **Return meaningful errors** from `verify()` and `connect()` — they surface in the health check API.
5. **Support graceful shutdown** — `disconnect()` should clean up all resources even if a sync is in progress.
