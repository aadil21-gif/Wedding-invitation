/*
 * SeeFar robot body: ESP32 firmware (Arduino IDE, "esp32 by Espressif" board package 3.x).
 *
 * The PHONE is the brain (voice, camera, AI). This ESP32 is the body:
 * motors, distance / edge / touch / tilt sensors, a face screen and LEDs.
 * They talk over Bluetooth LE using the Nordic UART UUIDs, short ASCII lines.
 *
 *   phone -> robot   M,<left>,<right>   drive, each -100..100 (repeat every <600 ms)
 *                    S                  stop
 *                    F,<0-7>            face: neutral happy excited curious sad surprised sleepy love
 *                    L,<r>,<g>,<b>      LED colour
 *                    B,<1-4>            buzzer: 1 beep, 2 chirp, 3 sad, 4 alert
 *                    X,<20-100>         speed limit in percent
 *   robot -> phone   T,<cm>,<cliff>,<lifted>,<light>,<battery%>,<touch>   every 300 ms
 *                    E,near | E,cliff | E,lift | E,touch                   on events
 *
 * SAFETY (these run on the robot itself, even if the phone app misbehaves):
 *   - Motors stop if no drive command arrives for 600 ms (also on Bluetooth disconnect).
 *   - Forward motion stops when something is closer than STOP_CM.
 *   - Forward motion stops and is blocked when an edge (cliff) sensor sees no floor.
 *   - Motors cut when the robot is lifted or tipped.
 *   - Speed is capped (default 50 %, never above the app's limit).
 *
 * NOT YET TESTED ON HARDWARE. Do the bring-up steps in robot/README.md in order.
 * Libraries (Library Manager): Adafruit SSD1306, Adafruit GFX, Adafruit NeoPixel.
 */

#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#if __has_include(<BLE2902.h>)
#include <BLE2902.h>
#define HAVE_BLE2902 1
#endif
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>

// ------------------------------------------------------------------ pins
// L298N motor driver (remove the ENA/ENB jumpers so PWM from the ESP32 controls speed)
const int PIN_ENA = 25, PIN_IN1 = 26, PIN_IN2 = 27;   // left motor
const int PIN_ENB = 33, PIN_IN3 = 32, PIN_IN4 = 13;   // right motor
// HC-SR04 ultrasonic. ECHO is 5 V: use the 1k + 2k resistor divider to the ESP32 pin.
const int PIN_TRIG = 18, PIN_ECHO = 19;
// Edge (cliff) sensors, digital output modules pointed at the floor, input-only pins
const int PIN_CLIFF_L = 34, PIN_CLIFF_R = 35;
const bool CLIFF_ACTIVE_HIGH = true;  // most IR modules output HIGH when they see NO surface; flip if yours is the opposite
const int PIN_TOUCH = 4;              // TTP223 touch pad on top of the head
const int PIN_BUZZER = 17;            // active buzzer
const int PIN_LED = 23;               // WS2812 LED strip/ring data
const int NUM_LEDS = 8;
const int PIN_LDR = 36;               // light sensor divider (optional)
const int PIN_BATT = 39;              // battery divider 100k + 100k (optional)
// I2C (OLED 0x3C and MPU6050 0x68 share it): SDA 21, SCL 22

// ------------------------------------------------------------------ tuning
const int STOP_CM = 18;
const unsigned long WATCHDOG_MS = 600;
const unsigned long TELEMETRY_MS = 300;
const int MOTOR_MIN_PWM = 110;        // TT motors stall below this
const char* DEVICE_NAME = "SeeFar-Bot";

