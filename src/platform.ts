import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import * as mqtt from 'mqtt';
import { PLATFORM_NAME, PLUGIN_NAME, DeviceType } from './settings';
import { LightAccessory } from './accessories/light';
import { SwitchAccessory } from './accessories/switch';
import { CoverAccessory } from './accessories/cover';
import { ThermostatAccessory } from './accessories/thermostat';
import { TemperatureSensorAccessory } from './accessories/temperature-sensor';

/**
 * Habeetat device configuration from MQTT discovery
 */
interface HabeetatDevice {
  uniqueId: string;
  name: string;
  type: DeviceType;
  stateTopic: string;
  commandTopic: string;
  manufacturer?: string;
  model?: string;
}

/**
 * Platform configuration
 */
interface HabeetatPlatformConfig extends PlatformConfig {
  mqtt: {
    broker: string;
    port?: number;
    username?: string;
    password?: string;
  };
  baseTopic?: string;
  devices?: HabeetatDevice[];
}

/**
 * Habeetat Platform Plugin
 * 
 * Connects to MQTT broker and discovers Habeetat devices
 * published by habeetat-bridge.
 */
export class HabeetatPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // Cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  // MQTT client
  private mqttClient?: mqtt.MqttClient;

  // Base topic for Habeetat devices
  private baseTopic: string;

  // Discovered devices
  private devices: Map<string, HabeetatDevice> = new Map();

  constructor(
    public readonly log: Logger,
    public readonly config: HabeetatPlatformConfig,
    public readonly api: API,
  ) {
    this.baseTopic = config.baseTopic || 'habeetat';

    this.log.debug('Finished initializing platform:', config.name);

    // Wait for Homebridge to finish loading before connecting
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.connectMqtt();
    });
  }

  /**
   * Connect to MQTT broker
   */
  private connectMqtt(): void {
    if (!this.config.mqtt?.broker) {
      this.log.error('MQTT broker not configured');
      return;
    }

    const brokerUrl = `mqtt://${this.config.mqtt.broker}:${this.config.mqtt.port || 1883}`;
    
    this.log.info(`Connecting to MQTT broker: ${brokerUrl}`);

    const options: mqtt.IClientOptions = {
      clientId: `homebridge-habeetat-${Math.random().toString(16).slice(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
    };

    if (this.config.mqtt.username) {
      options.username = this.config.mqtt.username;
      options.password = this.config.mqtt.password;
    }

    this.mqttClient = mqtt.connect(brokerUrl, options);

    this.mqttClient.on('connect', () => {
      this.log.info('Connected to MQTT broker');
      this.subscribeToTopics();
      this.discoverDevices();
    });

    this.mqttClient.on('error', (error) => {
      this.log.error('MQTT error:', error.message);
    });

    this.mqttClient.on('message', (topic, payload) => {
      this.handleMqttMessage(topic, payload.toString());
    });
  }

  /**
   * Subscribe to Habeetat topics
   */
  private subscribeToTopics(): void {
    if (!this.mqttClient) return;

    // Subscribe to all state topics
    const stateTopic = `${this.baseTopic}/+/state`;
    this.mqttClient.subscribe(stateTopic, (err) => {
      if (err) {
        this.log.error(`Failed to subscribe to ${stateTopic}:`, err.message);
      } else {
        this.log.debug(`Subscribed to ${stateTopic}`);
      }
    });

    // Subscribe to Home Assistant discovery topics
    const discoveryTopic = 'homeassistant/+/habeetat_+/config';
    this.mqttClient.subscribe(discoveryTopic, (err) => {
      if (err) {
        this.log.error(`Failed to subscribe to ${discoveryTopic}:`, err.message);
      } else {
        this.log.debug(`Subscribed to ${discoveryTopic}`);
      }
    });
  }

  /**
   * Discover devices from config or MQTT
   */
  private discoverDevices(): void {
    // Add devices from config
    if (this.config.devices) {
      for (const device of this.config.devices) {
        this.addDevice(device);
      }
    }
  }

  /**
   * Handle incoming MQTT messages
   */
  private handleMqttMessage(topic: string, payload: string): void {
    // Handle HA discovery messages
    if (topic.startsWith('homeassistant/')) {
      this.handleDiscoveryMessage(topic, payload);
      return;
    }

    // Handle state updates
    const match = topic.match(new RegExp(`^${this.baseTopic}/([^/]+)/state$`));
    if (match) {
      const deviceId = match[1];
      this.handleStateUpdate(deviceId, payload);
    }
  }

  /**
   * Handle Home Assistant discovery message
   */
  private handleDiscoveryMessage(topic: string, payload: string): void {
    try {
      const config = JSON.parse(payload);
      
      if (!config.unique_id || !config.name) {
        return;
      }

      // Extract device type from topic
      const topicParts = topic.split('/');
      const component = topicParts[1]; // light, switch, cover, climate, sensor

      let deviceType: DeviceType;
      switch (component) {
        case 'light':
          // Check if RGB
          if (config.supported_color_modes?.includes('hs') || config.supported_color_modes?.includes('rgb')) {
            deviceType = DeviceType.RGB;
          } else if (config.brightness) {
            deviceType = DeviceType.DIMMER;
          } else {
            deviceType = DeviceType.LIGHT;
          }
          break;
        case 'switch':
          deviceType = DeviceType.SWITCH;
          break;
        case 'cover':
          deviceType = DeviceType.COVER;
          break;
        case 'climate':
          deviceType = DeviceType.CLIMATE;
          break;
        case 'sensor':
          if (config.device_class === 'temperature') {
            deviceType = DeviceType.TEMPERATURE_SENSOR;
          } else {
            deviceType = DeviceType.LIGHT_SENSOR;
          }
          break;
        default:
          this.log.debug(`Unknown component type: ${component}`);
          return;
      }

      const device: HabeetatDevice = {
        uniqueId: config.unique_id,
        name: config.name,
        type: deviceType,
        stateTopic: config.state_topic,
        commandTopic: config.command_topic,
        manufacturer: config.device?.manufacturer || 'Solidmation',
        model: config.device?.model || 'Habeetat',
      };

      this.addDevice(device);
    } catch (error) {
      this.log.debug('Failed to parse discovery message:', payload);
    }
  }

  /**
   * Handle device state update
   */
  private handleStateUpdate(deviceId: string, payload: string): void {
    const accessory = this.accessories.find(
      (acc) => acc.context.device?.uniqueId === deviceId,
    );

    if (accessory && accessory.context.updateState) {
      try {
        const state = JSON.parse(payload);
        accessory.context.updateState(state);
      } catch {
        // Simple string state
        accessory.context.updateState(payload);
      }
    }
  }

  /**
   * Add a device and create accessory
   */
  private addDevice(device: HabeetatDevice): void {
    if (this.devices.has(device.uniqueId)) {
      return; // Already added
    }

    this.devices.set(device.uniqueId, device);
    this.log.info(`Discovered device: ${device.name} (${device.type})`);

    // Generate UUID for accessory
    const uuid = this.api.hap.uuid.generate(device.uniqueId);

    // Check if accessory already exists
    const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);

    if (existingAccessory) {
      // Restore existing accessory
      this.log.info(`Restoring existing accessory: ${device.name}`);
      existingAccessory.context.device = device;
      this.setupAccessory(existingAccessory, device);
    } else {
      // Create new accessory
      this.log.info(`Adding new accessory: ${device.name}`);
      const accessory = new this.api.platformAccessory(device.name, uuid);
      accessory.context.device = device;
      this.setupAccessory(accessory, device);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  /**
   * Configure accessory based on device type
   */
  private setupAccessory(accessory: PlatformAccessory, device: HabeetatDevice): void {
    // Set accessory information
    accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, device.manufacturer || 'Solidmation')
      .setCharacteristic(this.Characteristic.Model, device.model || 'Habeetat')
      .setCharacteristic(this.Characteristic.SerialNumber, device.uniqueId);

    // Create appropriate accessory handler
    switch (device.type) {
      case DeviceType.SWITCH:
      case DeviceType.LIGHT:
        new SwitchAccessory(this, accessory, device, this.mqttClient!);
        break;

      case DeviceType.DIMMER:
      case DeviceType.RGB:
      case DeviceType.RGB_LIGHT:
        new LightAccessory(this, accessory, device, this.mqttClient!);
        break;

      case DeviceType.COVER:
      case DeviceType.CURTAIN:
        new CoverAccessory(this, accessory, device, this.mqttClient!);
        break;

      case DeviceType.CLIMATE:
        new ThermostatAccessory(this, accessory, device, this.mqttClient!);
        break;

      case DeviceType.TEMPERATURE_SENSOR:
        new TemperatureSensorAccessory(this, accessory, device, this.mqttClient!);
        break;

      default:
        this.log.warn(`Unsupported device type: ${device.type}`);
    }
  }

  /**
   * Called by Homebridge to restore cached accessories
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Loading accessory from cache: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }

  /**
   * Publish MQTT message
   */
  public publish(topic: string, payload: string): void {
    if (this.mqttClient?.connected) {
      this.mqttClient.publish(topic, payload);
    }
  }
}
