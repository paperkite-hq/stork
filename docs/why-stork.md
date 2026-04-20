# Why Stork?

The case for self-hosting the email client — not the server.

## The problem with every other mail client

Open Thunderbird, Apple Mail, or any webmail UI and ask yourself: **where does my email actually live?**

The answer is always the same: on someone else's server. Your client is a viewer. The provider is the source of truth. When you "delete" a message in Apple Mail, it deletes it from the provider. When you "archive" it, the provider decides what that means. If the provider changes its pricing, its policies, or simply shuts down, your email goes with it.

This is a strange architecture to accept. Your inbox is usually the single largest concentration of private information you have — receipts, contracts, medical records, password resets, decade-old family conversations. And it all sits on a machine you don't own, indexed by people you've never met, subject to terms you skimmed once in 2014.

IMAP was designed in 1986, back when local disk was expensive and intermittent dial-up was the norm. Keeping the canonical copy on the server made sense. It doesn't anymore. A 1 TB SSD is cheap. Bandwidth is abundant. The justification for "cloud as source of truth" evaporated years ago, but mail clients never caught up.

## What self-hosting the client actually means

You'll notice most "self-host your email" projects are about running the **server** — Mailu, Mailcow, Mail-in-a-Box, Postfix + Dovecot by hand. That's a different problem. Running a mail server means fighting spam reputation, getting off blocklists, managing DKIM/SPF/DMARC, and accepting that your outbound mail might just… vanish into Microsoft 365's spam folder with no recourse.

Deliverability is a fight not worth picking. Let the professionals at Fastmail, ProtonMail, or Gmail handle the MX records and the spam wars.

But the **client** — the place where your mail actually lives, gets searched, gets displayed, gets archived — that's a much smaller problem. It's one container. There's no outbound reputation to defend. There are no abuse reports to triage. It's just software that talks IMAP.

Self-hosting the client is the 80/20 of email sovereignty. You delegate delivery (the hard part) and own storage (the valuable part).

## Connector mode: inverting the relationship

Stork has two modes, and the difference matters.

**Mirror mode** is the safe default. Stork syncs a local encrypted copy of your mail while your provider retains the original. This is what most mail clients already do, minus the encryption at rest. It's the training-wheels phase — you can evaluate Stork without burning any bridges, and your provider remains your fallback.

**Connector mode** is the point. Once you're confident, you flip the switch. New messages are fetched from your provider and then deleted from the provider in interleaved batches. Your provider becomes transient — just a delivery pipe, a one-hop connector that feeds mail into Stork. Stork holds the only copy, AES-256 encrypted, on hardware you control.

```
      Mirror mode                     Connector mode
┌──────────────────────┐          ┌──────────────────────┐
│  Mail provider       │          │  Mail provider       │
│  (holds all mail)    │          │  (transient — 1 hop) │
└──────────┬───────────┘          └──────────┬───────────┘
           │ IMAP sync                        │ IMAP sync + delete
           ▼                                  ▼
┌──────────────────────┐          ┌──────────────────────┐
│  Stork               │          │  Stork               │
│  (encrypted copy)    │          │  (only copy, AES-256)│
└──────────────────────┘          └──────────────────────┘
```

The architectural shift is the whole point. In connector mode, the provider is no longer the source of truth for your history — it's just the port the mail comes in on. If your provider nukes your account tomorrow, you lose future delivery; you don't lose your archive.

## What this buys you

- **A subpoena to your provider yields nothing historical.** Provider storage is transient in connector mode. There's nothing to hand over after the message hits your disk and gets deleted from the edge.
- **Provider price hikes stop being existential.** Switching providers becomes a one-evening project: point Stork at the new IMAP endpoint and update your MX. Your mail archive doesn't move — it was never on the provider in the first place.
- **Outages don't lock you out of your own history.** Even if your provider is offline, Stork still opens. You can read, search, and compose drafts locally; new mail queues and delivers when the provider comes back.
- **Your email isn't training data.** Whatever the current or future terms of service are, they don't apply to mail the provider no longer has.
- **Encryption at rest is the default, not an afterthought.** SQLCipher with AES-256. Stork boots locked; your password unlocks it. Filesystem access to the database yields ciphertext.

## What this doesn't buy you

Stork is not a threat model for everything.

- **Your provider still sees the plaintext** during the moments it holds the message. Only end-to-end encryption (PGP, S/MIME, Proton-to-Proton) changes that, and that's a property of the message, not the client.
- **Your mail is still readable in transit** over IMAP if the provider doesn't enforce TLS. Pick a provider that does.
- **Running infrastructure is your responsibility.** Backups are your job. If your disk dies and you didn't back up, your mail is gone — in exactly the way your provider used to prevent. The 24-word BIP39 recovery mnemonic covers forgotten passwords, not lost disks. Set up `restic` or `borg` on day one.

Mirror mode exists specifically so you can evaluate these tradeoffs before committing.

## The pitch in one sentence

**Your provider should be a pipe, not a vault** — and the vault should be encrypted, searchable, and sitting on a machine you can unplug.

If that resonates, [try the demo](https://stork-demo.paperkite.sh) or [run it locally](../README.md#quick-start). If it doesn't, keep using what works for you — this isn't for everyone, and that's fine.

## Further reading

- [Getting Started](getting-started.md) — first launch, encryption setup, connecting your email
- [User Guide](user-guide.md) — mirror vs connector mode in detail
- [Design Decisions](design-decisions.md) — why labels over folders
- [Architecture](architecture.md) — how the pieces fit together
- [FAQ](faq.md) — common questions about sync, search, and data safety
