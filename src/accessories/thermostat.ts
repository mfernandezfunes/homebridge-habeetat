import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { MqttClient } from 'mqtt';
import { HabeetatPlatform } from '../platform';

/**
 * MQTT topics of a habeetat-bridge climate device.
 * The bridge publishes each value on its own topic (no JSON state).
 */
export interface ClimateTopics {
  modeState: string;
  modeCommand: string;
  temperatureState: string;
  temperatureCommand: string;
  currentTemperature: string;
  fanModeState: string;
  fanModeCommand: string;
  swingModeState?: string;
  swingModeCommand?: string;
}

export interface ClimateConfig {
  topics: ClimateTopics;
  modes: string[];
  fanModes: string[];
  swingModes: string[];
  minTemp: number;
  maxTemp: number;
}

/**
 * State topics and the field name passed to updateState()
 */
export const CLIMATE_STATE_FIELDS: Array<[keyof ClimateTopics, string]> = [
  ['modeState', 'mode'],
  ['temperatureState', 'temperature'],
  ['currentTemperature', 'current_temperature'],
  ['fanModeState', 'fan_mode'],
  ['swingModeState', 'swing_mode'],
];

const DEFAULT_MODES = ['off', 'cool', 'heat', 'dry', 'fan_only', 'auto'];
const DEFAULT_FAN_MODES = ['low', 'medium', 'high', 'auto'];

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function strList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : fallback;
}

/**
 * Build climate config from a Home Assistant discovery payload
 */
export function climateConfigFromDiscovery(config: Record<string, unknown>): ClimateConfig | undefined {
  const topics = {
    modeState: str(config.mode_state_topic),
    modeCommand: str(config.mode_command_topic),
    temperatureState: str(config.temperature_state_topic),
    temperatureCommand: str(config.temperature_command_topic),
    currentTemperature: str(config.current_temperature_topic),
    fanModeState: str(config.fan_mode_state_topic),
    fanModeCommand: str(config.fan_mode_command_topic),
    swingModeState: str(config.swing_mode_state_topic),
    swingModeCommand: str(config.swing_mode_command_topic),
  };
  if (!topics.modeState || !topics.modeCommand || !topics.temperatureState || !topics.temperatureCommand ||
      !topics.currentTemperature || !topics.fanModeState || !topics.fanModeCommand) {
    return undefined;
  }
  return {
    topics: topics as ClimateTopics,
    modes: strList(config.modes, DEFAULT_MODES),
    fanModes: strList(config.fan_modes, DEFAULT_FAN_MODES),
    swingModes: strList(config.swing_modes, []),
    minTemp: typeof config.min_temp === 'number' ? config.min_temp : 16,
    maxTemp: typeof config.max_temp === 'number' ? config.max_temp : 30,
  };
}

/**
 * Build climate config for a manually configured device, using the
 * habeetat-bridge topic layout: <base>/mode, <base>/set_mode, ...
 */
export function climateConfigFromBase(base: string): ClimateConfig {
  return {
    topics: {
      modeState: `${base}/mode`,
      modeCommand: `${base}/set_mode`,
      temperatureState: `${base}/temperature`,
      temperatureCommand: `${base}/set_temperature`,
      currentTemperature: `${base}/current_temperature`,
      fanModeState: `${base}/fan_mode`,
      fanModeCommand: `${base}/set_fan_mode`,
      swingModeState: `${base}/swing_mode`,
      swingModeCommand: `${base}/set_swing_mode`,
    },
    modes: DEFAULT_MODES,
    fanModes: DEFAULT_FAN_MODES,
    swingModes: ['off', 'on'],
    minTemp: 16,
    maxTemp: 30,
  };
}

// Fan speed <-> HomeKit RotationSpeed (%)
const FAN_SPEED_PERCENT: Record<string, number> = { low: 33, medium: 66, high: 100 };

function percentToFanSpeed(value: number): string {
  if (value <= 33) return 'low';
  if (value <= 66) return 'medium';
  return 'high';
}

/**
 * Thermostat Accessory
 *
 * - Thermostat service: off / heat / cool / auto + target and current temperature
 * - Fanv2 service: on/off, speed (low/medium/high), auto fan and swing
 *
 * HomeKit has no dry or fan-only thermostat modes. When the AC is in one of
 * them the thermostat shows OFF and the fan shows ON.
 */
export class ThermostatAccessory {
  private service: Service;
  private fanService: Service;
  private readonly hasSwing: boolean;
  private state = {
    mode: 'off',
    lastActiveMode: 'cool',
    currentTemperature: 20,
    targetTemperature: 22,
    fanMode: 'auto',
    rotationSpeed: 100,
    swingMode: 'off',
  };

