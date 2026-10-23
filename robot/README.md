# SeeFar robot

Phone = head (mic, speaker, camera, AI). ESP32 = body (motors, sensors, OLED face, LEDs). They talk over Bluetooth LE (Nordic UART) using Web Bluetooth in Chrome on Android.

Full parts list, wiring, power and test order: the "SeeFar Robot Build Guide" document. PKR prices there are rough, unverified estimates.

## Protocol (text lines, newline-terminated)

To robot: `M,l,r` (-100..100) · `S` stop · `F,0-7` face · `L,r,g,b` · `B,1-4` beep · `X,cap` speed cap · `P` ping
From robot: `T,cm,cliff,lifted,light,batt,touch` · `E,near|cliff|lift|touch`

## Safety in firmware

600 ms command watchdog, forward stop under 18 cm, edge block, lift/tilt cut, speed cap (default 50%).

## Pins

ENA 25, IN1 26, IN2 27, ENB 33, IN3 32, IN4 13 · TRIG 18, ECHO 19 (1k+2k divider) · edge L34 R35 · touch 4 · buzzer 17 · LED 23 · LDR 36 · battery 39 · I2C SDA 21 SCL 22

Remove the ENA/ENB jumpers on the L298N. Libraries: Adafruit SSD1306, Adafruit GFX, Adafruit NeoPixel.

## Status

Firmware is untested on hardware (syntax-checked against mock headers only). Not a certified toy: supervise with children. If edge sensors act inverted, flip `CLIFF_ACTIVE_HIGH`.
