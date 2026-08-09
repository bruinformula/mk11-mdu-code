const { SerialPort } = require('serialport');
const port = new SerialPort({ path: 'COM31', baudRate: 115200 });
port.on('data', (chunk) => {
  console.log('HEX:', chunk.toString('hex'));
  console.log('TXT:', chunk.toString('utf8'));
  process.exit(0);
});
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 3000);
