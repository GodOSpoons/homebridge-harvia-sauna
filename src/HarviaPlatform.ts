import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformConfig,
  PlatformAccessory,
} from 'homebridge';
import { HarviaAPI } from './api/HarviaAPI';
import { isHeaterStatePayload, normalizeStatePayload, normalizeTelemetryPayload } from './api/normalize';
import { HarviaDevice } from './HarviaDevice';
import { HarviaWebSocket } from './HarviaWebSocket';
import { ThermostatAccessory } from './accessories/ThermostatAccessory';
import { SwitchAccessory, SwitchType } from './accessories/SwitchAccessory';
import { DoorSensorAccessory } from './accessories/DoorSensorAccessory';
import { SensorAccessory } from './accessories/SensorAccessory';

interface HarviaConfig extends PlatformConfig {
  username: string;
  password: string;
  pollingInterval?: number;
  enableThermostat?: boolean;
  enableLight?: boolean;
  enableFan?: boolean;
  enableSteamer?: boolean;
  enableDoorSensor?: boolean;
}

export class HarviaPlatform implements DynamicPlatformPlugin {
  private readonly apiClient = new HarviaAPI();
  private readonly accessories = new Map<string, PlatformAccessory>();
  private devices = new Map<string, HarviaDevice>();
  private harviaConfig: HarviaConfig;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API
  ) {
    this.harviaConfig = config as HarviaConfig;
    this.api.on('didFinishLaunching', () => {
      void this.didFinishLaunching();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  private async didFinishLaunching(): Promise<void> {
    if (!this.config) {
      this.log.error('Platform configuration is missing');
      return;
    }

    const username = String(this.harviaConfig.username || '');
    const password = String(this.harviaConfig.password || '');
    const pollingInterval = Number(this.harviaConfig.pollingInterval ?? 60);

    if (!username || !password) {
      this.log.error('HarviaSauna requires username and password in configuration');
      return;
    }

    try {
      await this.apiClient.authenticate(username, password);
      this.log.info('Harvia: authenticated successfully');
      const deviceList = await this.apiClient.getDevices();
      this.log.info(
        `Harvia: discovered ${deviceList.length} device(s): ${deviceList.map((d) => d.deviceId).join(', ') || 'none'}`
      );

      for (const entry of deviceList) {
        const device = new HarviaDevice(this.apiClient, entry.deviceId, entry.deviceId);

        // /devices/state is cabin-scoped (subId: "C1") and may not apply to
        // a satellite sensor device like the SAM001W, which has no cabin.
        // A failure here shouldn't drop the device — fall back to an empty
        // state, which classifies it as 'sensor' (see isHeaterStatePayload)
        // and let telemetry below carry its actual temperature/humidity.
        let normalizedState: Record<string, unknown> = { deviceId: device.id };
        try {
          const stateRaw = await this.apiClient.getDeviceState(device.id);
          this.log.debug(`Harvia: raw device state for ${device.id}: ${JSON.stringify(stateRaw)}`);
          normalizedState = normalizeStatePayload(device.id, stateRaw);
        } catch (error: any) {
          this.log.debug(
            `Harvia: device state unavailable for ${device.id}, treating as sensor-only: ${error?.message ?? error}`
          );
        }
        device.kind = isHeaterStatePayload(normalizedState) ? 'heater' : 'sensor';
        device.updateData(normalizedState);

        try {
          await this.loadDeviceData(device);
        } catch (error: any) {
          this.log.warn(`Harvia: failed to load telemetry for ${device.id}: ${error?.message ?? error}`);
        }

        this.devices.set(device.id, device);
        // Register AFTER state is loaded so device.name is the
        // displayName from the API, not the raw device ID
        this.registerPlatformAccessories(device);
      }

      this.log.info(`Harvia: registration complete — ${this.devices.size} device(s) active`);
      this.startWebSockets();
      this.startPolling(pollingInterval);
    } catch (error: any) {
      this.log.error(`Failed to initialize Harvia platform: ${error?.message ?? error}`);
    }
  }

  private async loadDeviceState(device: HarviaDevice): Promise<void> {
    // Cabin-scoped state doesn't apply to satellite sensor devices; skip it
    // once classified, to avoid repeated polling failures against an
    // endpoint that already didn't work for this device at startup.
    if (device.kind === 'sensor') return;
    const raw = await this.apiClient.getDeviceState(device.id);
    this.log.debug(`Harvia: raw device state for ${device.id}: ${JSON.stringify(raw)}`);
    device.updateData(normalizeStatePayload(device.id, raw));
  }

  private async loadDeviceData(device: HarviaDevice): Promise<void> {
    const raw = await this.apiClient.getLatestDeviceData(device.id);
    this.log.debug(`Harvia: raw latest data for ${device.id}: ${JSON.stringify(raw)}`);
    device.updateData(normalizeTelemetryPayload(raw));
  }

  private registerPlatformAccessories(device: HarviaDevice): void {
    if (device.kind === 'sensor') {
      this.registerSensorAccessories(device);
      return;
    }

    // Use device.name which is now populated from displayName via updateData
    const displayName = device.name || device.id;
    const cfg = this.harviaConfig;

    // Default all to true if not specified in config
    const enableThermostat = cfg.enableThermostat !== false;
    const enableLight = cfg.enableLight !== false;
    const enableFan = cfg.enableFan !== false;
    const enableSteamer = cfg.enableSteamer !== false;
    const enableDoorSensor = cfg.enableDoorSensor !== false;

    const suffixes: Array<[string, string, boolean, (accessory: PlatformAccessory) => void]> = [
      ['thermostat', 'Thermostat', enableThermostat,
        (accessory) => new ThermostatAccessory(this.log, device, accessory, this.api)],
      ['power', 'Power', true, // Power always enabled — core function
        (accessory) => new SwitchAccessory(this.log, device, accessory, 'power', this.api)],
      ['light', 'Light', enableLight,
        (accessory) => new SwitchAccessory(this.log, device, accessory, 'light', this.api)],
      ['fan', 'Fan', enableFan,
        (accessory) => new SwitchAccessory(this.log, device, accessory, 'fan', this.api)],
      ['steamer', 'Steamer', enableSteamer,
        (accessory) => new SwitchAccessory(this.log, device, accessory, 'steamer', this.api)],
      ['door', 'Door Sensor', enableDoorSensor,
        (accessory) => new DoorSensorAccessory(this.log, device, accessory, this.api)],
    ];

    const active: string[] = [];
    const disabled: string[] = [];

    for (const [suffix, label, enabled, initializer] of suffixes) {
      const uuid = this.api.hap.uuid.generate(`${device.id}-${suffix}`);
      const existing = this.accessories.get(uuid);

      if (!enabled) {
        disabled.push(label);
        // If disabled and previously registered, unregister it
        if (existing) {
          this.api.unregisterPlatformAccessories('homebridge-harvia', 'HarviaSauna', [existing]);
          this.accessories.delete(uuid);
          this.log.info(`Harvia: unregistered disabled accessory "${label}"`);
        }
        continue;
      }

      let accessory = existing;
      if (!accessory) {
        accessory = new this.api.platformAccessory(`${displayName} ${label}`, uuid);
        accessory.context.deviceId = device.id;
        this.api.registerPlatformAccessories('homebridge-harvia', 'HarviaSauna', [accessory]);
        this.accessories.set(uuid, accessory);
        this.log.debug(`Harvia: registered accessory "${displayName} ${label}"`);
      }

      initializer(accessory);
      active.push(label);
    }

    this.log.info(
      `Harvia: "${displayName}" (${device.id}) — heater — accessories: ${active.join(', ') || 'none'}` +
      (disabled.length ? ` (disabled: ${disabled.join(', ')})` : '')
    );
  }

  private registerSensorAccessories(device: HarviaDevice): void {
    const displayName = device.name || device.id;

    const suffixes: Array<[string, string, (accessory: PlatformAccessory) => void]> = [
      ['temp', 'Temperature', (accessory) => new SensorAccessory(this.log, device, accessory, 'temperature', this.api)],
      ['humidity', 'Humidity', (accessory) => new SensorAccessory(this.log, device, accessory, 'humidity', this.api)],
    ];

    const active: string[] = [];

    for (const [suffix, label, initializer] of suffixes) {
      const uuid = this.api.hap.uuid.generate(`${device.id}-${suffix}`);
      let accessory = this.accessories.get(uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(`${displayName} ${label}`, uuid);
        accessory.context.deviceId = device.id;
        this.api.registerPlatformAccessories('homebridge-harvia', 'HarviaSauna', [accessory]);
        this.accessories.set(uuid, accessory);
        this.log.debug(`Harvia: registered accessory "${displayName} ${label}"`);
      }
      initializer(accessory);
      active.push(label);
    }

    this.log.info(`Harvia: "${displayName}" (${device.id}) — sensor — accessories: ${active.join(', ') || 'none'}`);
  }

  private startWebSockets(): void {
    for (const device of this.devices.values()) {
      const stateSocket = new HarviaWebSocket(
        this.apiClient, 'device', device.id, this.log,
        (payload) => this.handleStatePayload(payload));
      const dataSocket = new HarviaWebSocket(
        this.apiClient, 'data', device.id, this.log,
        (payload) => this.handleDataPayload(payload));

      stateSocket.connect();
      dataSocket.connect();
    }
  }

  private handleStatePayload(payload: any): void {
    const item = payload?.devicesStatesUpdateFeed?.item;
    if (!item) return;

    const deviceId = item.deviceId;
    if (!deviceId) return;

    const reported = typeof item.reported === 'string'
      ? JSON.parse(item.reported)
      : item.reported;
    if (!reported) return;

    this.log.debug(`Harvia: raw devicesStatesUpdateFeed for ${deviceId}: ${JSON.stringify(reported)}`);

    const device = this.devices.get(deviceId);
    if (device) {
      device.updateData(normalizeStatePayload(deviceId, reported));
    }
  }

  private handleDataPayload(payload: any): void {
    const item = payload?.devicesMeasurementsUpdateFeed?.item;
    if (!item || !item.deviceId) return;

    const data = typeof item.data === 'string'
      ? JSON.parse(item.data)
      : item.data;
    this.log.debug(`Harvia: raw devicesMeasurementsUpdateFeed for ${item.deviceId}: ${JSON.stringify(data)}`);

    const device = this.devices.get(item.deviceId);
    if (device) {
      device.updateData(normalizeTelemetryPayload({ data, timestamp: item.timestamp, type: item.type }));
    }
  }

  private startPolling(intervalSeconds: number): void {
    setInterval(async () => {
      for (const device of this.devices.values()) {
        try {
          await this.loadDeviceState(device);
          await this.loadDeviceData(device);
        } catch (error: any) {
          this.log.warn(`Polling failed for ${device.id}: ${error?.message ?? error}`);
        }
      }
    }, intervalSeconds * 1000);
  }
}
