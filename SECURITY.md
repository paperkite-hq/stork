# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Stork, please report it responsibly:

**Email**: [hailey+security@paperkite.sh](mailto:hailey+security@paperkite.sh)

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

I will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

**Please do not open public GitHub issues for security vulnerabilities.**

## Scope

The following are in scope for security reports:

- **Encryption at rest** — weaknesses in the SQLCipher integration, key derivation (Argon2id), vault key wrapping, or recovery key handling
- **Authentication bypass** — ways to access encrypted data without the password or recovery key
- **API vulnerabilities** — injection, authentication bypass, or unauthorized access via the REST API
- **IMAP/SMTP credential handling** — insecure storage or transmission of mail server credentials
- **Container escape** — vulnerabilities that allow breaking out of the Docker container
- **XSS/CSRF** — cross-site scripting or request forgery in the web UI

## Security Design

Stork encrypts all stored email data using AES-256 via SQLCipher. See [docs/encryption-design.md](docs/encryption-design.md) for the full technical design, including:

- Vault key architecture with dual unlock envelopes (password + recovery mnemonic)
- Argon2id key derivation parameters
- Threat model and explicit non-goals

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
