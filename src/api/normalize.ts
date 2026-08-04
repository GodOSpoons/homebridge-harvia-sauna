// Fenix devices report state/telemetry with generation-dependent field
// names. These maps and the door-field fallback chain are ported from a
// community-maintained Home Assistant integration that had to reconcile
// several real Fenix firmware variants; see _map_door_field for why the
// telemetry feed must never be allowed to derive the door state.

const STATE_KEY_MAP: Record<string, string> = {
  displayName: 'displayName',
  active: 'active',
  light: 'light',
  lights: 'light',
  fan: 'fan',
  steamEn: 'steamEn',
  targetTemp: 'targetTemp',
  targetRh: 'targetRh',
  targetHum: 'targetRh',
  onTime: 'onTime',
  tempUnit: 'tempUnit',
  aromaEn: 'aromaEn',
  aromaLevel: 'aromaLevel',
  statusCodes: 'statusCodes',
  fwVersion: 'fwVersion',
  swVersion: 'swVersion',
  activeProfile: 'activeProfile',
  saunaStatus: 'saunaStatus',
  remoteAllowed: 'remoteAllowed',
  demoMode: 'demoMode',
  screenLock: 'screenLock',
  signalStrength: 'wifiRSSI',
};

const TELEMETRY_KEY_MAP: Record<string, string> = {
  temperature: 'temperature',
  temp: 'temperature', // Fenix telemetry uses the shortened key
  humidity: 'humidity',
  hum: 'humidity', // Fenix telemetry uses the shortened key
  heatOn: 'heatOn',
  steamOn: 'steamOn',
  remainingTime: 'remainingTime',
  targetTemp: 'targetTemp',
  wifiRSSI: 'wifiRSSI',
  heaterPower: 'heaterPower',
  mainSensorTemp: 'mainSensorTemp',
  extSensorTemp: 'extSensorTemp',
  panelTemp: 'panelTemp',
  totalSessions: 'totalSessions',
  totalBathingHours: 'totalBathingHours',
  totalHours: 'totalHours',
  afterHeatTime: 'afterHeatTime',
  ontimeLT: 'ontimeLT',
  safetyRelay: 'safetyRelay',
  lightOn: 'lightOn',
  fanOn: 'fanOn',
};

// Direct door fields, checked first.
const DOOR_FIELD_CANDIDATES = ['doorOpen', 'door', 'doorState', 'doorSensor'];
// Inverted safety-circuit fields (true = closed/safe), used only as a proxy.
const DOOR_SAFETY_CANDIDATES = ['doorSafetyState', 'safetyState'];

function mapDoorField(
  data: Record<string, unknown>,
  normalized: Record<string, unknown>,
  allowProxies: boolean
): void {
  for (const candidate of DOOR_FIELD_CANDIDATES) {
    if (candidate in data) {
      let value = data[candidate];
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>).open ?? (value as Record<string, unknown>).on;
      }
      if (value !== undefined && value !== null) {
        normalized.doorOpen = Boolean(value);
        return;
      }
    }
  }

  if (!allowProxies) return;

  for (const candidate of DOOR_SAFETY_CANDIDATES) {
    if (candidate in data) {
      let value = data[candidate];
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>).on ?? (value as Record<string, unknown>).state;
      }
      if (value !== undefined && value !== null) {
        // Safety semantics: true = circuit closed/safe = door closed.
        normalized.doorOpen = !Boolean(value);
        return;
      }
    }
  }

  // Last-resort proxy for panels where no door/safety field tracks the
  // door at all: remoteAllowed drops to 0 while the door is open. This is
  // a remote-gating signal, not a pure door contact, so it's only used
  // when nothing more direct is present, and only from the state feed
  // (allowProxies=false on telemetry) since it can freeze on some units.
  if ('remoteAllowed' in data) {
    const value = data.remoteAllowed;
    if (value !== undefined && value !== null) {
      normalized.doorOpen = !Boolean(value);
    }
  }
}

export function normalizeStatePayload(deviceId: string, raw: Record<string, unknown>): Record<string, unknown> {
  const state =
    raw && typeof raw.state === 'object' && raw.state !== null
      ? (raw.state as Record<string, unknown>)
      : raw ?? {};

  const normalized: Record<string, unknown> = { deviceId };
  for (const [source, target] of Object.entries(STATE_KEY_MAP)) {
    if (source in state) normalized[target] = state[source];
  }

  // heater is a nested object on Fenix state payloads: { on: boolean }.
  const heater = state.heater;
  if (heater && typeof heater === 'object' && (heater as Record<string, unknown>).on !== undefined) {
    normalized.active = (heater as Record<string, unknown>).on;
  }

  mapDoorField(state, normalized, true);
  return normalized;
}

// Distinguishes a heater/cabin device from a satellite sensor-only device
// (e.g. the SAM001W WiFi temperature/humidity sensor, which pairs to a
// harvia.io account as its own device with its own deviceId, but reports
// no heater controls). Harvia doesn't publish a documented device 'type'
// enum, so this infers heater-ness from the presence of any control field
// that only a heater/cabin would ever report.
export function isHeaterStatePayload(normalized: Record<string, unknown>): boolean {
  return (
    'active' in normalized ||
    'saunaStatus' in normalized ||
    'activeProfile' in normalized ||
    'targetTemp' in normalized
  );
}

// Best-effort display name from a /devices list entry, used as the initial
// accessory name before (or in place of) a state fetch. Heater devices get
// their real name from state.displayName once loaded; a cabin-less sensor
// like the SAM001W may never return that field, so this is what stands in
// for it. Guards against candidates that just echo the deviceId back (the
// REST /devices list can use a 'name' field as the identifier itself when
// no separate deviceId is present — see extractDeviceId in HarviaAPI.ts).
export function extractFallbackDeviceName(
  deviceId: string,
  raw: Record<string, unknown> | undefined
): string | null {
  if (!raw) return null;
  for (const key of ['displayName', 'name', 'deviceName', 'friendlyName', 'label']) {
    const value = raw[key];
    if (typeof value === 'string' && value && value !== deviceId) {
      return value;
    }
  }
  return null;
}

export function normalizeTelemetryPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const data =
    payload && typeof payload.data === 'object' && payload.data !== null
      ? (payload.data as Record<string, unknown>)
      : {};

  const normalized: Record<string, unknown> = {};
  for (const [source, target] of Object.entries(TELEMETRY_KEY_MAP)) {
    if (source in data) normalized[target] = data[source];
  }

  // Telemetry-feed safety fields can be frozen on some Fenix units, so
  // proxy-based door derivation is disallowed here — only a direct field.
  mapDoorField(data, normalized, false);

  if (payload.timestamp !== undefined) normalized.timestamp = payload.timestamp;
  if (payload.type !== undefined) normalized.type = payload.type;
  return normalized;
}
