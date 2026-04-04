"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwitchAccessory = void 0;
class SwitchAccessory {
    constructor(log, device, accessory, type, hbApi) {
        this.log = log;
        this.device = device;
        this.type = type;
        this.hbApi = hbApi;
        const { Service, Characteristic } = this.hbApi.hap;
        this.Characteristic = Characteristic;
        this.displayName = `${device.name} ${type}`;
        this.service = accessory.getService(Service.Switch) || accessory.addService(Service.Switch, this.displayName);
        accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, 'Harvia')
            .setCharacteristic(Characteristic.Model, 'Xenio WiFi')
            .setCharacteristic(Characteristic.SerialNumber, `${device.id}-${type}`);
        this.service
            .getCharacteristic(Characteristic.On)
            .onGet(() => this.getCurrentState())
            .onSet(async (value) => {
            await this.setState(value === true || value === 1);
        });
        this.device.subscribe(this);
    }
    onDeviceUpdate() {
        this.service.updateCharacteristic(this.Characteristic.On, this.getCurrentState());
    }
    getCurrentState() {
        switch (this.type) {
            case 'power': return this.device.active;
            case 'light': return this.device.lightsOn;
            case 'fan': return this.device.fanOn;
            case 'steamer': return this.device.steamOn;
        }
    }
    async setState(value) {
        switch (this.type) {
            case 'power':
                await this.device.setActive(value);
                break;
            case 'light':
                await this.device.setLight(value);
                break;
            case 'fan':
                await this.device.setFan(value);
                break;
            case 'steamer':
                await this.device.setSteamer(value);
                break;
        }
    }
}
exports.SwitchAccessory = SwitchAccessory;
