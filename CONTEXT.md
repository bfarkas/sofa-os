# Sofa.OS

A family TV experience for one household: a remote-friendly screen on a Samsung TV, set up from a phone or computer.

## Language

### Surfaces

**Sofa Home**:
The full-screen Sofa.OS app on the TV, which opens at power-on. It sits on top of Samsung Home and does not replace it.
_Avoid_: Home, launcher, Sofa.OS Home

**Samsung Home**:
The TV's built-in firmware interface, including Smart Hub.
_Avoid_: Home, launcher, Tizen home

**Dashboard**:
The main tab of Sofa Home, showing apps, widgets and the Kids Mode entry.
_Avoid_: Home tab, home screen

**Home key**:
The physical button on the remote that goes to Samsung Home.
_Avoid_: Home button, Home

**Companion**:
The web app used on a phone, tablet or computer to set up and maintain Sofa.OS.
_Avoid_: Admin panel, settings app

**Phone Remote**:
A Companion page that controls the whole TV, including inside provider apps.
_Avoid_: Virtual remote, app remote

**Server**:
The household's self-hosted Sofa.OS service, which Sofa Home and Companion both require.
_Avoid_: Backend, optional server

**TV Sign-in**:
Connecting the TV to the Server by scanning a QR code shown on the TV and authenticating on a phone.
_Avoid_: Pairing, enrollment

### Providers

**Title handoff**:
Asking a provider app to open one specific title, rather than just the app.
_Avoid_: Deep link, title routing, title control, content link

**Launch recipe**:
The stored way to perform a Title handoff for one favorite. It is kept apart from the provider's own identifier for the title, so it can break without losing the favorite.
_Avoid_: Deep link, launch URL

### Household

**Household**:
The one family Sofa.OS is built for. It is the only intended deployment.
_Avoid_: Tenant, customer, user base

**Kids Mode**:
A curated, time-limited profile that gives a child a calm, approved front door to watch from. It is curation rather than containment: provider-side controls do the actual restricting.
_Avoid_: Parental lock, sandbox, restricted session

**Watch Allowance**:
The daily minutes Kids Mode permits, shared by all children. When it runs out, the TV switches off.
_Avoid_: Screen time, timer, parental limit

**Top-up**:
Extra minutes an adult adds to today's Watch Allowance.
_Avoid_: Extension, bonus time

**Done Screen**:
What Sofa Home shows when the TV comes back on after a Watch Allowance has run out. An adult leaves it with the PIN.
_Avoid_: Lock screen, lockout
