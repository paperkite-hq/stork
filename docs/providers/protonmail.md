# ProtonMail

Connect Stork to your ProtonMail using the ProtonMail Bridge.

ProtonMail encrypts all mail on their servers and doesn't expose standard IMAP/SMTP. To use Stork (or any email client), you need **ProtonMail Bridge** — an application that runs locally and provides IMAP/SMTP access to your encrypted mailbox.

## Prerequisites

- A **ProtonMail paid plan** (Plus, Professional, or Visionary) — Bridge requires a paid subscription
- [ProtonMail Bridge](https://proton.me/mail/bridge) installed and running on the same machine as Stork (or accessible on your network)

## Step 1: Install and configure ProtonMail Bridge

1. Download Bridge from [proton.me/mail/bridge](https://proton.me/mail/bridge)
2. Install and launch it
3. Sign in with your ProtonMail credentials
4. Bridge shows your local IMAP/SMTP settings and a **Bridge Password** — copy it

The default Bridge settings are:

| Field | Value |
|-------|-------|
| **IMAP Host** | `127.0.0.1` |
| **IMAP Port** | `1143` |
| **SMTP Host** | `127.0.0.1` |
| **SMTP Port** | `1025` |

> **Important:** These ports are the defaults. Bridge may use different ports — check the Bridge UI for the exact values.

## Step 2: Connect in Stork

Use these settings when adding a new inbound connector:

| Field | Value |
|-------|-------|
| **IMAP Host** | `127.0.0.1` |
| **IMAP Port** | `1143` |
| **Username** | `you@protonmail.com` |
| **Password** | The Bridge Password (not your ProtonMail login password) |

For sending (outbound connector):

| Field | Value |
|-------|-------|
| **SMTP Host** | `127.0.0.1` |
| **SMTP Port** | `1025` |
| **Username** | `you@protonmail.com` |
| **Password** | Same Bridge Password |

## Docker considerations

Since ProtonMail Bridge runs on the host and Stork runs in Docker, you need to make Bridge accessible to the container. Options:

**Option 1: Host networking**
```yaml
services:
  stork:
    image: ghcr.io/paperkite-hq/stork:latest
    network_mode: host
    # ... rest of config
```
Then use `127.0.0.1` as the host.

**Option 2: Use host.docker.internal** (Docker Desktop on macOS/Windows)
```
IMAP Host: host.docker.internal
SMTP Host: host.docker.internal
```

**Option 3: Bind Bridge to the Docker bridge IP** (Linux)
Configure Bridge to listen on `172.17.0.1` (the Docker bridge gateway) instead of `127.0.0.1`, then use that IP in Stork's settings.

## ProtonMail-specific notes

- **Encryption layers**: ProtonMail encrypts mail on their servers. Bridge decrypts it locally before handing it to Stork over IMAP. Stork then re-encrypts it with AES-256 for local storage. Your mail is encrypted at rest in both places, with different keys.
- **Labels and folders**: ProtonMail uses both labels and folders. Bridge exposes them as IMAP folders, and Stork syncs them as labels.
- **Bridge must be running**: If Bridge stops, Stork can't sync. The sync will resume automatically when Bridge restarts.
- **Custom domains**: If you use a custom domain with ProtonMail, your username in Bridge is still your ProtonMail address.

## Connector mode with ProtonMail

Connector mode works with ProtonMail via Bridge, but consider: ProtonMail already encrypts your mail on their servers. The main benefit of connector mode here is reducing ProtonMail storage usage and having a local backup independent of Proton's infrastructure — useful if you want to stop paying for ProtonMail while keeping your email history.

## Troubleshooting

**"Connection refused" error:**
- Make sure ProtonMail Bridge is running
- Verify the ports match what Bridge shows in its UI
- If using Docker, ensure the container can reach the Bridge (see Docker considerations above)

**"Authentication failed" error:**
- Use the **Bridge Password** shown in the Bridge UI, not your ProtonMail login password
- The Bridge Password changes if you remove and re-add your ProtonMail account in Bridge

**Sync stops intermittently:**
- Bridge may disconnect during ProtonMail server maintenance. Stork will retry automatically.
