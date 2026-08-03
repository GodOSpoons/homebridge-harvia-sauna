# Homebridge-Harvia-Sauna

Homebridge plugin for Harvia **Fenix** sauna control panels via the `harvia.io` (MyHarvia 2) cloud API.

Originally forked from a Homebridge plugin built for the older Xenio WiFi controller, then rewritten from the ground up by [GodOSpoons](https://github.com/GodOSpoons) to target Fenix panels on the harvia.io/MyHarvia 2 backend — a different API entirely (REST bearer-token auth and REST reads/writes, vs. the original's Cognito SRP auth and AppSync GraphQL mutations) — plus Homebridge 2.0 compatibility and auto-detected SAM001W sensor support, validated against real hardware.

Field mapping and the door-sensor fallback logic are ported from the [ha-harvia-sauna](https://github.com/WiesiDeluxe/ha-harvia-sauna) Home Assistant integration, which reconciled several real-world Fenix firmware quirks.

**Tested with:** Harvia Fenix WiFi control panel. Should work with any Fenix panel (FX001XW / FX002XW) managed through the MyHarvia 2 app, and auto-detects an optional paired SAM001W WiFi sensor.

> This plugin targets the **Fenix / harvia.io** backend only. It does not support the older Xenio WiFi controller, which uses a separate MyHarvia (Cognito + AWS AppSync) backend.

---

## Requirements

- Node.js 18.20.4+, 20.18.0+, 22.10.0+, or 24+
- Homebridge 1.8.0+ or 2.0.0+
- Harvia Fenix WiFi control panel
- MyHarvia 2 app account
- **MyHarvia Control license** for remote control from HomeKit (see below) — monitoring-only works on the free tier

---

## MyHarvia Core vs. Control licensing

Harvia gates the MyHarvia 2 ecosystem behind two tiers, and this plugin is subject to the same restriction as the app itself since it authenticates as your regular MyHarvia 2 account:

| | **Core** (free) | **Control** (paid upgrade) |
|---|---|---|
| Remote monitoring (status, temperature, notifications, usage history) | ✅ | ✅ |
| Remote control (power, light, fan, steamer, target temperature) | ❌ | ✅ |
| Price | Free | $99 / €99 (one-time, lifetime — not a subscription) |
| Trial | — | 3 months free on new products |
| Sharing | — | Unlimited invited users share one household's license |

New Harvia products ship with a 3-month free trial of Control; after it expires (or if it was never activated), the account drops back to Core, where only monitoring works. The upgrade is purchased directly in the MyHarvia 2 app, not through this plugin.

**What this means for the plugin:** on a Core-tier account, the Thermostat/Power/Light/Fan/Steamer accessories will correctly *display* current state (this plugin's read path works regardless of tier), but any attempt to *change* state from HomeKit will fail — harvia.io returns `HTTP 402 Payment Required`, which the plugin surfaces as a HomeKit "not authorized" response and a single clean log line rather than a raw error dump (see Troubleshooting below). This isn't a bug — Home app control simply isn't possible until the account has a Control license, the same as in the MyHarvia 2 app itself.

---

## Installation

### Via Homebridge UI (recommended)
1. Go to the **Plugins** tab in Homebridge UI
2. Search for `homebridge-harvia-sauna`
3. Click **Install**

### Via terminal
```bash
sudo npm install -g homebridge-harvia-sauna
```

### Upgrading from `homebridge-harvia`

This package was renamed from `homebridge-harvia`. The rename isn't a drop-in upgrade — Homebridge tracks each accessory's ownership by the installing package's name, so accessories created under the old package will show up as orphaned once the new one takes over. To migrate cleanly:

1. Uninstall the old `homebridge-harvia` package
2. Install `homebridge-harvia-sauna`
3. Restart Homebridge — it will register fresh accessories under the new package name
4. Remove the now-orphaned old accessories from the Home app (and, if listed, from Homebridge UI's Accessories tab / cached-accessories cleanup)

Your `config.json` platform block doesn't need to change — the `"platform": "HarviaSauna"` value is unaffected by this rename.

---

## Configuration

Add to your `config.json` under `platforms`, or configure via the Homebridge UI settings form:
```json
{
  "platform": "HarviaSauna",
  "name": "Harvia Sauna",
  "username": "your@myharvia.email",
  "password": "yourpassword",
  "pollingInterval": 60,
  "enableThermostat": true,
  "enableLight": true,
  "enableFan": true,
  "enableSteamer": false,
  "enableDoorSensor": true
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `username` | ✅ | — | MyHarvia 2 app email address |
| `password` | ✅ | — | MyHarvia 2 app password |
| `pollingInterval` | ❌ | `60` | Seconds between fallback polls (min 30) |
| `enableThermostat` | ❌ | `true` | Expose heater as HomeKit HeaterCooler |
| `enableLight` | ❌ | `true` | Expose light as HomeKit Switch |
| `enableFan` | ❌ | `true` | Expose fan as HomeKit Switch |
| `enableSteamer` | ❌ | `false` | Expose steamer as HomeKit Switch |
| `enableDoorSensor` | ❌ | `true` | Expose door state as Contact Sensor |

---

## Exposed Accessories

| Accessory | HomeKit Type | Enabled by default |
|---|---|---|
| Thermostat | HeaterCooler | ✅ |
| Power | Switch | ✅ Always on |
| Light | Switch | ✅ |
| Fan | Switch | ✅ |
| Steamer | Switch | ❌ |
| Door Sensor | Contact Sensor | ✅ |

The **Power** switch is always enabled as it is the core function of the plugin.
All others can be toggled via the Homebridge UI settings or `config.json`.

The Thermostat's `CurrentHeaterCoolerState` distinguishes IDLE (powered on, holding temperature) from HEATING (actively heating) using the panel's real-time `heatOn` telemetry.

### Optional SAM001W sensor

If a Harvia SAM001W WiFi sensor is paired to your MyHarvia 2 account, it's auto-detected as a separate device and exposed as its own pair of accessories — no config needed:

| Accessory | HomeKit Type |
|---|---|
| Temperature | Temperature Sensor |
| Humidity | Humidity Sensor |

The SAM001W pairs to harvia.io as its own device (separate `deviceId` from the sauna's heater), so the plugin classifies each discovered device at startup: one reporting heater-control fields (`active`, `targetTemp`, etc.) becomes the full sauna accessory set above; one reporting only temperature/humidity telemetry becomes a sensor-only device. There's no documented `type` field to key off of, so this is inferred from what each device actually reports — see `src/api/normalize.ts` (`isHeaterStatePayload`) if a device is ever misclassified.

---

## How It Works

1. **Endpoint discovery** — fetches REST/GraphQL service URLs from `https://api.harvia.io/endpoints` at startup rather than hardcoding them
2. **Authentication** — REST bearer-token auth (`/auth/token`, `/auth/refresh`) against the harvia.io API — no Cognito user pool involved
3. **Reads** — REST (`/devices`, `/devices/state`, `/data/latest-data`)
4. **Writes** — REST (`/devices/command` for power/light/fan/steamer, `/devices/target` for temperature/humidity)
5. **Real-time updates** — one GraphQL/WebSocket subscription pair (state + telemetry) per device, keyed by that device's own ID as the subscription receiver
6. **Polling fallback** — HTTP polling every `pollingInterval` seconds, independent of WebSocket state
7. **Token refresh** — automatic bearer-token renewal before expiry, with full re-login as a fallback

---

## Known Limitations

- Uses the **unofficial, undocumented** parts of the harvia.io API (device list shape, command payloads) — may break if Harvia changes their backend
- The Fenix door-sensor field name isn't consistently documented across firmware/hardware generations. The plugin tries several known field names, then a safety-circuit fallback, in that order — see `src/api/normalize.ts` if your door sensor doesn't report correctly and you want to check debug logs for the raw field your unit sends
- SAM001W detection is heuristic (no documented device-type field exists) — see the Optional SAM001W sensor section above and the Troubleshooting entry below if it's misclassified
- Steamer control is disabled by default — enable only if your heater supports it (combi models)
- Remote control requires a MyHarvia **Control** license — see "MyHarvia Core vs. Control licensing" above
- Temperature is always in °C from the API — HomeKit converts to your region's units automatically

---

## Troubleshooting

**Accessories show "No Response"**
Check Homebridge logs for authentication or WebSocket errors. Restart Homebridge — the plugin reconnects automatically.

**Wrong device names**
The plugin uses the `displayName` field from your device's state. If names are showing as raw device IDs, check that your sauna has a name set in the MyHarvia 2 app.

**Door sensor never changes / always shows one state**
Run Homebridge with `-D` (debug mode) and look for `Harvia: raw device state` / `Harvia: raw latest data` log lines — they show the exact field names your panel reports, which can be pasted into an issue if none of the known door-field candidates match.

**SAM001W sensor doesn't appear, or appears as a full sauna accessory set**
Run Homebridge with `-D` and check the `Harvia: discovered devices` and `Harvia: raw device state` log lines for the sensor's `deviceId`. If it's missing entirely, its state/telemetry calls may be failing outright (look for `Harvia: failed to load telemetry` / `device state unavailable` warnings for that ID). If it appears but registers as a Thermostat/switches instead of Temperature/Humidity sensors, its state payload contains a field `isHeaterStatePayload` treats as a heater-control field — share the raw state log line so the classification can be corrected.

**Toggling a switch or the thermostat does nothing / shows "Not Authorized" in the Home app**
Your MyHarvia 2 account is on the free Core tier, which only allows monitoring. Check the log for a line like:
```
Harvia: <accessory> set — Remote control requires the MyHarvia Control license — this account is on the free Core tier, which only allows monitoring. Upgrade in the MyHarvia 2 app.
```
This confirms the plugin and your credentials are working correctly — it's an account entitlement, not a bug. Upgrade to Control in the MyHarvia 2 app (or confirm your free trial hasn't expired) to enable remote control. See "MyHarvia Core vs. Control licensing" above.

**Authentication failed**
Verify credentials match the MyHarvia 2 app login, not the Harvia website.

---

## Credits

- Fenix/harvia.io rewrite, Homebridge 2.0 compatibility, and SAM001W support by [GodOSpoons](https://github.com/GodOSpoons)
- Fenix/harvia.io field mapping and door-sensor handling ported from [ha-harvia-sauna](https://github.com/WiesiDeluxe/ha-harvia-sauna)
- Originally forked from a Xenio WiFi-based Homebridge plugin, itself ported from Ruben Harms' [Home Assistant integration](https://github.com/RubenHarms/ha-harvia-xenio-wifi)

This plugin is not affiliated with or endorsed by Harvia.
