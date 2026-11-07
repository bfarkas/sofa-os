# Sofa.OS

A family TV experience for one household: a remote-friendly screen on a Samsung TV, set up from a phone or computer.

![Sofa.OS dashboard over a mountain sunset.](docs/sofa-os-mountain-sunset-dashboard.png)

*Early design mockup. It still shows some features that have since been removed.*

## Status

This repository holds the design only, with no application code yet. The spec is at v0.2, and key behavior is being tested on the real TV.

## What it is

- **Sofa Home:** a full-screen app on the TV for apps, household widgets, family photos and Kids Mode. It opens at power-on and sits on top of Samsung Home.
- **Companion:** a web app for setup, layout editing and the Phone Remote.
- **Server:** a self-hosted service that holds configuration, runs integrations and enforces the Watch Allowance.

Sofa.OS is built for one household and one TV, a 2018 Samsung UE55NU8009 on Tizen 4. It relies on Home Assistant for household data and for controlling the TV, and on Immich for family photos.

## Documentation

- [Architecture spec](docs/Sofa.OS%20Architecture%20v0.2.md): the design, device test results and roadmap
- [CONTEXT.md](CONTEXT.md): the project's terms
- [Decision records](docs/adr/):
  - [0001: Kids Mode is curation, not containment](docs/adr/0001-kids-mode-is-curation-not-containment.md)
  - [0002: Single household on a trusted LAN](docs/adr/0002-single-household-on-a-trusted-lan.md)
  - [0003: The widget catalogue lives in Server code](docs/adr/0003-widget-catalogue-lives-in-server-code.md)

## License

[MIT](LICENSE)
