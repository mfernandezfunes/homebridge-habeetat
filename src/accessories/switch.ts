import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { MqttClient } from 'mqtt';
import { HabeetatPlatform } from '../platform';

/**
 * Switch Accessory
 * Simple on/off control for switches and non-dimmable lights
 */
export class SwitchAccessory {
  private service: Service;
  private state = {
    on: false,
  };

  constructor(
    private readonly platform: HabeetatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: { uniqueId: string; name: string; commandTopic: string },
    private readonly mqtt: MqttClient,
  ) {
    // Get or create the Switch service
    this.service = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    // Register handlers
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    // Store update callback in context
    this.accessory.context.updateState = this.updateState.bind(this);
  }

  /**
   * Handle SET On characteristic
   */
  async setOn(value: CharacteristicValue): Promise<void> {
    this.state.on = value as boolean;
    
    const payload = this.state.on ? 'ON' : 'OFF';
    this.mqtt.publish(this.device.commandTopic, payload);
    
    this.platform.log.debug(`Set ${this.device.name} On ->`, value);
  }

  /**
   * Handle GET On characteristic
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.state.on;
  }

  /**
   * Update state from MQTT message
   */
  updateState(state: { state?: string } | string): void {
    if (typeof state === 'string') {
      this.state.on = state === 'ON';
    } else if (state.state !== undefined) {
      this.state.on = state.state === 'ON';
    }

    this.service.updateCharacteristic(
      this.platform.Characteristic.On,
      this.state.on,
    );

    this.platform.log.debug(`Updated ${this.device.name} state:`, this.state);
  }
}
