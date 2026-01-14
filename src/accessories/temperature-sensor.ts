import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { MqttClient } from 'mqtt';
import { HabeetatPlatform } from '../platform';

/**
 * Temperature Sensor Accessory
 * Reports temperature readings from Habeetat sensors
 */
export class TemperatureSensorAccessory {
  private service: Service;
  private state = {
    currentTemperature: 20,
  };

  constructor(
    private readonly platform: HabeetatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: { uniqueId: string; name: string },
    _mqtt: MqttClient,
  ) {
    // Get or create the TemperatureSensor service
    this.service = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    // Register handlers
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this))
      .setProps({
        minValue: -40,
        maxValue: 100,
      });

    // Store update callback in context
    this.accessory.context.updateState = this.updateState.bind(this);
  }

  /**
   * Handle GET CurrentTemperature characteristic
   */
  async getCurrentTemperature(): Promise<CharacteristicValue> {
    return this.state.currentTemperature;
  }

  /**
   * Update state from MQTT message
   */
  updateState(state: { state?: number | string } | number | string): void {
    let temperature: number;

    if (typeof state === 'number') {
      temperature = state;
    } else if (typeof state === 'string') {
      temperature = parseFloat(state);
    } else if (state.state !== undefined) {
      temperature = typeof state.state === 'number' 
        ? state.state 
        : parseFloat(state.state);
    } else {
      return;
    }

    if (!isNaN(temperature)) {
      this.state.currentTemperature = temperature;
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        this.state.currentTemperature,
      );
      this.platform.log.debug(`Updated ${this.device.name} temperature:`, temperature);
    }
  }
}
