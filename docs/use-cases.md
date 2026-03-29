# Use Cases

Real-world scenarios where Stork fits.

## 1. Encrypted backup of your Gmail

You want a local, searchable copy of your Gmail that's encrypted at rest — so if your laptop is stolen or your VPS is compromised, your email is unreadable without your password.

**Setup:**

1. Generate a [Gmail App Password](https://support.google.com/accounts/answer/185833) (requires 2FA enabled).
2. Run Stork:
   ```bash
   docker compose up -d
   ```
3. Open `http://localhost:3100`, set your encryption password, and save your recovery mnemonic.
4. Add your Gmail identity:
   - IMAP host: `imap.gmail.com`, port `993`
   - SMTP host: `smtp.gmail.com`, port `587`
   - Username: your email address
   - Password: your App Password

Stork syncs all your mail locally. The SQLite database is AES-256 encrypted — even `SELECT * FROM messages` returns ciphertext without the password. You can search your entire mailbox with FTS5, and the data never leaves your machine.

**Why not just use Gmail's web UI?** Because your email lives on Google's servers, indexed and accessible to Google. With Stork, you keep a private, encrypted copy on hardware you control.

## 2. Self-hosted webmail for your Mailcow server

You run [Mailcow](https://mailcow.email/) for your family or small team and want a modern web client that stores mail with encryption at rest, replacing the built-in SOGo or Roundcube.

**Setup:**

1. Deploy Stork on the same server (or any server that can reach Mailcow's IMAP/SMTP ports):
   ```yaml
   # docker-compose.yml
   services:
     stork:
       image: ghcr.io/paperkite-hq/stork:latest
       init: true
       ports:
         - "127.0.0.1:3100:3100"
       volumes:
         - stork-data:/app/data
       restart: unless-stopped
       mem_swappiness: 0
       ulimits:
         core: 0
       security_opt:
         - no-new-privileges:true

   volumes:
     stork-data:
   ```
2. Add your Mailcow email in Stork:
   - IMAP host: `mail.yourdomain.com`, port `993`
   - SMTP host: `mail.yourdomain.com`, port `587`
3. Put Stork behind your existing reverse proxy (Nginx, Caddy, Traefik) with TLS.

Stork syncs from Mailcow's Dovecot and sends via Mailcow's Postfix. Your mail is encrypted on disk, searchable, and accessible from any browser. Mailcow continues handling delivery, spam filtering, and DNS — Stork just replaces the client layer.

**Why not just use SOGo?** SOGo doesn't encrypt mail at rest. If someone gains access to your server's filesystem, they can read every email. With Stork, the database is opaque bytes without the password.

## 3. Privacy-focused email access behind a VPN

You travel frequently and want to read your email from hotel Wi-Fi, coffee shops, or airport lounges without trusting the network or exposing your mail credentials to a cloud provider.

**Setup:**

1. Run Stork on a VPS or home server:
   ```bash
   docker compose up -d
   ```
2. Set up WireGuard or Tailscale to create a private tunnel to your server.
3. Access Stork at `http://your-server-ip:3100` through the VPN.
4. Optionally, add Caddy for TLS:
   ```
   mail.yourdomain.com {
       reverse_proxy localhost:3100
   }
   ```

Because Stork stores everything locally and encrypted, your email isn't sitting in a cloud inbox that could be subpoenaed, hacked, or data-mined. The connection between your browser and Stork goes through your VPN tunnel, so the hotel's network never sees your mail traffic.

**Why not just use a regular webmail?** Regular webmail (Gmail, Outlook) sends your email over the open internet to their servers. With Stork + VPN, your email stays on your infrastructure and the connection is encrypted end-to-end through the tunnel.