  constructor(
    private readonly platform: HabeetatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: { uniqueId: string; name: string; climate: ClimateConfig },
    private readonly mqtt: MqttClient,
  ) {
    const { Characteristic } = this.platform;
    const climate = device.climate;
    this.hasSwing = Boolean(climate.topics.swingModeCommand && climate.swingModes.includes('on'));

    // Get or create the Thermostat service
    this.service = this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat);

    // Set the service name
    this.service.setCharacteristic(Characteristic.Name, device.name);

    // Set temperature display units to Celsius
    this.service.setCharacteristic(
      Characteristic.TemperatureDisplayUnits,
      Characteristic.TemperatureDisplayUnits.CELSIUS,
    );

    // Register handlers
    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.state.currentTemperature);

    // Start inside the device range (HomeKit default minimum is 10 °C)
    this.state.targetTemperature = Math.min(climate.maxTemp, Math.max(climate.minTemp, this.state.targetTemperature));
    this.service.getCharacteristic(Characteristic.TargetTemperature)
      .updateValue(this.state.targetTemperature)
      .onSet(this.setTargetTemperature.bind(this))
      .onGet(() => this.state.targetTemperature)
      .setProps({
        minValue: climate.minTemp,
        maxValue: climate.maxTemp,
        minStep: 0.5,
      });

    this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    const validModes = [Characteristic.TargetHeatingCoolingState.OFF];
    if (climate.modes.includes('heat')) validModes.push(Characteristic.TargetHeatingCoolingState.HEAT);
    if (climate.modes.includes('cool')) validModes.push(Characteristic.TargetHeatingCoolingState.COOL);
    if (climate.modes.includes('auto')) validModes.push(Characteristic.TargetHeatingCoolingState.AUTO);

    this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: validModes })
      .onSet(this.setTargetHeatingCoolingState.bind(this))
      .onGet(this.getTargetHeatingCoolingState.bind(this));

    // Fan service (speed, auto, swing)
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2, `${device.name} Fan`);

    this.fanService.getCharacteristic(Characteristic.Active)
      .onSet(this.setFanActive.bind(this))
      .onGet(() => this.isOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);

    this.fanService.getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(() => this.state.rotationSpeed);

    if (climate.fanModes.includes('auto')) {
      this.fanService.getCharacteristic(Characteristic.TargetFanState)
        .onSet(this.setTargetFanState.bind(this))
        .onGet(() => this.state.fanMode === 'auto'
          ? Characteristic.TargetFanState.AUTO
          : Characteristic.TargetFanState.MANUAL);
    }

    if (this.hasSwing) {
      this.fanService.getCharacteristic(Characteristic.SwingMode)
        .onSet(this.setSwingMode.bind(this))
        .onGet(() => this.state.swingMode === 'on'
          ? Characteristic.SwingMode.SWING_ENABLED
          : Characteristic.SwingMode.SWING_DISABLED);
    }

    // Store update callback in context
    this.accessory.context.updateState = this.updateState.bind(this);
  }

  private isOn(): boolean {
    return this.state.mode !== 'off';
  }

  private publish(topic: string, payload: string): void {
    this.mqtt.publish(topic, payload);
    this.platform.log.debug(`${this.device.name}: ${topic} <- ${payload}`);
  }

  private sendMode(mode: string): void {
    this.state.mode = mode;
    if (mode !== 'off') {
      this.state.lastActiveMode = mode;
    }
    this.publish(this.device.climate.topics.modeCommand, mode);
  }

  /**
   * Handle SET TargetTemperature characteristic
   */
  async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    this.state.targetTemperature = value as number;
    this.publish(this.device.climate.topics.temperatureCommand, String(this.state.targetTemperature));
  }

  /**
   * Handle GET CurrentHeatingCoolingState characteristic
   */
  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    return this.currentHeatingCoolingState();
  }

  private currentHeatingCoolingState(): number {
    const { CurrentHeatingCoolingState } = this.platform.Characteristic;
    switch (this.state.mode) {
      case 'heat':
        return CurrentHeatingCoolingState.HEAT;
      case 'cool':
        return CurrentHeatingCoolingState.COOL;
      case 'auto':
        return this.state.currentTemperature < this.state.targetTemperature
          ? CurrentHeatingCoolingState.HEAT
          : CurrentHeatingCoolingState.COOL;
      default:
        return CurrentHeatingCoolingState.OFF;
    }
  }

  /**
   * Handle SET TargetHeatingCoolingState characteristic
   */
  async setTargetHeatingCoolingState(value: CharacteristicValue): Promise<void> {
    const { TargetHeatingCoolingState } = this.platform.Characteristic;
    let mode: string;
    switch (value) {
      case TargetHeatingCoolingState.HEAT:
        mode = 'heat';
        break;
      case TargetHeatingCoolingState.COOL:
        mode = 'cool';
        break;
      case TargetHeatingCoolingState.AUTO:
        mode = 'auto';
        break;
      default:
        mode = 'off';
    }
    this.sendMode(mode);
    this.refreshCharacteristics();
  }

  /**
   * Handle GET TargetHeatingCoolingState characteristic
   */
  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    return this.targetHeatingCoolingState();
  }

  private targetHeatingCoolingState(): number {
    const { TargetHeatingCoolingState } = this.platform.Characteristic;
    switch (this.state.mode) {
      case 'heat':
        return TargetHeatingCoolingState.HEAT;
      case 'cool':
        return TargetHeatingCoolingState.COOL;
      case 'auto':
        return TargetHeatingCoolingState.AUTO;
      default:
        // off, dry and fan_only have no HomeKit thermostat equivalent
        return TargetHeatingCoolingState.OFF;
    }
  }

  /**
   * Fan on/off: off turns the AC off, on restores the last mode
   */
  async setFanActive(value: CharacteristicValue): Promise<void> {
    const active = value === this.platform.Characteristic.Active.ACTIVE;
    if (active === this.isOn()) return;
    this.sendMode(active ? this.state.lastActiveMode : 'off');
    this.refreshCharacteristics();
  }

  async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    const percent = value as number;
    // HomeKit sends 0 together with Active=INACTIVE, handled by setFanActive
    if (percent <= 0) return;
    const fanMode = percentToFanSpeed(percent);
    this.state.rotationSpeed = FAN_SPEED_PERCENT[fanMode];
    this.state.fanMode = fanMode;
    this.publish(this.device.climate.topics.fanModeCommand, fanMode);
  }

  async setTargetFanState(value: CharacteristicValue): Promise<void> {
    const auto = value === this.platform.Characteristic.TargetFanState.AUTO;
    const fanMode = auto ? 'auto' : percentToFanSpeed(this.state.rotationSpeed);
    this.state.fanMode = fanMode;
    this.publish(this.device.climate.topics.fanModeCommand, fanMode);
  }

  async setSwingMode(value: CharacteristicValue): Promise<void> {
    const swing = value === this.platform.Characteristic.SwingMode.SWING_ENABLED ? 'on' : 'off';
    this.state.swingMode = swing;
    this.publish(this.device.climate.topics.swingModeCommand!, swing);
  }

  /**
   * Push the cached state to HomeKit
   */
  private refreshCharacteristics(): void {
    const { Characteristic } = this.platform;
    this.service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.targetHeatingCoolingState());
    this.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.currentHeatingCoolingState());
    this.service.updateCharacteristic(Characteristic.CurrentTemperature, this.state.currentTemperature);
    this.service.updateCharacteristic(Characteristic.TargetTemperature, this.state.targetTemperature);
    this.fanService.updateCharacteristic(
      Characteristic.Active,
      this.isOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
    );
    this.fanService.updateCharacteristic(Characteristic.RotationSpeed, this.state.rotationSpeed);
    if (this.device.climate.fanModes.includes('auto')) {
      this.fanService.updateCharacteristic(
        Characteristic.TargetFanState,
        this.state.fanMode === 'auto' ? Characteristic.TargetFanState.AUTO : Characteristic.TargetFanState.MANUAL,
      );
    }
    if (this.hasSwing) {
      this.fanService.updateCharacteristic(
        Characteristic.SwingMode,
        this.state.swingMode === 'on' ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED,
      );
    }
  }

  /**
   * Update state from MQTT. The platform calls this with one field per
   * message (e.g. { mode: 'cool' }), since the bridge uses one topic per value.
   */
  updateState(state: {
    current_temperature?: number | string;
    temperature?: number | string;
    mode?: string;
    fan_mode?: string;
    swing_mode?: string;
  }): void {
    if (state.current_temperature !== undefined) {
      const value = Number(state.current_temperature);
      if (!Number.isNaN(value)) this.state.currentTemperature = value;
    }

    if (state.temperature !== undefined) {
      const value = Number(state.temperature);
      if (!Number.isNaN(value)) this.state.targetTemperature = value;
    }

    if (state.mode !== undefined) {
      this.state.mode = state.mode;
      if (state.mode !== 'off') {
        this.state.lastActiveMode = state.mode;
      }
    }

    if (state.fan_mode !== undefined) {
      this.state.fanMode = state.fan_mode;
      if (FAN_SPEED_PERCENT[state.fan_mode] !== undefined) {
        this.state.rotationSpeed = FAN_SPEED_PERCENT[state.fan_mode];
      }
    }

    if (state.swing_mode !== undefined) {
      this.state.swingMode = state.swing_mode;
    }

    this.refreshCharacteristics();
    this.platform.log.debug(`Updated ${this.device.name} state:`, this.state);
  }
}
