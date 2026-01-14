import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { MqttClient } from 'mqtt';
import { HabeetatPlatform } from '../platform';

/**
 * Thermostat Accessory
 * Supports HVAC/climate control with heating, cooling, and fan modes
 */
export class ThermostatAccessory {
  private service: Service;
  private state = {
    currentTemperature: 20,
    targetTemperature: 22,
    currentHeatingCoolingState: 0, // 0=off, 1=heat, 2=cool
    targetHeatingCoolingState: 0,
  };

  constructor(
    private readonly platform: HabeetatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: { uniqueId: string; name: string; commandTopic: string },
    private readonly mqtt: MqttClient,
  ) {
    // Get or create the Thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    // Set temperature display units to Celsius
    this.service.setCharacteristic(
      this.platform.Characteristic.TemperatureDisplayUnits,
      this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
    );

    // Register handlers
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(this.getTargetTemperature.bind(this))
      .setProps({
        minValue: 16,
        maxValue: 30,
        minStep: 0.5,
      });

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onSet(this.setTargetHeatingCoolingState.bind(this))
      .onGet(this.getTargetHeatingCoolingState.bind(this));

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
   * Handle SET TargetTemperature characteristic
   */
  async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    this.state.targetTemperature = value as number;
    
    // Send command via MQTT
    const commandTopic = this.device.commandTopic.replace('/set', '/set_temperature');
    this.mqtt.publish(commandTopic, String(this.state.targetTemperature));
    
    this.platform.log.debug(`Set ${this.device.name} TargetTemperature ->`, value);
  }

  /**
   * Handle GET TargetTemperature characteristic
   */
  async getTargetTemperature(): Promise<CharacteristicValue> {
    return this.state.targetTemperature;
  }

  /**
   * Handle GET CurrentHeatingCoolingState characteristic
   */
  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    return this.state.currentHeatingCoolingState;
  }

  /**
   * Handle SET TargetHeatingCoolingState characteristic
   */
  async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    this.state.targetHeatingCoolingState = value as number;
    
    // Map HomeKit state to Habeetat mode
    let mode: string;
    switch (value) {
      case 0: // Off
        mode = 'off';
        break;
      case 1: // Heat
        mode = 'heat';
        break;
      case 2: // Cool
        mode = 'cool';
        break;
      case 3: // Auto
        mode = 'cool'; // Habeetat doesn't have auto, default to cool
        break;
      default:
        mode = 'off';
    }
    
    // Send command via MQTT
    const commandTopic = this.device.commandTopic.replace('/set', '/set_mode');
    this.mqtt.publish(commandTopic, mode);
    
    this.platform.log.debug(`Set ${this.device.name} TargetHeatingCoolingState ->`, value, `(${mode})`);
  }

  /**
   * Handle GET TargetHeatingCoolingState characteristic
   */
  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    return this.state.targetHeatingCoolingState;
  }

  /**
   * Update state from MQTT message
   */
  updateState(state: {
    current_temperature?: number;
    temperature?: number;
    mode?: string;
    hvac_action?: string;
  }): void {
    if (state.current_temperature !== undefined) {
      this.state.currentTemperature = state.current_temperature;
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        this.state.currentTemperature,
      );
    }

    if (state.temperature !== undefined) {
      this.state.targetTemperature = state.temperature;
      this.service.updateCharacteristic(
        this.platform.Characteristic.TargetTemperature,
        this.state.targetTemperature,
      );
    }

    if (state.mode !== undefined) {
      // Map Habeetat mode to HomeKit state
      switch (state.mode) {
        case 'off':
          this.state.targetHeatingCoolingState = 0;
          this.state.currentHeatingCoolingState = 0;
          break;
        case 'heat':
          this.state.targetHeatingCoolingState = 1;
          this.state.currentHeatingCoolingState = 1;
          break;
        case 'cool':
          this.state.targetHeatingCoolingState = 2;
          this.state.currentHeatingCoolingState = 2;
          break;
        case 'fan_only':
          this.state.targetHeatingCoolingState = 0;
          this.state.currentHeatingCoolingState = 0;
          break;
      }

      this.service.updateCharacteristic(
        this.platform.Characteristic.TargetHeatingCoolingState,
        this.state.targetHeatingCoolingState,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentHeatingCoolingState,
        this.state.currentHeatingCoolingState,
      );
    }

    this.platform.log.debug(`Updated ${this.device.name} state:`, this.state);
  }
}