// ------------------------------------------------------------------ BLE
static BLEUUID SERVICE_UUID("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
static BLEUUID RX_UUID("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
static BLEUUID TX_UUID("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
BLECharacteristic* txChar = nullptr;
volatile bool bleConnected = false;
volatile bool disconnectedFlag = false;

// ------------------------------------------------------------------ state
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Adafruit_NeoPixel strip(NUM_LEDS, PIN_LED, NEO_GRB + NEO_KHZ800);
bool haveOled = false, haveMpu = false;

int speedCap = 50;
int cmdLeft = 0, cmdRight = 0;
unsigned long lastDriveCmd = 0;
int faceIdx = 0;
uint32_t ledColor = 0;
bool ledOverride = false;

int distanceCm = 999;
bool cliffNow = false, liftedNow = false, touchNow = false, touchPrev = false;
unsigned long liftedSince = 0, levelSince = 0;
unsigned long lastEvent[4] = {0, 0, 0, 0};  // near, cliff, lift, touch
unsigned long lastTelemetry = 0, lastPing = 0, lastFace = 0, lastDist = 0, lastImu = 0;

// buzzer sequencer
const int MAX_STEPS = 8;
int buzzOn[MAX_STEPS], buzzOff[MAX_STEPS], buzzCount = 0, buzzIdx = 0;
unsigned long buzzNext = 0;
bool buzzState = false;

// ------------------------------------------------------------------ motors
void pwmSetup(int pin) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(pin, 1000, 8);
#else
  static int ch = 0;
  ledcSetup(ch, 1000, 8);
  ledcAttachPin(pin, ch);
  ch++;
#endif
}

void pwmWrite(int pin, int duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, duty);
#else
  // core 2.x: channels were assigned in setup order (ENA = 0, ENB = 1)
  ledcWrite(pin == PIN_ENA ? 0 : 1, duty);
#endif
}

void setMotor(int enPin, int inA, int inB, int speed) {
  speed = constrain(speed, -100, 100);
  if (speed == 0) {
    digitalWrite(inA, LOW);
    digitalWrite(inB, LOW);
    pwmWrite(enPin, 0);
    return;
  }
  int scaled = abs(speed) * speedCap / 100;  // apply the speed limit
  if (scaled < 1) scaled = 1;
  int duty = map(scaled, 1, 100, MOTOR_MIN_PWM, 255);
  digitalWrite(inA, speed > 0 ? HIGH : LOW);
  digitalWrite(inB, speed > 0 ? LOW : HIGH);
  pwmWrite(enPin, duty);
}

void stopMotors() {
  cmdLeft = cmdRight = 0;
  setMotor(PIN_ENA, PIN_IN1, PIN_IN2, 0);
  setMotor(PIN_ENB, PIN_IN3, PIN_IN4, 0);
}

void applyDrive() {
  int l = cmdLeft, r = cmdRight;
  bool forward = (l + r) > 0;
  // Safety interlocks are re-checked on every call, not just when a command arrives.
  if (liftedNow) l = r = 0;
  if (forward && (cliffNow || distanceCm < STOP_CM)) l = r = 0;
  setMotor(PIN_ENA, PIN_IN1, PIN_IN2, l);
  setMotor(PIN_ENB, PIN_IN3, PIN_IN4, r);
}

// ------------------------------------------------------------------ events and BLE out
void sendLine(const char* s) {
  if (!bleConnected || !txChar) return;
  txChar->setValue((uint8_t*)s, strlen(s));
  txChar->notify();
}

void sendEvent(int idx, const char* name) {
  unsigned long now = millis();
  if (now - lastEvent[idx] < 2500) return;
  lastEvent[idx] = now;
  char buf[16];
  snprintf(buf, sizeof(buf), "E,%s\n", name);
  sendLine(buf);
}

// ------------------------------------------------------------------ buzzer
void buzzStart(const int* on, const int* off, int n) {
  buzzCount = min(n, MAX_STEPS);
  for (int i = 0; i < buzzCount; i++) {
    buzzOn[i] = on[i];
    buzzOff[i] = off[i];
  }
  buzzIdx = 0;
  buzzState = true;
  digitalWrite(PIN_BUZZER, HIGH);
  buzzNext = millis() + buzzOn[0];
}

void buzzPattern(int p) {
  static const int a1[] = {120}, b1[] = {0};
  static const int a2[] = {50, 50, 90}, b2[] = {40, 40, 0};
  static const int a3[] = {200, 260}, b3[] = {80, 0};
  static const int a4[] = {90, 90, 90, 90}, b4[] = {70, 70, 70, 0};
  if (p == 1) buzzStart(a1, b1, 1);
  else if (p == 2) buzzStart(a2, b2, 3);
  else if (p == 3) buzzStart(a3, b3, 2);
  else if (p == 4) buzzStart(a4, b4, 4);
}

void buzzUpdate() {
  if (buzzCount == 0) return;
  unsigned long now = millis();
  if (now < buzzNext) return;
  if (buzzState) {
    digitalWrite(PIN_BUZZER, LOW);
    buzzState = false;
    buzzNext = now + buzzOff[buzzIdx];
    if (buzzOff[buzzIdx] == 0) {  // last step has no pause: finish
      buzzCount = 0;
    }
  } else {
    buzzIdx++;
    if (buzzIdx >= buzzCount) {
      buzzCount = 0;
      return;
    }
    digitalWrite(PIN_BUZZER, HIGH);
    buzzState = true;
    buzzNext = now + buzzOn[buzzIdx];
  }
}

// ------------------------------------------------------------------ LEDs
uint32_t moodColor(int f) {
  switch (f) {
    case 1: return strip.Color(0, 160, 60);     // happy: green
    case 2: return strip.Color(255, 120, 0);    // excited: orange
    case 3: return strip.Color(0, 120, 255);    // curious: blue
    case 4: return strip.Color(40, 40, 160);    // sad: dim blue
    case 5: return strip.Color(255, 255, 255);  // surprised: white
    case 6: return strip.Color(20, 10, 40);     // sleepy: dim purple
    case 7: return strip.Color(255, 30, 120);   // love: pink
    default: return strip.Color(0, 160, 200);   // neutral: cyan
  }
}

void ledUpdate() {
  uint32_t base = ledOverride ? ledColor : moodColor(faceIdx);
  // gentle breathing
  float k = 0.35f + 0.65f * (0.5f + 0.5f * sinf(millis() / 600.0f));
  uint8_t r = ((base >> 16) & 0xFF) * k, g = ((base >> 8) & 0xFF) * k, b = (base & 0xFF) * k;
  for (int i = 0; i < NUM_LEDS; i++) strip.setPixelColor(i, strip.Color(r, g, b));
  strip.show();
}

// ------------------------------------------------------------------ face (OLED 128x64)
void drawFace(int f, bool blink) {
  if (!haveOled) return;
  oled.clearDisplay();
  const int ex1 = 38, ex2 = 90, ey = 24;
  if (!bleConnected) {
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(2);
    oled.setCursor(14, 6);
    oled.print("SeeFar");
    oled.setTextSize(1);
    oled.setCursor(10, 34);
    oled.print("Open the app and");
    oled.setCursor(10, 46);
    oled.print("tap Connect");
    oled.display();
    return;
  }
  int h = blink ? 3 : 24;
  switch (f) {
    case 1:  // happy ^ ^
      for (int d = 0; d < 3; d++) {
        oled.drawLine(ex1 - 14, ey + 6 + d, ex1, ey - 8 + d, SSD1306_WHITE);
        oled.drawLine(ex1, ey - 8 + d, ex1 + 14, ey + 6 + d, SSD1306_WHITE);
        oled.drawLine(ex2 - 14, ey + 6 + d, ex2, ey - 8 + d, SSD1306_WHITE);
        oled.drawLine(ex2, ey - 8 + d, ex2 + 14, ey + 6 + d, SSD1306_WHITE);
      }
      break;
    case 2:  // excited: big eyes
      oled.fillRoundRect(ex1 - 14, ey - 16, 28, blink ? 4 : 32, 8, SSD1306_WHITE);
      oled.fillRoundRect(ex2 - 14, ey - 16, 28, blink ? 4 : 32, 8, SSD1306_WHITE);
      break;
    case 3:  // curious: one bigger
      oled.fillRoundRect(ex1 - 10, ey - 8, 20, blink ? 3 : 16, 6, SSD1306_WHITE);
      oled.fillRoundRect(ex2 - 15, ey - 16, 30, blink ? 4 : 32, 8, SSD1306_WHITE);
      break;
    case 4:  // sad
      oled.fillRoundRect(ex1 - 12, ey - 8, 24, blink ? 3 : 18, 6, SSD1306_WHITE);
      oled.fillRoundRect(ex2 - 12, ey - 8, 24, blink ? 3 : 18, 6, SSD1306_WHITE);
      oled.drawLine(ex1 - 14, ey - 14, ex1 + 10, ey - 8, SSD1306_WHITE);
      oled.drawLine(ex2 + 14, ey - 14, ex2 - 10, ey - 8, SSD1306_WHITE);
      break;
    case 5:  // surprised: ring eyes
      oled.drawCircle(ex1, ey, 14, SSD1306_WHITE);
      oled.drawCircle(ex2, ey, 14, SSD1306_WHITE);
      oled.fillCircle(ex1, ey, 4, SSD1306_WHITE);
      oled.fillCircle(ex2, ey, 4, SSD1306_WHITE);
      break;
    case 6:  // sleepy: lines
      oled.fillRect(ex1 - 12, ey, 24, 3, SSD1306_WHITE);
      oled.fillRect(ex2 - 12, ey, 24, 3, SSD1306_WHITE);
      break;
    case 7:  // love: simple hearts from two circles and a triangle
      for (int i = 0; i < 2; i++) {
        int cx = i ? ex2 : ex1;
        oled.fillCircle(cx - 5, ey - 4, 6, SSD1306_WHITE);
        oled.fillCircle(cx + 5, ey - 4, 6, SSD1306_WHITE);
        oled.fillTriangle(cx - 11, ey - 1, cx + 11, ey - 1, cx, ey + 12, SSD1306_WHITE);
      }
      break;
    default:  // neutral
      oled.fillRoundRect(ex1 - 12, ey - h / 2, 24, h, 6, SSD1306_WHITE);
      oled.fillRoundRect(ex2 - 12, ey - h / 2, 24, h, 6, SSD1306_WHITE);
  }
  // mouth
  if (f == 1 || f == 2 || f == 7) {
    oled.drawCircleHelper(64, 44, 14, 0x0C, SSD1306_WHITE);  // lower half of a circle: a smile
  } else if (f == 4) {
    oled.drawCircleHelper(64, 60, 12, 0x03, SSD1306_WHITE);  // upper half: a frown
  } else if (f == 5) {
    oled.drawCircle(64, 52, 6, SSD1306_WHITE);
  } else {
    oled.drawFastHLine(54, 52, 20, SSD1306_WHITE);
  }
  oled.display();
}

// ------------------------------------------------------------------ sensors
int readDistanceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 15000);  // ~2.5 m max, short timeout keeps the loop fast
  if (us == 0) return 999;
  return (int)(us / 58);
}

