import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformConfig,
  PlatformAccessory,
} from 'homebridge';
import { HarviaAPI } from './api/HarviaAPI';
import { HarviaDevice } from './HarviaDevice';
import { HarviaWebSocket } from './HarviaWebSocket';
import { ThermostatAccessory } from './accessories/ThermostatAccessory';
import { SwitchAccessory, SwitchType } from './accessories/SwitchAccessory';
import { DoorSensorAccessory } from './accessories/DoorSensorAccessory';

interface DeviceTreeItem {
  id: string;
  name: string;
}

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
      const devices = await this.loadDeviceTree();

      for (const entry of devices) {
        const device = new HarviaDevice(this.apiClient, entry.id, entry.name);
        await this.loadDeviceState(device);
        await this.loadDeviceData(device);
        this.devices.set(device.id, device);
        // Register AFTER state is loaded so device.name is the
        // displayName from the API, not the raw UUID
        this.registerPlatformAccessories(device);
      }

      this.startWebSockets();
      this.startPolling(pollingInterval);
    } catch (error: any) {
      this.log.error(`Failed to initialize Harvia platform: ${error?.message ?? error}`);
    }
  }

  private async loadDeviceTree(): Promise<DeviceTreeItem[]> {
    const endpointUrl = this.apiClient.getEndpoint('device');
    const resp = await this.apiClient.appsyncRequest(endpointUrl, {
      operationName: 'Query',
      variables: {},
      query: `query Query {\n  getDeviceTree\n}\n`,
    });

    const raw = resp.data?.getDeviceTree;
    this.log.debug(`Harvia: raw getDeviceTree: ${raw}`);
    if (!raw) return [];

    const tree = JSON.parse(raw);
    if (!tree?.[0]?.c) return [];

    return tree[0].c.map((node: { i: { name: string } }) => ({
      id: node.i.name,
      name: node.i.name,
    }));
  }

  private async loadDeviceState(device: HarviaDevice): Promise<void> {
    const endpointUrl = this.apiClient.getEndpoint('device');
    const resp = await this.apiClient.appsyncRequest(endpointUrl, {
      operationName: 'Query',
      variables: { deviceId: device.id },
      query: `query Query($deviceId: ID!) {\n  getDeviceState(deviceId: $deviceId) {\n    reported\n  }\n}\n`,
    });

    const state = resp.data?.getDeviceState?.reported;
    this.log.debug(`Harvia: raw getDeviceState for ${device.id}: ${JSON.stringify(state)}`);
    if (typeof state === 'string') {
      device.updateData(JSON.parse(state));
    } else if (typeof state === 'object') {
      device.updateData(state);
    }
  }

  private async loadDeviceData(device: HarviaDevice): Promise<void> {
    const endpointUrl = this.apiClient.getEndpoint('data');
    const resp = await this.apiClient.appsyncRequest(endpointUrl, {
      operationName: 'Query',
      variables: { deviceId: device.id },
      query: `query Query($deviceId: ID!) {\n  getLatestData(deviceId: $deviceId) {\n    data\n  }\n}\n`,
    });

    const payload = resp.data?.getLatestData?.data;
    this.log.debug(`Harvia: raw getLatestData for ${device.id}: ${JSON.stringify(payload)}`);
    if (typeof payload === 'string') {
      device.updateData(JSON.parse(payload));
    } else if (typeof payload === 'object') {
      device.updateData(payload);
    }
  }

  private registerPlatformAccessories(device: HarviaDevice): void {
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

    for (const [suffix, label, enabled, initializer] of suffixes) {
      const uuid = this.api.hap.uuid.generate(`${device.id}-${suffix}`);
      const existing = this.accessories.get(uuid);

      if (!enabled) {
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
        this.log.info(`Harvia: registered accessory "${displayName} ${label}"`);
      }

      initializer(accessory);
    }
  }

  private startWebSockets(): void {
    const deviceReceiver = new HarviaWebSocket(
      this.apiClient, 'device', false, this.log,
      (payload) => this.handleStatePayload(payload));
    const deviceUserReceiver = new HarviaWebSocket(
      this.apiClient, 'device', true, this.log,
      (payload) => this.handleStatePayload(payload));
    const dataReceiver = new HarviaWebSocket(
      this.apiClient, 'data', false, this.log,
      (payload) => this.handleDataPayload(payload));
    const dataUserReceiver = new HarviaWebSocket(
      this.apiClient, 'data', true, this.log,
      (payload) => this.handleDataPayload(payload));

    deviceReceiver.connect();
    deviceUserReceiver.connect();
    dataReceiver.connect();
    dataUserReceiver.connect();
  }

  private handleStatePayload(payload: any): void {
    const event = payload?.onStateUpdated;
    if (!event) return;

    const reported = typeof event.reported === 'string'
      ? JSON.parse(event.reported)
      : event.reported;
    this.log.debug(`Harvia: raw onStateUpdated: ${JSON.stringify(reported)}`);
    if (!reported || !reported.deviceId) return;

    const device = this.devices.get(reported.deviceId);
    if (device) {
      device.updateData(reported);
    }
  }

  private handleDataPayload(payload: any): void {
    const event = payload?.onDataUpdates;
    const item = event?.item;
    if (!item || !item.deviceId) return;

    const data = typeof item.data === 'string'
      ? JSON.parse(item.data)
      : item.data;
    this.log.debug(`Harvia: raw onDataUpdates for ${item.deviceId}: ${JSON.stringify(data)}`);

    const device = this.devices.get(item.deviceId);
    if (device) {
      device.updateData(data);
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