# The widget catalogue lives in Server code

Widget types are defined in Server code, each as one adapter plus a config schema, and Companion builds its widget forms from the Server's list of types. Adults only create widget instances, which are saved in the published layout snapshot. We deliberately omit a plugin system or third-party widgets, because one household on one TV has no one else to serve (see ADR 0002). A generic read-only Home Assistant entity card covers most new widgets without code, and a new data source is a new adapter and a Server redeploy.

Sofa Home knows nothing about widget types. It renders a small fixed set of display templates, and the Server maps each type's display model onto one of them, because changing the TV client means rebuilding and reinstalling a signed package. A new template is therefore the expensive path and needs a Sofa Home update. The first template set and the limits on which entities the generic card can pick are still open.