bool readCliff() {
  bool l = digitalRead(PIN_CLIFF_L), r = digitalRead(PIN_CLIFF_R);
  return CLIFF_ACTIVE_HIGH ? (l || r) : (!l || !r);
}

bool readMpu(float& ax, float& ay, float& az) {
  Wire.beginTransmission(0x68);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(0x68, 6) != 6) return false;
  int16_t x = (Wire.read() << 8) | Wire.read();
  int16_t y = (Wire.read() << 8) | Wire.read();
  int16_t z = (Wire.read() << 8) | Wire.read();
  ax = x / 16384.0f;  // +-2 g range: 16384 LSB per g
  ay = y / 16384.0f;
  az = z / 16384.0f;
  return true;
}

void updateLifted() {
  if (!haveMpu) return;
  float ax, ay, az;
  if (!readMpu(ax, ay, az)) return;
  float mag = sqrtf(ax * ax + ay * ay + az * az);
  bool tipped = fabsf(ax) > 0.6f || fabsf(ay) > 0.6f || az < 0.5f;  // tilted more than ~35 degrees
  bool shaken = fabsf(mag - 1.0f) > 0.35f;                         // picked up, bumped or dropped
  unsigned long now = millis();
  if (tipped || shaken) {
    levelSince = 0;
    if (liftedSince == 0) liftedSince = now;
    if (!liftedNow && now - liftedSince > 150) {
      liftedNow = true;
      stopMotors();
      sendEvent(2, "lift");
    }
  } else {
    liftedSince = 0;
    if (liftedNow) {
      if (levelSince == 0) levelSince = now;
      if (now - levelSince > 1000) liftedNow = false;  // flat and still for 1 s: allow driving again
    }
  }
}

