# Performance

Stork is designed to search an entire mailbox **instantly** — the claim on the landing page is backed by the measurements below. Numbers are from the reproducible benchmark in [`scripts/benchmark.ts`](../scripts/benchmark.ts); you can re-run it against your own hardware in a couple of minutes.

> **TL;DR** — On a 500k-message vault, a typical full-text search returns in ~200 ms (cold cache) on a single-core container. On a 50k-message vault, the same query is under 20 ms. On-disk size is ~2.8 KB per message with zlib compression and SQLCipher AES-256 encryption both on.

## Test setup

| | |
|---|---|
| **Machine** | AMD Ryzen AI 7 350 (1 vCPU allocated), 24 GiB RAM |
| **Storage** | Ext4 on NVMe-backed block device (KVM guest) |
| **OS / runtime** | Linux 6.19, Node.js 22.22 |
| **Stork build** | Commit HEAD on `main` at time of run |
| **DB encryption** | SQLCipher AES-256 (default 256k KDF iterations) |
| **Corpus** | Synthetic — deterministic PRNG (seed `0xc0ffee`), ~120 words/message from a 100-term zipfian vocabulary, ~4 KB of HTML body per message (compression-exercising), two-year date spread |

The corpus is synthetic but shaped like real business mail: most messages contain common words (`meeting`, `project`, `invoice`, etc.) with a handful of rare per-message tokens. FTS5's index shape on this corpus is comparable to what a real inbox produces.

## Search latency

All queries run with `ORDER BY rank LIMIT 50` — the same clause used by the UI. Cold = first query after a fresh database reopen (clears SQLite's page cache). Warm = p50 / p95 over 10 repeats.

### 50k-message vault (~130 MiB on disk)

| Query shape | Example | Cold | Warm p50 | Warm p95 | Hits |
|---|---|---:|---:|---:|---:|
| Common single term | `meeting` | 19.9 ms | 17.0 ms | 17.6 ms | 50 |
| Two-term AND | `project update` | 16.8 ms | 15.7 ms | 16.8 ms | 50 |
| Rare term (point lookup) | `uniq1a` | 0.2 ms | <0.1 ms | 0.1 ms | 3 |
| Phrase | `"quarterly report"` | 5.3 ms | 4.1 ms | 4.5 ms | 50 |
| Prefix | `confid*` | 20.2 ms | 18.3 ms | 18.4 ms | 50 |

### 500k-message vault (~1.3 GiB on disk)

| Query shape | Example | Cold | Warm p50 | Warm p95 | Hits |
|---|---|---:|---:|---:|---:|
| Common single term | `meeting` | 234.0 ms | 236.4 ms | 276.7 ms | 50 |
| Two-term AND | `project update` | 207.3 ms | 205.4 ms | 240.7 ms | 50 |
| Rare term (point lookup) | `uniq1a` | 13.4 ms | <0.1 ms | 0.1 ms | 9 |
| Phrase | `"quarterly report"` | 53.5 ms | 45.2 ms | 46.2 ms | 50 |
| Prefix | `confid*` | 246.4 ms | 248.4 ms | 262.8 ms | 50 |

**Reading these numbers**

- **Rare-term lookups are effectively instant** at any scale — FTS5's posting lists are ordered, so locating a term with a few hits is O(log n) on the index.
- **Common-term ranked queries** scale roughly linearly with the FTS5 index size for this corpus: ~18 ms at 50k grows to ~230 ms at 500k. That's still under the 300 ms threshold where UI latency starts feeling sluggish.
- **Phrase queries are cheaper than single-term queries** at the 500k scale because the phrase constraint prunes the result set aggressively before ranking.
- **Prefix queries pay a small tax** vs. a single term (they expand in the FTS5 lexicon), but stay in the same order of magnitude.

## Storage efficiency

| Corpus size | On-disk size | Bytes per message |
|---|---:|---:|
| 50,000 | 132.3 MiB | 2,775 B |
| 500,000 | 1,324.6 MiB | 2,778 B |

The per-message footprint is stable — each message carries ~120 words of plaintext body + ~4 KB of HTML body that zlib shrinks down before storage. Real-world mail varies enormously in size (a terse reply might be 500 B; a marketing HTML email with inline images might be 100 KB), so expect your real-world average to land somewhere between half and three times this number.

What's included in the per-message footprint:

- `text_body` (uncompressed — FTS5 reads it directly)
- `html_body` deflated with zlib
- FTS5 index entries (subject + body + addresses)
- Encryption padding (SQLCipher wraps every page with a MAC)

**Attachments are stored separately** in `stork-blobs.db` and deduplicated by SHA-256 content hash. A 5 MB PDF attached to 20 messages takes ~5 MB on disk, not 100 MB. The bench above does not include attachment data, so it reflects the base "headers + bodies" footprint only.

## Ingest throughput

| Corpus size | Total seed time | Insert rate |
|---|---:|---:|
| 50,000 | 6.2 s | 8,118 msgs/sec |
| 500,000 | 69.9 s | 7,150 msgs/sec |

This measures **local storage throughput only** — the database path, FTS5 triggers, compression, and SQLCipher encryption. Real IMAP sync is bottlenecked by the IMAP server and network, not the local database, so these numbers are an upper bound on what Stork can handle. In practice, a full Fastmail or Gmail sync is network-bound; you'll typically see hundreds to low thousands of messages per second depending on mailbox age and server rate limits.

The gentle slope from 8.1k → 7.1k msgs/sec as the corpus grows is FTS5's index getting deeper and zlib compression serving a slightly colder page cache.

## Memory footprint

Resident set size at the end of the run:

| Corpus size | RSS |
|---|---:|
| 50,000 | 202 MiB |
| 500,000 | 228 MiB |

Stork scales mmap and SQLite's page cache based on DB size (see [`src/storage/db.ts`](../src/storage/db.ts)), so RSS rises modestly with the mailbox — not proportionally. The default container has headroom at 256 MiB and comfortable behaviour at 512 MiB for a half-million-message vault.

## Methodology

The benchmark script creates a **fresh encrypted database** (SQLCipher AES-256 with a random 32-byte vault key), seeds N synthetic messages in 5,000-message transactions, flushes the WAL, closes and reopens the database (to drop SQLite's page cache), then runs each query as a cold/warm pair. All timings are `process.hrtime.bigint()` deltas measured in Node.js.

Re-run it on your own hardware:

```bash
npx tsx scripts/benchmark.ts --size=50000
npx tsx scripts/benchmark.ts --size=500000 --out=bench-500k.json
```

The `--out` flag writes full JSON for analysis. Temporary data is created in the system tmpdir and removed at the end (pass `--keep` to retain it for inspection).

## Caveats & honest reading

- **Numbers are from a single run** on one machine. Re-run on your hardware; disk, RAM, and CPU all matter.
- **The corpus is synthetic.** Real mail has larger variance in body size, more multilingual content (which hits FTS5 tokenisation differently), and heavy HTML-to-text extraction for marketing emails. Expect real-world cold searches to be 1.5–2× slower than the numbers above on comparable hardware.
- **No concurrent sync during the bench.** Real sync activity contends for the database; a query issued mid-sync will be slower than a query at idle. WAL mode means it won't block, but write batches compete for the same disk.
- **These measure plaintext FTS5 search.** Search over encrypted fields (attachments, raw headers) is slower because they're decompressed per-row; that path is not yet benchmarked.

If you reproduce different numbers — especially slower ones — we'd like to know: open an issue on GitHub with the full `--out` JSON and your machine spec.
