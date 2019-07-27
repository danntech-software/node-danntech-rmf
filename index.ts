import * as SerialPort from 'serialport';

const MAX_MESSAGE_LENGTH = 200;
const RESPONSE_TIMEOUT_MS = 200;

const rmfCommands = {
  readRegister: 2,
  writeRegister: 3,
};

interface RmfMessage {
  deviceAddress: number;
  command: number;
  register: number;
  data: number;
}

const timeout = (duration: number) => new Promise((_, reject) => setTimeout(reject, duration));

export class RmfMaster extends SerialPort {
  _readBuffer: string;

	constructor(path: string, options?: SerialPort.OpenOptions) {
    options = {
      // Encouraging callers to open manually because `open` returns a promise
      // while `new` does not.
      autoOpen: false,
      ...options
    };
    super(path, options);
    this.on('data', this._onDataReceived.bind(this));

    this._readBuffer = '';
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      SerialPort.prototype.open.call(this, (error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      })
    })
  }

  async writeRegister(deviceAddress: number, registerNumber: number, registerValue: number): Promise<void> {
    if (!isUint16(deviceAddress) || deviceAddress > 63) {
      throw new Error('RMF addresses must be in the range 0 to 63');
    }
    if (!isUint16(registerNumber)) {
      throw new Error('Expected register number in the range 0 to 0xffff');
    }
    if (!isUint16(registerValue)) {
      throw new Error('Expected register value in the range 0 to 0xffff');
    }
    const command = rmfCommands.writeRegister;
    const checksum = (deviceAddress + command + registerNumber + registerValue) & 0xffff;
    this._clearReadBuffer();
    this.write(`@${deviceAddress},${command},${registerNumber},${registerValue},${checksum}\r`, 'ascii');
    const cancel = new Array<() => void>();
    try {
      const response = await timeoutRequest(this._waitForNextMessage(cancel), RESPONSE_TIMEOUT_MS);
      if (response.deviceAddress !== deviceAddress) {
        throw new Error(`Expected response with device address ${deviceAddress}, but response has address ${response.deviceAddress}`);
      }
      if (response.command !== (command | 0x80)) {
        throw new Error(`Expected response with command ${command | 0x80}, but response has address ${response.command}`);
      }
      if (response.register !== registerNumber) {
        throw new Error(`Expected response with register ${registerNumber}, but response has register ${response.register}`);
      }
      if (response.data !== 0) {
        throw new Error(`Expected write command to respond with data "0", but instead response has data ${response.data}`);
      }
    } finally {
      // Clean up any registered listeners
      cancel.forEach(c => c());
    }
  }

  async readRegister(deviceAddress: number, registerNumber: number): Promise<number> {
    if (!isUint16(deviceAddress) || deviceAddress > 63) {
      throw new Error('RMF addresses must be in the range 0 to 63');
    }
    if (!isUint16(registerNumber)) {
      throw new Error('Expected register number in the range 0 to 0xffff');
    }
    const command = rmfCommands.readRegister;
    const checksum = (deviceAddress + command + registerNumber) & 0xffff;
    this._clearReadBuffer();
    this.write(`@${deviceAddress},${command},${registerNumber},0,${checksum}\r`, 'ascii');
    const cancel = new Array<() => void>();
    try {
      const response = await timeoutRequest(this._waitForNextMessage(cancel), RESPONSE_TIMEOUT_MS);
      if (response.deviceAddress !== deviceAddress) {
        throw new Error(`Expected response with device address ${deviceAddress}, but response has address ${response.deviceAddress}`);
      }
      if (response.command !== (command | 0x80)) {
        throw new Error(`Expected response with command ${command | 0x80}, but response has address ${response.command}`);
      }
      if (response.register !== registerNumber) {
        throw new Error(`Expected response with register ${registerNumber}, but response has register ${response.register}`);
      }
      return response.data;
    } finally {
      // Clean up any registered listeners
      cancel.forEach(c => c());
    }
  }

  _onDataReceived(data: Buffer) {
    if (!Buffer.isBuffer(data)) {
      throw new Error('Expected data in buffer format');
    }
    // Maintain a sliding window of the last N received chars
    this._readBuffer = (this._readBuffer + data.toString('ascii')).slice(-MAX_MESSAGE_LENGTH);

    // A response message looks like this
    const responseRegex = /@(?<deviceAddress>\d+),(?<command>\d+),(?<register>\d+),(?<data>\d+),(?<checksum>\d+)\r/;
    let match = this._readBuffer.match(responseRegex);
    while (match) {
      // Remove from input buffer
      this._readBuffer = this._readBuffer.slice((match.index || 0) + match[0].length);

      const { deviceAddress, command, register, data, checksum } = match.groups as any;
      const expectedChecksum = (deviceAddress + command + register + data) & 0xffff;
      if (checksum !== expectedChecksum) {
        this.emit('error', new Error('RX checksum failure'));
      } else {
        const rmfMessage: RmfMessage = { deviceAddress, command, register, data };
        this.emit('rmf-message', rmfMessage);
      }
      match = this._readBuffer.match(responseRegex);
    }
  }

  _waitForNextMessage(cancel: Array<() => void>): Promise<RmfMessage> {
    return new Promise((resolve, reject) => {
      this.once('rmf-message', resolve);
      this.once('error', reject);
      cancel.push(() => {
        this.removeListener('rmf-message', resolve);
        this.removeListener('error', reject);
      });
    });
  }

  _clearReadBuffer() {
    this._readBuffer = '';
  }
}

function isUint16(value: number) {
  if (Object.is(value, NaN)) return false;
  if (value === Infinity) return false;
  if (value === -Infinity) return false;
  if (value !== (value | 0)) return false; // Not an integer
  if (value > 0xffff) return false;
  if (value < 0) return false;
}

function timeoutRequest<T>(request: Promise<T>, duration: number): Promise<T> {
  return Promise.race([request, timeout(duration)]) as Promise<T>;
}