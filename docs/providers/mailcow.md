# Mailcow

Connect Stork to your Mailcow server using IMAP and SMTP.

Mailcow is a popular self-hosted mail server suite. Since you control the server, no App Passwords are needed — use your mailbox credentials directly.

## Step 1: Find your IMAP/SMTP settings

Your Mailcow admin panel (usually `https://mail.yourdomain.com`) shows the connection details. The defaults are:

| Field | Value |
|-------|-------|
| **IMAP Host** | `mail.yourdomain.com` |
| **IMAP Port** | `993` |
| **SMTP Host** | `mail.yourdomain.com` |
| **SMTP Port** | `587` |

Your username and password are your mailbox credentials — the same ones you use to log in to SOGo or the Mailcow webmail.

## Step 2: Connect in Stork

Use these settings when adding a new inbound connector:

| Field | Value |
|-------|-------|
| **IMAP Host** | `mail.yourdomain.com` |
| **IMAP Port** | `993` |
| **Username** | `you@yourdomain.com` |
| **Password** | Your mailbox password |

For sending (outbound connector):

| Field | Value |
|-------|-------|
| **SMTP Host** | `mail.yourdomain.com` |
| **SMTP Port** | `587` |
| **Username** | `you@yourdomain.com` |
| **Password** | Same mailbox password |

## Mailcow + Stork architecture

Running Stork alongside Mailcow is a natural fit: Mailcow handles the MTA (receiving from the internet, SPF/DKIM/DMARC), and Stork provides a modern encrypted client with full-text search.

```
Internet → Mailcow (MTA/MDA) → IMAP → Stork (client + encrypted archive)
```

If both run on the same server, you can use `localhost` or the Docker network name instead of the public hostname for IMAP/SMTP — this avoids TLS certificate issues and reduces latency.

## Docker networking tip

If Stork and Mailcow run on the same Docker host, put them on a shared Docker network so Stork can reach Mailcow's IMAP/SMTP directly:

```yaml
# In your Stork docker-compose.yml, add:
networks:
  default:
    external:
      name: mailcowdockerized_mailcow-network
```

Then use `dovecot` as the IMAP host and `postfix` as the SMTP host (Mailcow's internal service names) with port `143` (unencrypted, since traffic stays within Docker). This is faster and avoids TLS overhead for local connections.

## Connector mode with Mailcow

Connector mode is especially powerful with a self-hosted mail server:

- You maintain full control over both the MTA (Mailcow) and the client (Stork)
- Messages arrive at Mailcow, get fetched by Stork, and are cleaned from Mailcow's storage
- This reduces Mailcow's disk usage over time — useful if your VPS has limited storage
- Mailcow's spam filtering still applies before Stork sees the message

## Multiple domains

If your Mailcow instance handles multiple domains, add each mailbox as a separate inbound connector in Stork. They all sync into the same unified inbox with appropriate labels.

## Troubleshooting

**"Connection refused" on localhost:**
- If using Docker networking, make sure both containers are on the same network
- Use the Mailcow service name (`dovecot`, `postfix`) not `localhost`

**"Certificate error" with self-signed certs:**
- If your Mailcow uses a self-signed certificate, Stork may reject the connection. Use the Docker networking approach above to bypass TLS entirely for local connections.

**Slow sync on large mailboxes:**
- Mailcow stores mail in Dovecot's Maildir format. Large mailboxes (100k+ messages) sync incrementally — initial sync takes time, but subsequent syncs are fast.
