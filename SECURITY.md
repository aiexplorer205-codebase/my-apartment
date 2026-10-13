# Security policy

Nivasa is under active development. The current foundation is not production
ready; integrations and controls may be incomplete.

## Reporting a vulnerability

Do not report suspected vulnerabilities in a public issue or pull request.
Use GitHub's private vulnerability reporting feature if it is enabled for this
repository. Otherwise, contact the repository owner through a private,
approved channel and include enough detail to reproduce the issue without
exposing real resident data, credentials, or production systems.

Do not test against systems, accounts, or data you do not own or have explicit
authorization to assess.

## Supported versions

There are no production-supported releases yet. Security fixes should target
the current default development branch.

## Sensitive data

Never commit secrets, database locators, tokens, real resident information, or
production configuration. See the
[security and production deployment architecture](docs/architecture/security-and-production-deployment.md)
for the project's security constraints.
