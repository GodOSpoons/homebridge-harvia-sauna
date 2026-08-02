# homebridge-harvia

Homebridge plugin for Harvia Sauna (Xenio WiFi) via the MyHarvia cloud API.

Ported from the [Home Assistant integration](https://github.com/RubenHarms/ha-harvia-xenio-wifi) by Ruben Harms.

**Tested with:** Harvia Xenio WiFi (CX001WIFI) and Harvia Cilindro PC90XE. Should work with any controller compatible with the MyHarvia app.

---

## Requirements

- Node.js 18.20.4+, 20.18.0+, 22.10.0+, or 24+
- Homebridge 1.8.0+ or 2.0.0+
- Harvia Xenio WiFi module (CX001WIFI)
- MyHarvia app account

---

## Installation

### Via Homebridge UI (recommended)
1. Go to the **Plugins** tab in Homebridge UI
2. Search for `homebridge-harvia`
3. Click **Install**

### Via terminal
```bash
sudo npm install -g homebridge-harvia
```

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
| `username` | ✅ | — | MyHarvia app email address |
| `password` | ✅ | — | MyHarvia app password |
| `pollingInterval` | ❌ | `60` | Seconds between fallback polls (min 30) |
| `enableThermostat` | ❌ | `true` | Expose heater as HomeKit HeaterCooler |
| `enableLight` | ❌ | `true` | Expose light as HomeKit Switch |
| `enableFan` | ❌ | `true` | Expose fan as HomeKit Switch |
| `enableSteamer` | ❌ | `false` | Expose steamer as HomeKit Switch |
| `enableDoorSensor` | ❌ | `false` | Expose door safety circuit as Contact Sensor |

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

---

## How It Works

1. **Endpoint discovery** — fetches AppSync URLs at startup from `prod.myharvia-cloud.net` rather than hardcoding them, so the plugin survives backend changes
2. **Authentication** — Cognito SRP auth using the same user pool as the MyHarvia mobile app
3. **Real-time updates** — 4 AppSync WebSocket subscriptions (device state + sensor data × org receiver + user receiver)
4. **Polling fallback** — HTTP polling every `pollingInterval` seconds if WebSocket drops
5. **Token refresh** — automatic Cognito token renewal before expiry

---

## Known Limitations

- Uses the **unofficial, undocumented** MyHarvia API — may break if Harvia changes their backend
- Steamer control is disabled by default — enable only if your heater supports it
- Temperature is always in °C from the API — HomeKit converts to your region's units automatically

---

## Troubleshooting

**Accessories show "No Response"**
Check Homebridge logs for authentication or WebSocket errors. Restart Homebridge — the plugin reconnects automatically.

**Wrong device names**
The plugin uses the display name from your MyHarvia account. If names are showing as UUIDs, check that your sauna has a name set in the MyHarvia app.

**Authentication failed**
Verify credentials match the MyHarvia app login, not the Harvia website.

---

## Credits

API reverse-engineering by [Ruben Harms](https://github.com/RubenHarms/ha-harvia-xenio-wifi).

This plugin is not affiliated with or endorsed by Harvia.