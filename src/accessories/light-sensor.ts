import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { MqttClient } from 'mqtt';
import { HabeetatPlatform } from '../platform';

// HomeKit's ambient light level cannot be below this value
const MIN_LEVEL = 0.0001;

/**
 * Light Sensor Accessory
 * Reports the light level of Habeetat light sensors. The bridge publishes a
 * percentage; HomeKit has no percentage characteristic, so the value is
 * passed through as the ambient light level.
 */
export class LightSensorAccessory {
  private service: Service;
  private state = {
    level: MIN_LEVEL,
  };

  constructor(
    private readonly platform: HabeetatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: { uniqueId: string; name: string },
    _mqtt: MqttClient,
  ) {
    this.service = this.accessory.getService(this.platform.Service.LightSensor) ||
      this.accessory.addService(this.platform.Service.LightSensor);

    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentAmbientLightLevel)
      .onGet(this.getLevel.bind(this));

    // Store update callback in context
    this.accessory.context.updateState = this.updateState.bind(this);
  }

  async getLevel(): Promise<CharacteristicValue> {
    return this.state.level;
  }

  /**
   * Update state from MQTT message
   */
  updateState(state: { state?: number | string } | number | string): void {
    let level: number;

    if (typeof state === 'number') {
      level = state;
    } else if (typeof state === 'string') {
      level = parseFloat(state);
    } else if (state.state !== undefined) {
      level = typeof state.state === 'number' ? state.state : parseFloat(state.state);
    } else {
      return;
    }

    if (!isNaN(level)) {
      this.state.level = Math.max(level, MIN_LEVEL);
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentAmbientLightLevel,
        this.state.level,
      );
      this.platform.log.debug(`Updated ${this.device.name} light level:`, level);
    }
  }
}
