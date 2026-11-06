# Single household on a trusted LAN

Sofa.OS serves one household and one TV, and nobody else will install it, so we use one Companion password, a single device token from TV Sign-in, and no multi-TV support, multiple administrators or credential revocation flows. Companion is HTTPS through the existing reverse proxy but reachable only from the LAN or VPN, which is why it needs no login rate limiting. If Companion is ever exposed to the internet or distributed to other households, this decision must be revisited.

The TV uses HTTPS if Chromium M56 accepts the certificate. Otherwise it falls back to plain HTTP on the LAN, accepting that anyone on the Wi-Fi could read layouts, photos and calendar items, because credentials stay on the Server.
