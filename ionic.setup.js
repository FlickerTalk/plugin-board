// The app lends Ionic to every plugin frame (app 1.6.0, 2026-10-09): `@ionic/core`'s custom
// elements are registered, with the app's mode, direction and colours, before the plugin's module
// runs, and its controllers are handed over as `globalThis.ftIonic`. The tests do the same with the
// real `@ionic/core`, the version the app ships, so what the plugin draws here is what the phone
// draws. None of it goes into `dist/`.
import { alertController, initialize } from "@ionic/core/components";
import { defineCustomElement as alert } from "@ionic/core/components/ion-alert.js";
import { defineCustomElement as button } from "@ionic/core/components/ion-button.js";
import { defineCustomElement as buttons } from "@ionic/core/components/ion-buttons.js";
import { defineCustomElement as content } from "@ionic/core/components/ion-content.js";
import { defineCustomElement as header } from "@ionic/core/components/ion-header.js";
import { defineCustomElement as icon } from "@ionic/core/components/ion-icon.js";
import { defineCustomElement as title } from "@ionic/core/components/ion-title.js";
import { defineCustomElement as toolbar } from "@ionic/core/components/ion-toolbar.js";

initialize();
for (const define of [alert, button, buttons, content, header, icon, title, toolbar]) define();
globalThis.ftIonic = { alertController };
