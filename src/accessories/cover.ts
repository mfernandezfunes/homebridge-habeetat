import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { MqttClient } from 'mqtt';
import { HabeetatPlatform } from '../platform';

/**
 * Cover/WindowCovering Accessory
 * Supports curtains and blinds with position control
 */
export class CoverAccessory {
  private service: Service;
  private state = {
    currentPosition: 0,
    targetPosition: 0,
    positionState: 2, // 0=decreasing, 1=increasing, 2=stopped
  };

  constructor(
    private readonly platform: HabeetatPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly device: { uniqueId: string; name: string; commandTopic: string },
    private readonly mqtt: MqttClient,
  ) {
    // Get or create the WindowCovering service
    this.service = this.accessory.getService(this.platform.Service.WindowCovering) ||
      this.accessory.addService(this.platform.Service.WindowCovering);

    // Set the service name
    this.service.setCharacteristic(this.platform.Characteristic.Name, device.name);

    // Register handlers
    this.service.getCharacteristic(this.platform.Characteristic.CurrentPosition)
      .onGet(this.getCurrentPosition.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetPosition)
      .onSet(this.setTargetPosition.bind(this))
      .onGet(this.getTargetPosition.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.PositionState)
      .onGet(this.getPositionState.bind(this));

    // Store update callback in context
    this.accessory.context.updateState = this.updateState.bind(this);
  }

  /**
   * Handle GET CurrentPosition characteristic
   */
  async getCurrentPosition(): Promise<CharacteristicValue> {
    return this.state.currentPosition;
  }

  /**
   * Handle SET TargetPosition characteristic
   */
  async setTargetPosition(value: CharacteristicValue): Promise<void> {
    this.state.targetPosition = value as number;
    
    // Determine position state
    if (this.state.targetPosition > this.state.currentPosition) {
      this.state.positionState = 1; // Increasing (opening)
    } else if (this.state.targetPosition < this.state.currentPosition) {
      this.state.positionState = 0; // Decreasing (closing)
    }

    // Send command via MQTT
    // habeetat-bridge expects position in set_position topic
    const commandTopic = this.device.commandTopic.replace('/set', '/set_position');
    this.mqtt.publish(commandTopic, String(this.state.targetPosition));
    
    this.platform.log.debug(`Set ${this.device.name} TargetPosition ->`, value);
  }

  /**
   * Handle GET TargetPosition characteristic
   */
  async getTargetPosition(): Promise<CharacteristicValue> {
    return this.state.targetPosition;
  }

  /**
   * Handle GET PositionState characteristic
   */
  async getPositionState(): Promise<CharacteristicValue> {
    return this.state.positionState;
  }

  /**
   * Update state from MQTT message
   */
  updateState(state: {
    position?: number;
    state?: string;
  }): void {
    if (state.position !== undefined) {
      this.state.currentPosition = state.position;
      this.state.targetPosition = state.position;
      this.state.positionState = 2; // Stopped

      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentPosition,
        this.state.currentPosition,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.TargetPosition,
        this.state.targetPosition,
      );
      this.service.updateCharacteristic(
        this.platform.Characteristic.PositionState,
        this.state.positionState,
      );
    }

    // Handle state strings
    if (state.state !== undefined) {
      switch (state.state) {
        case 'opening':
          this.state.positionState = 1;
          break;
        case 'closing':
          this.state.positionState = 0;
          break;
        case 'stopped':
        case 'open':
        case 'closed':
          this.state.positionState = 2;
          break;
      }
      this.service.updateCharacteristic(
        this.platform.Characteristic.PositionState,
        this.state.positionState,
      );
    }

    this.platform.log.debug(`Updated ${this.device.name} state:`, this.state);
  }
}
