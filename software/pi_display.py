"""
Raspberry Pi display-power helper — makes the app's "asleep" state real.

The kiosk UI's asleep screen is just a black web page; the backlight is
still burning power. This helper polls the server's /api/screen-state
(which the UI updates on every screen change) and switches the physical
display on/off to match.

NOT for Mac testing — runs on the Pi only, alongside server.py and
gpio_listener.py. Needs `pip install requests` (or the system package).

Display control strategy, first one that works wins:
  1. Official Pi touchscreen backlight (sysfs) — instant, saves the most
  2. `wlr-randr` output toggle (Wayland/labwc, Pi OS Bookworm default)
  3. `vcgencmd display_power` (legacy/X11 setups)
Run it once by hand and check the log line to see which path it picked.
"""
import glob
import subprocess
import time

import requests

SERVER_URL = "http://localhost:5050"
POLL_INTERVAL_S = 2.0

_backlight_paths = glob.glob("/sys/class/backlight/*/bl_power")


def set_display(on: bool) -> str:
    if _backlight_paths:
        try:
            with open(_backlight_paths[0], "w") as f:
                f.write("0" if on else "1")  # 0 = unblank, 1 = blank
            return f"backlight {_backlight_paths[0]}"
        except OSError:
            pass
    for cmd in (
        ["wlr-randr", "--output", "HDMI-A-1", "--on" if on else "--off"],
        ["vcgencmd", "display_power", "1" if on else "0"],
    ):
        try:
            if subprocess.run(cmd, capture_output=True).returncode == 0:
                return " ".join(cmd[:1])
        except FileNotFoundError:
            continue
    return "no display control method worked"


def main():
    last_asleep = None
    print(f"[pi_display] polling {SERVER_URL}/api/screen-state every {POLL_INTERVAL_S}s")
    while True:
        try:
            asleep = requests.get(f"{SERVER_URL}/api/screen-state", timeout=2).json().get("asleep", False)
            if asleep != last_asleep:
                method = set_display(not asleep)
                print(f"[pi_display] screen {'OFF' if asleep else 'ON'} via {method}")
                last_asleep = asleep
        except requests.RequestException:
            pass  # server restarting; keep polling
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