int batteryPercent() {
  // 4 x AA NiMH: about 5.6 V full, 4.0 V empty. Divider halves it. Rough: calibrate with a multimeter.
  float v = analogRead(PIN_BATT) / 4095.0f * 3.3f * 2.0f;
  int pct = (int)((v - 4.0f) / (5.6f - 4.0f) * 100.0f);
  return constrain(pct, 0, 100);
}

// ------------------------------------------------------------------ commands
void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) return;
  char c = line.charAt(0);
  int v[3] = {0, 0, 0};
  int n = 0;
  int from = line.indexOf(',');
  while (from >= 0 && n < 3) {
    int to = line.indexOf(',', from + 1);
    String part = (to < 0) ? line.substring(from + 1) : line.substring(from + 1, to);
    v[n++] = part.toInt();
    from = to;
  }
  switch (c) {
    case 'M':
      cmdLeft = constrain(v[0], -100, 100);
      cmdRight = constrain(v[1], -100, 100);
      lastDriveCmd = millis();
      applyDrive();
      break;
    case 'S':
      stopMotors();
      break;
    case 'F':
      faceIdx = constrain(v[0], 0, 7);
      ledOverride = false;
      break;
    case 'L':
      ledColor = strip.Color(constrain(v[0], 0, 255), constrain(v[1], 0, 255), constrain(v[2], 0, 255));
      ledOverride = true;
      break;
    case 'B':
      buzzPattern(v[0]);
      break;
    case 'X':
      speedCap = constrain(v[0], 20, 100);
      break;
    case 'P':
      sendLine("P\n");
      break;
  }
}

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    auto value = c->getValue();
    handleCommand(String(value.c_str()));
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer*) override {
    bleConnected = false;
    disconnectedFlag = true;
  }
};

