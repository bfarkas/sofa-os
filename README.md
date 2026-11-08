# Sofa.OS

A family TV experience for one household: a remote-friendly screen on a Samsung TV, set up from a phone or computer.

![Sofa.OS dashboard over a mountain sunset.](docs/sofa-os-mountain-sunset-dashboard.png)

*Early design mockup. It still shows some features that have since been removed.*

## Status

Phase 1 has started. The Server foundation runs on the home server behind Caddy, with Companion sign-in, and Sofa Home is still the Session 01 key logger. See the [implementation plan](docs/implementation-plan.md).

## Development

Needs Node 26.

```bash
npm install
npm run check   # type-check every workspace
npm test        # Server tests, including the Home Assistant write guard
npm run build   # bundle Companion and Sofa Home
```

`tv/build.sh install` builds, signs and installs Sofa Home on the TV. To deploy the Server on rei3, run `git pull && docker compose -f deploy/compose.yaml up -d --build` in `~/sofa-os`. `deploy/set-password.sh` sets the Companion password.

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
