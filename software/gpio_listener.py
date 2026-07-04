"""
Raspberry Pi GPIO listener — bridges the real coin acceptor and PIR
motion sensor to the same two endpoints the Mac dev buttons use
(POST /api/coin-insert and POST /api/motion-detected). The kiosk UI
itself doesn't know or care whether an event came from a browser
button or a real sensor.

NOT for Mac testing — this only runs on the Pi, alongside server.py,
once the hardware is wired up. Needs `pip install gpiozero requests`
on the Pi (gpiozero ships with Raspberry Pi OS by default).

Wiring assumed (see ~/Documents/Jokebox/README.md for the full plan):
  - Coin acceptor pulse output -> through the opto-isolator breakout -> GPIO 17
  - PIR motion sensor OUT      -> through a 2-resistor divider      -> GPIO 27

Run alongside the server, e.g. with two systemd services, or simply:
    ./venv/bin/python server.py &
    ./venv/bin/python gpio_listener.py &
"""
import time

import requests
from gpiozero import Button

SERVER_URL = "http://localhost:5050"

COIN_PIN = 17
MOTION_PIN = 27

# Coin acceptors pulse briefly per accepted coin; debounce so one coin
# doesn't register as several rapid pulses.
COIN_DEBOUNCE_S = 0.3
# PIR sensors hold their output HIGH for several seconds per trigger;
# re-notify periodically rather than spamming every reading.
MOTION_RENOTIFY_S = 5.0

coin_sensor = Button(COIN_PIN, pull_up=True, bounce_time=COIN_DEBOUNCE_S)
motion_sensor = Button(MOTION_PIN, pull_up=False)

_last_motion_notify = 0.0


def notify(endpoint):
    try:
        requests.post(f"{SERVER_URL}/api/{endpoint}", timeout=2)
    except requests.RequestException as e:
        print(f"[gpio_listener] failed to notify {endpoint}: {e}")


def on_coin():
    print("[gpio_listener] coin detected")
    notify("coin-insert")


def on_motion():
    global _last_motion_notify
    now = time.monotonic()
    if now - _last_motion_notify < MOTION_RENOTIFY_S:
        return
    _last_motion_notify = now
    print("[gpio_listener] motion detected")
    notify("motion-detected")


coin_sensor.when_pressed = on_coin
motion_sensor.when_pressed = on_motion

print(f"[gpio_listener] watching GPIO{COIN_PIN} (coin) and GPIO{MOTION_PIN} (motion)...")
try:
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    pass
