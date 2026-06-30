# Security

Please do not publish sensitive vulnerabilities in public issues before maintainers have had a
reasonable chance to respond.

Report security issues through the contact channel published by the project maintainers. If no
private channel is available yet, open a public issue with a minimal description that does not
include secrets, exploit details, credentials, or private user data, and ask for a private follow-up
channel.

## Credential Handling

This project is a local-first runtime. Treat configured provider credentials as sensitive local
secrets.

Do not commit credentials, tokens, OAuth client secrets, API keys, or captured provider responses
that contain user data.
