# Homebridge-harvia

Homebridge plugin for Harvia Sauna (Xenio WiFi) via the MyHarvia cloud API.

## Install

1. Clone or download this repository into your Homebridge plugins folder.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the plugin:

   ```bash
   npm run build
   ```

4. Restart Homebridge and add the platform using the Homebridge UI.

## Configuration

Example `config.json` entry for Homebridge UI:

```json
{
  "platform": "HarviaSauna",
  "name": "Harvia Sauna",
  "username": "user@example.com",
  "password": "your-password",
  "pollingInterval": 60
}
```

## Exposed Accessories

| Accessory | HomeKit Type |
| --- | --- |
| Thermostat | HeaterCooler |
| Power | Switch |
| Light | Switch |
| Fan | Switch |
| Steamer | Switch |
| Door Sensor | Contact Sensor |

## How it works

- Authenticates with MyHarvia using AWS Cognito.
- Discovers MyHarvia API endpoints at startup rather than hardcoding AppSync URLs.
- Uses AppSync HTTP requests for queries and mutations.
- Builds signed AppSync WebSocket URLs for realtime subscriptions.
- Maintains 4 AppSync websocket subscriptions for device and data events, with polling fallback.

## Known limitations

- This is an unofficial integration and relies on reverse-engineered MyHarvia APIs.
- API behavior can change and may break the plugin.
- Real-time updates depend on AppSync websocket connectivity.

## Credits

Reverse-engineering and API insights by Ruben Harms: https://github.com/RubenHarms/ha-harvia-xenio-wifi
