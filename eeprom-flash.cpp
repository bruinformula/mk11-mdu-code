#include <Wire.h>

const uint8_t EEPROM_ADDR = 0x50; // AT24C02 7-bit address

// Explicitly define the ESP32-S3 I2C pins
const int I2C_SDA_PIN = 8;
const int I2C_SCL_PIN = 9;

// The standard USB2514B configuration
const uint8_t usb2514b_config[] = {0x24, 0x04, 0x14, 0x25, 0xB3, 0x0B,
                                   0x9B, 0x20, 0x02, 0x00, 0x00, 0x00,
                                   0x01, 0x32, 0x01, 0x32, 0x32};

// --- Function to write a single byte to the EEPROM ---
void writeEEPROM(uint8_t deviceAddress, uint8_t memoryAddress, uint8_t data) {
  Wire.beginTransmission(deviceAddress);
  Wire.write(memoryAddress);
  Wire.write(data);

  // End transmission and check for an ACK (0 = Success)
  uint8_t error = Wire.endTransmission();

  if (error != 0) {
    Serial.print("I2C Error ");
    Serial.print(error);
    Serial.print(" at address 0x");
    Serial.println(memoryAddress, HEX);
  }

  delay(5); // Required 5ms write cycle time for AT24C02
}

// --- Function to read back and verify the EEPROM ---
bool verifyEEPROM() {
  Serial.println("\n--- EEPROM Readback Verification ---");

  // 1. Set the EEPROM's internal memory pointer to address 0x00
  Wire.beginTransmission(EEPROM_ADDR);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) {
    Serial.println("Error: EEPROM not responding at 0x50 during verification!");
    return false;
  }

  // 2. Request 17 bytes from the EEPROM
  Wire.requestFrom(EEPROM_ADDR, (uint8_t)17);

  int i = 0;
  bool success = true;

  // 3. Read and compare the bytes against the original array
  while (Wire.available() && i < 17) {
    uint8_t readByte = Wire.read();

    Serial.print("Memory 0x");
    if (i < 16)
      Serial.print("0");
    Serial.print(i, HEX);

    Serial.print("  ->  Read: 0x");
    if (readByte < 16)
      Serial.print("0");
    Serial.print(readByte, HEX);

    if (readByte == usb2514b_config[i]) {
      Serial.println("  (Match)");
    } else {
      Serial.println("  (MISMATCH!)");
      success = false;
    }
    i++;
  }

  return (success && i == 17);
}

void setup() {
  Serial.begin(115200);

  // Initialize I2C with the specific pins
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  // Give the serial monitor a moment to connect after the board boots
  delay(2000);

  Serial.println("Starting EEPROM Flash...");

  // 1. Flash the configuration array
  for (uint8_t i = 0; i < sizeof(usb2514b_config); i++) {
    writeEEPROM(EEPROM_ADDR, i, usb2514b_config[i]);
  }

  // 2. Pad the rest of the relevant configuration space with 0x00
  // Note: Using uint16_t to prevent the 8-bit overflow!
  Serial.println("Padding remaining memory with 0x00...");
  for (uint16_t i = sizeof(usb2514b_config); i <= 0xFF; i++) {
    writeEEPROM(EEPROM_ADDR, i, 0x00);
  }

  Serial.println("EEPROM Flash Complete!");

  // 3. Run the verification sequence
  if (verifyEEPROM()) {
    Serial.println("\nVERIFICATION PASSED! The EEPROM is ready for the PCB.");
  } else {
    Serial.println("\nVERIFICATION FAILED. Check wiring or pull-up resistors.");
  }
}

void loop() {
  // Do nothing, process is complete
}