// ------------------------------------------------------------------ setup / loop
void setup() {
  Serial.begin(115200);

  pinMode(PIN_IN1, OUTPUT); pinMode(PIN_IN2, OUTPUT);
  pinMode(PIN_IN3, OUTPUT); pinMode(PIN_IN4, OUTPUT);
  pwmSetup(PIN_ENA);  // keep this order: ENA first, then ENB (core 2.x channels)
  pwmSetup(PIN_ENB);
  stopMotors();

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_CLIFF_L, INPUT);
  pinMode(PIN_CLIFF_R, INPUT);
  pinMode(PIN_TOUCH, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  strip.begin();
  strip.setBrightness(60);  // keep it gentle on the eyes and the battery
  strip.show();

  Wire.begin(21, 22);
  haveOled = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  Wire.beginTransmission(0x68);
  Wire.write(0x6B);
  Wire.write(0);  // wake the MPU6050
  haveMpu = (Wire.endTransmission() == 0);
  Serial.printf("OLED: %s, MPU6050: %s\n", haveOled ? "ok" : "missing", haveMpu ? "ok" : "missing");

  BLEDevice::init(DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* service = server->createService(SERVICE_UUID);
  txChar = service->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
#ifdef HAVE_BLE2902
  txChar->addDescriptor(new BLE2902());
#endif
  BLECharacteristic* rxChar = service->createCharacteristic(
      RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rxChar->setCallbacks(new RxCallbacks());
  service->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  drawFace(0, false);
  int on[] = {60, 60, 90}, off[] = {50, 50, 0};
  buzzStart(on, off, 3);  // power-on chirp
}

void loop() {
  unsigned long now = millis();

  // Bluetooth dropped: stop at once and start advertising again.
  if (disconnectedFlag) {
    disconnectedFlag = false;
    stopMotors();
    delay(300);
    BLEDevice::startAdvertising();
  }

  // Watchdog: no drive command lately means stop.
  if ((cmdLeft != 0 || cmdRight != 0) && now - lastDriveCmd > WATCHDOG_MS) stopMotors();

  if (now - lastDist > 100) {
    lastDist = now;
    distanceCm = readDistanceCm();
    bool wasCliff = cliffNow;
    cliffNow = readCliff();
    bool forward = (cmdLeft + cmdRight) > 0;
    if (forward && distanceCm < STOP_CM) sendEvent(0, "near");
    if (cliffNow && !wasCliff) sendEvent(1, "cliff");
    applyDrive();  // interlocks apply even with no new command
  }

  if (now - lastImu > 50) {
    lastImu = now;
    updateLifted();
  }

  touchNow = digitalRead(PIN_TOUCH) == HIGH;
  if (touchNow && !touchPrev) sendEvent(3, "touch");
  touchPrev = touchNow;

  if (now - lastTelemetry > TELEMETRY_MS) {
    lastTelemetry = now;
    // Kept at 20 bytes or less so it fits one default-size BLE notification.
    char buf[24];
    snprintf(buf, sizeof(buf), "T,%d,%d,%d,%d,%d,%d\n", min(distanceCm, 400), cliffNow ? 1 : 0, liftedNow ? 1 : 0,
             analogRead(PIN_LDR) / 16, batteryPercent(), touchNow ? 1 : 0);
    sendLine(buf);
  }

  if (now - lastFace > 120) {
    lastFace = now;
    static unsigned long nextBlink = 3000, blinkEnd = 0;
    if (now > nextBlink) {
      blinkEnd = now + 140;
      nextBlink = now + 2500 + (esp_random() % 3500);
    }
    drawFace(bleConnected ? faceIdx : 0, now < blinkEnd);
    ledUpdate();
  }

  buzzUpdate();
}
