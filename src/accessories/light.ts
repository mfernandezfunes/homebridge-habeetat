import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { MqttClient } from 'mqtt';
import { HabeetatPlatform } from '../platform';
import { DeviceType } from '../settings';

/**
 * Light Accessory
 * Supports dimmable lights and RGB lights
 */
export class LightAccessory {
  private service: Service;
  private state = {
    on: false,
    brightness: 100,
    hue: 0,
    saturation: 0,
  };
  private isRgb: boolean;

  constructor(
    private readonly platform: HabeetatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: { uniqueId: string; name: string; type: DeviceType; commandTopic: string },
    private readonly mqtt: MqttClient,
  ) {
    this.isRgb = device.type === DeviceType.RGB || device.type === DeviceType.RGB_LIGHT;

    // Get or create the Lightbulb service
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    // Register handlers for On
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    // Register handlers for Brightness
    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(this.setBrightness.bind(this))
      .onGet(this.getBrightness.bind(this));

    // Register handlers for Hue and Saturation if RGB
    if (this.isRgb) {
      this.service.getCharacteristic(this.platform.Characteristic.Hue)
        .onSet(this.setHue.bind(this))
        .onGet(this.getHue.bind(this));

      this.service.getCharacteristic(this.platform.Characteristic.Saturation)
        .onSet(this.setSaturation.bind(this))
        .onGet(this.getSaturation.bind(this));
    }

    // Store update callback in context
    this.accessory.context.updateState = this.updateState.bind(this);
  }

  /**
   * Handle SET On characteristic
   */
  async setOn(value: CharacteristicValue): Promise<void> {
    this.state.on = value as boolean;
    this.publishState();
    this.platform.log.debug(`Set ${this.device.name} On ->`, value);
  }

  /**
   * Handle GET On characteristic
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.state.on;
  }

  /**
   * Handle SET Brightness characteristic
   */
  async setBrightness(value: CharacteristicValue): Promise<void> {
    this.state.brightness = value as number;
    this.publishState();
    this.platform.log.debug(`Set ${this.device.name} Brightness ->`, value);
  }

  /**
   * Handle GET Brightness characteristic
   */
  async getBrightness(): Promise<CharacteristicValue> {
    return this.state.brightness;
  }

  /**
   * Handle SET Hue characteristic
   */
  async setHue(value: CharacteristicValue): Promise<void> {
    this.state.hue = value as number;
    this.publishState();
    this.platform.log.debug(`Set ${this.device.name} Hue ->`, value);
  }

  /**
   * Handle GET Hue characteristic
   */
  async getHue(): Promise<CharacteristicValue> {
    return this.state.hue;
  }

  /**
   * Handle SET Saturation characteristic
   */
  async setSaturation(value: CharacteristicValue): Promise<void> {
    this.state.saturation = value as number;
    this.publishState();
    this.platform.log.debug(`Set ${this.device.name} Saturation ->`, value);
  }

  /**
   * Handle GET Saturation characteristic
   */
  async getSaturation(): Promise<CharacteristicValue> {
    return this.state.saturation;
  }

  /**
   * Publish state to MQTT
   */
  private publishState(): void {
    const payload: Record<string, unknown> = {
      state: this.state.on ? 'ON' : 'OFF',
      brightness: Math.round((this.state.brightness / 100) * 255),
    };

    if (this.isRgb) {
      payload.hs_color = [this.state.hue, this.state.saturation];
    }

    this.mqtt.publish(this.device.commandTopic, JSON.stringify(payload));
  }

  /**
   * Update state from MQTT message
   */
  updateState(state: {
    state?: string;
    brightness?: number;
    hs_color?: [number, number];
  }): void {
    if (state.state !== undefined) {
      this.state.on = state.state === 'ON';
      this.service.updateCharacteristic(
        this.platform.Characteristic.On,
        this.state.on,
      );
    }

    if (state.brightness !== undefined) {
      // Convert from 0-255 to 0-100
      this.state.brightness = Math.round((state.brightness / 255) * 100);
      this.service.updateCharacteristic(
        this.platform.Characteristic.Brightness,
        this.state.brightness,
      );
    }

    if (state.hs_color !== undefined && this.isRgb) {
      this.state.hue = state.hs_color[0];
      this.state.saturation = state.hs_color[1];
      this.service.updateCharacteristic(
        this.platform.Characteristic.Hue,
        this.state.hue,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.Saturation,
        this.state.saturation,
      );
    }

    this.platform.log.debug(`Updated ${this.device.name} state:`, this.state);
  }
}
