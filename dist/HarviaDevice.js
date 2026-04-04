"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarviaDevice = void 0;
class HarviaDevice {
    get isDoorOpen() {
        return String(this.statusCodes).length > 1
            && String(this.statusCodes)[1] === '9';
    }
    constructor(api, id, name) {
        this.api = api;
        this.id = id;
        this.name = name;
        this.active = false;
        this.lightsOn = false;
        this.fanOn = false;
        this.steamOn = false;
        this.targetTemp = 40;
        this.targetRh = 0;
        this.currentTemp = 0;
        this.humidity = 0;
        this.heatUpTime = 0;
        this.remainingTime = 0;
        this.statusCodes = '';
        this.lastUpdate = null;
        this.subscribers = new Set();
    }
    subscribe(subscriber) {
        this.subscribers.add(subscriber);
        subscriber.onDeviceUpdate(this);
    }
    notifySubscribers() {
        for (const subscriber of this.subscribers) {
            subscriber.onDeviceUpdate(this);
        }
    }
    updateData(data) {
        if (!data || typeof data !== 'object')
            return;
        if ('active' in data)
            this.active = Boolean(data.active);
        if ('heatOn' in data)
            this.active = Boolean(data.heatOn);
        if ('light' in data)
            this.lightsOn = Boolean(data.light);
        if ('fan' in data)
            this.fanOn = Boolean(data.fan);
        if ('steamEn' in data)
            this.steamOn = Boolean(data.steamEn);
        if ('steamOn' in data)
            this.steamOn = Boolean(data.steamOn);
        if ('targetTemp' in data)
            this.targetTemp = Number(data.targetTemp);
        if ('targetRh' in data)
            this.targetRh = Number(data.targetRh);
        if ('temperature' in data)
            this.currentTemp = Number(data.temperature);
        if ('humidity' in data)
            this.humidity = Number(data.humidity);
        if ('heatUpTime' in data)
            this.heatUpTime = Number(data.heatUpTime);
        if ('remainingTime' in data)
            this.remainingTime = Number(data.remainingTime);
        if ('statusCodes' in data)
            this.statusCodes = data.statusCodes;
        this.lastUpdate = new Date();
        this.notifySubscribers();
    }
    getEndpoint() {
        return this.api.getEndpoint('device');
    }
    async requestStateChange(payload) {
        const body = {
            operationName: 'Mutation',
            variables: {
                deviceId: this.id,
                state: JSON.stringify(payload),
                getFullState: false,
            },
            query: `mutation Mutation($deviceId: ID!, $state: AWSJSON!, $getFullState: Boolean) {\n  requestStateChange(deviceId: $deviceId, state: $state, getFullState: $getFullState)\n}\n`,
        };
        await this.api.appsyncRequest(this.getEndpoint(), body);
    }
    async setActive(value) {
        await this.requestStateChange({ active: value ? 1 : 0 });
    }
    async setLight(value) {
        await this.requestStateChange({ light: value ? 1 : 0 });
    }
    async setFan(value) {
        await this.requestStateChange({ fan: value ? 1 : 0 });
    }
    async setSteamer(value) {
        await this.requestStateChange({ steamEn: value ? 1 : 0 });
    }
    async setTargetTemperature(value) {
        await this.requestStateChange({ targetTemp: value });
    }
    async setTargetHumidity(value) {
        await this.requestStateChange({ targetRh: value });
    }
}
exports.HarviaDevice = HarviaDevice;
