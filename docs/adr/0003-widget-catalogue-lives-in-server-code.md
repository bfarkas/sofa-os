# The widget catalogue lives in Server code

Widget types are defined in Server code, each as one adapter plus a config schema, and Companion builds its widget forms from the Server's list of types. Adults only create widget instances, which are saved in the published layout snapshot. We deliberately omit a plugin system or third-party widgets, because one household on one TV has no one else to serve (see ADR 0002). A generic read-only Home Assistant entity card covers most new widgets without code, and a new data source is a new adapter and a Server redeploy.

Sofa Home knows nothing about widget types. It renders a small fixed set of display templates, and the Server maps each type's display model onto one of them, because changing the TV client means rebuilding and reinstalling a signed package. A new template is therefore the expensive path and needs a Sofa Home update.

## The first template set (Session 11)

Five templates, defined in `shared/src/widgets.ts` (`Display`). Every reading is a string the Server has already formatted, or `null`, which Sofa Home shows as a dash. Sofa Home does no number, date or unit formatting of its own, so wording changes never need a reinstall.

- **value:** one large reading with an optional unit and note (a temperature, today's energy).
- **list:** label and reading rows (house sensors, the status widget).
- **columns:** short columns side by side, each with a label, reading, note and an optional 0 to 1 `level` drawn as a bar (a forecast, hourly energy).
- **agenda:** day titles with timed events (the family calendar).
- **photo:** one image and a caption. The image is a path on the Server that the TV can load without headers; how that path is protected is Session 14's decision.

Each widget sends a `card` for its tile and may send a `detail` for the read-only full-screen view. Sizes cap the rows a template may carry (`ITEM_LIMITS`), and the Server refuses an adapter result over the cap, too long, or of the wrong shape. There are no icons in v1, including weather icons: a glyph set is a template change, and words read fine at sofa distance.

## Limits on the generic entity card

The card may pick at most six entities (`MAX_CARD_ENTITIES`) from the read-only domains in `ENTITY_DOMAINS`: `sensor`, `binary_sensor`, `input_boolean`, `input_number`, `input_select`, `counter`, `light`, `switch`, `cover` and `lock`. It shows only the state, the unit and the friendly name, never other attributes, and it never controls anything. The card's `entities` config field declares these domains and that maximum, and the Server checks every instance's config against its field when it reads it (`readConfig`), so a hand-edited layout cannot widen them. Media players, cameras, `person` and `device_tracker` are left out, because they carry pictures or the household's whereabouts.

## Behaviour all widgets share

- **Failure isolation.** Each instance is read on its own, with a timeout, and a throw, a rejection, a hang or a malformed result affects only that instance. A failing read keeps the last good result marked as failing, which Sofa Home shows as stale. An unknown type or an invalid config shows that one widget as unavailable; it is not refused at publish.
- **Freshness.** The layout's `freshness` picks a policy (`FRESHNESS_POLICY`): live reads every 30 seconds and is stale after 3 minutes, hourly every 10 minutes and after 2 hours, daily every hour and after 30 hours. The Server sends the stale limit with each widget, so the policy can change without a reinstall. Sofa Home measures age against the Server's clock, so a wrong TV clock does not matter.
- **Kids profile.** Kids get a widget only if the layout allows it for kids, and an adapter may strip its result for them with `forKids`. If that step fails, kids see the widget as unavailable, never the household's data.

## Photos (Session 14)

- **The `image` path is a capability URL.** The TV loads pictures with `<img>`, which cannot send headers, so `/api/media/<profile>/<album>/<asset>.jpg` takes no token. Instead the Server checks on every request that the album is used by the layout for that profile and that the asset belongs to that album's listing; anything else is 403 or 404. The asset ids are unguessable Immich UUIDs and the layout is only readable with a Companion session or a TV token, so a path is only known to a signed-in device. This matches ADR 0002 (one trusted LAN, no hostile devices) and is the same measure as the rest of Kids Mode (ADR 0001): curation, not containment. The kids profile is part of the path, so a kids client cannot be talked into a household album by a path it was given, and the Server answers a kids request for an album the layout does not approve with 403.
- **Used albums.** An album can be served for the household only if a photo widget, the background or the Kids Mode list uses it, so an Immich album nobody picked is never reachable. Kids see an album only if it is in `kidsMode.albums` (approved separately from the household's) or a photo widget that allows kids names it.
- **No resizing.** The Server stores Immich's own preview rendition, which is already a bounded JPEG, rather than resizing. That keeps the Server free of an image library; the cost is that it depends on the Immich preview format staying JPEG.
- **`album` config field.** A new `ConfigField` kind `album` holds an Immich album id (validated as a UUID by `readConfig`). The `photo` type has one required `album` field and an optional title. A new template was not needed.
- **Background.** A Layout background of kind `image` names a picture as `<albumId>/<assetId>`, kind `slideshow` names an album. Both are served as household pictures, so a background album counts as used. Kids Mode keeps its own forest background.
- **Kids Mode albums** live in `kidsMode.albums` (at most 100 ids). Sofa Home shows them as tiles in the Kids Mode Dashboard and opens a slideshow of that album only.
