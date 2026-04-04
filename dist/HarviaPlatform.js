"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarviaPlatform = void 0;
const HarviaAPI_1 = require("./api/HarviaAPI");
const HarviaDevice_1 = require("./HarviaDevice");
const HarviaWebSocket_1 = require("./HarviaWebSocket");
const ThermostatAccessory_1 = require("./accessories/ThermostatAccessory");
const SwitchAccessory_1 = require("./accessories/SwitchAccessory");
const DoorSensorAccessory_1 = require("./accessories/DoorSensorAccessory");
class HarviaPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.apiClient = new HarviaAPI_1.HarviaAPI();
        this.accessories = new Map();
        this.devices = new Map();
        this.api.on('didFinishLaunching', () => {
            void this.didFinishLaunching();
        });
    }
    configureAccessory(accessory) {
        this.accessories.set(accessory.UUID, accessory);
    }
    async didFinishLaunching() {
        if (!this.config) {
            this.log.error('Platform configuration is missing');
            return;
        }
        const username = String(this.config.username || '');
        const password = String(this.config.password || '');
        const pollingInterval = Number(this.config.pollingInterval ?? 60);
        if (!username || !password) {
            this.log.error('HarviaSauna requires username and password in configuration');
            return;
        }
        try {
            await this.apiClient.authenticate(username, password);
            const devices = await this.loadDeviceTree();
            for (const entry of devices) {
                const device = new HarviaDevice_1.HarviaDevice(this.apiClient, entry.id, entry.name);
                await this.loadDeviceState(device);
                await this.loadDeviceData(device);
                this.devices.set(device.id, device);
                this.registerPlatformAccessories(device);
            }
            this.startWebSockets();
            this.startPolling(pollingInterval);
        }
        catch (error) {
            this.log.error(`Failed to initialize Harvia platform: ${error?.message ?? error}`);
        }
    }
    async loadDeviceTree() {
        const endpointUrl = this.apiClient.getEndpoint('device');
        const resp = await this.apiClient.appsyncRequest(endpointUrl, {
            operationName: 'Query',
            variables: {},
            query: `query Query {\n  getDeviceTree\n}\n`,
        });
        const raw = resp.data?.getDeviceTree;
        if (!raw)
            return [];
        const tree = JSON.parse(raw);
        if (!tree?.[0]?.c)
            return [];
        return tree[0].c.map((node) => ({
            id: node.i.name,
            name: node.i.name,
        }));
    }
    async loadDeviceState(device) {
        const endpointUrl = this.apiClient.getEndpoint('device');
        const resp = await this.apiClient.appsyncRequest(endpointUrl, {
            operationName: 'Query',
            variables: { deviceId: device.id },
            query: `query Query($deviceId: ID!) {\n  getDeviceState(deviceId: $deviceId) {\n    reported\n  }\n}\n`,
        });
        const state = resp.data?.getDeviceState?.reported;
        if (typeof state === 'string') {
            device.updateData(JSON.parse(state));
        }
        else if (typeof state === 'object') {
            device.updateData(state);
        }
    }
    async loadDeviceData(device) {
        const endpointUrl = this.apiClient.getEndpoint('data');
        const resp = await this.apiClient.appsyncRequest(endpointUrl, {
            operationName: 'Query',
            variables: { deviceId: device.id },
            query: `query Query($deviceId: ID!) {\n  getLatestData(deviceId: $deviceId) {\n    data\n  }\n}\n`,
        });
        const payload = resp.data?.getLatestData?.data;
        if (typeof payload === 'string') {
            device.updateData(JSON.parse(payload));
        }
        else if (typeof payload === 'object') {
            device.updateData(payload);
        }
    }
    registerPlatformAccessories(device) {
        const suffixes = [
            ['thermostat', 'Thermostat', (accessory) => new ThermostatAccessory_1.ThermostatAccessory(this.log, device, accessory, this.api)],
            ['power', 'Power', (accessory) => new SwitchAccessory_1.SwitchAccessory(this.log, device, accessory, 'power', this.api)],
            ['light', 'Light', (accessory) => new SwitchAccessory_1.SwitchAccessory(this.log, device, accessory, 'light', this.api)],
            ['fan', 'Fan', (accessory) => new SwitchAccessory_1.SwitchAccessory(this.log, device, accessory, 'fan', this.api)],
            ['steamer', 'Steamer', (accessory) => new SwitchAccessory_1.SwitchAccessory(this.log, device, accessory, 'steamer', this.api)],
            ['door', 'Door', (accessory) => new DoorSensorAccessory_1.DoorSensorAccessory(this.log, device, accessory, this.api)],
        ];
        for (const [suffix, label, initializer] of suffixes) {
            const uuid = this.api.hap.uuid.generate(`${device.id}-${suffix}`);
            let accessory = this.accessories.get(uuid);
            if (!accessory) {
                accessory = new this.api.platformAccessory(`${device.name} ${label}`, uuid);
                accessory.context.deviceId = device.id;
                this.api.registerPlatformAccessories('homebridge-harvia', 'HarviaSauna', [accessory]);
                this.accessories.set(uuid, accessory);
            }
            initializer(accessory);
        }
    }
    startWebSockets() {
        const deviceReceiver = new HarviaWebSocket_1.HarviaWebSocket(this.apiClient, 'device', false, this.log, (payload) => this.handleStatePayload(payload));
        const deviceUserReceiver = new HarviaWebSocket_1.HarviaWebSocket(this.apiClient, 'device', true, this.log, (payload) => this.handleStatePayload(payload));
        const dataReceiver = new HarviaWebSocket_1.HarviaWebSocket(this.apiClient, 'data', false, this.log, (payload) => this.handleDataPayload(payload));
        const dataUserReceiver = new HarviaWebSocket_1.HarviaWebSocket(this.apiClient, 'data', true, this.log, (payload) => this.handleDataPayload(payload));
        deviceReceiver.connect();
        deviceUserReceiver.connect();
        dataReceiver.connect();
        dataUserReceiver.connect();
    }
    handleStatePayload(payload) {
        const event = payload?.onStateUpdated;
        if (!event)
            return;
        const reported = typeof event.reported === 'string' ? JSON.parse(event.reported) : event.reported;
        if (!reported || !reported.deviceId)
            return;
        const device = this.devices.get(reported.deviceId);
        if (device) {
            device.updateData(reported);
        }
    }
    handleDataPayload(payload) {
        const event = payload?.onDataUpdates;
        const item = event?.item;
        if (!item || !item.deviceId)
            return;
        const device = this.devices.get(item.deviceId);
        if (device) {
            const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
            device.updateData(data);
        }
    }
    startPolling(intervalSeconds) {
        setInterval(async () => {
            for (const device of this.devices.values()) {
                try {
                    await this.loadDeviceState(device);
                    await this.loadDeviceData(device);
                }
                catch (error) {
                    this.log.warn(`Polling failed for ${device.id}: ${error?.message ?? error}`);
                }
            }
        }, intervalSeconds * 1000);
    }
}
exports.HarviaPlatform = HarviaPlatform;
