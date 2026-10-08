# Future shared gateway

The self-hosted add-on now implements OAuth for ChatGPT web. Each household can connect directly using its own public HTTPS hostname and connection password; follow the [setup guide](../README.md).

A shared LLabs gateway remains unimplemented. Its goal is to let users install one public plugin, pair a Home Assistant add-on, and connect without configuring an inbound tunnel or hostname per home.

That service requires per-user identity, explicit installation pairing, an authenticated outbound add-on connection, per-household request/token isolation, revocation/disconnection, and a hosted deployment. The current single-owner OAuth server must not be treated as that multi-tenant gateway.

No shared gateway endpoint is deployed or hard-coded in the distribution plugin.
