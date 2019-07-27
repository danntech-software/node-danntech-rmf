# danntech-rmf

Implementation of the Danntech RMF protocol in node, using [serialport](https://www.npmjs.com/package/serialport).

## Usage

`npm install --save @danntech/rmf`

Note: if using within an [Electron](https://electronjs.org/) app, see [here](https://electronjs.org/docs/tutorial/using-native-node-modules#installing-modules-and-rebuilding-for-electron) for instructions on building within Electron.

```ts
// example.ts

import { RmfMaster } from '@danntech/rmf';

runExample();

async function runExample() {
  console.log(RmfMaster.list()); // Lists the set of available serial ports on this computer

  const port = new RmfMaster('COM3', { baud: 57600 });
  await port.open();
  await port.writeRegister(1, 2); // Write value "2" to register "1"
  const value = port.readRegister(1);
  console.log(value); // If the write was successful, this should log "2"
}
```

`RmfMaster` inherits from [SerialPort](https://www.npmjs.com/package/serialport), and the options provided are as documented for `SerialPort`.

## Development

 - Clone repo
 - Run `npm install` in the repo to download dependencies
 - Make changes
 - Run `npm build` to compile the TS to JS
 - Update version number
 - Run `npm publish` to publish changes to NPM

