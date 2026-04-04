"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoorSensorAccessory = void 0;
class DoorSensorAccessory {
    constructor(log, device, accessory, hbApi) {
        this.log = log;
        this.device = device;
        this.hbApi = hbApi;
        const { Service, Characteristic } = this.hbApi.hap;
        this.Characteristic = Characteristic;
        this.service =
            accessory.getService(Service.ContactSensor) ||
                accessory.addService(Service.ContactSensor, `${device.name} Door`);
        this.service
            .getCharacteristic(Characteristic.ContactSensorState)
            .onGet(() => this.device.isDoorOpen
            ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : Characteristic.ContactSensorState.CONTACT_DETECTED);
        this.device.subscribe(this);
    }
    onDeviceUpdate() {
        const doorOpen = this.device.isDoorOpen;
        this.service.updateCharacteristic(this.Characteristic.ContactSensorState, doorOpen
            ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.Characteristic.ContactSensorState.CONTACT_DETECTED);
    }
}
exports.DoorSensorAccessory = DoorSensorAccessory;
