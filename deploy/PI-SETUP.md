# Joke Box — Raspberry Pi Setup

One-time setup to turn a fresh Raspberry Pi OS (Bookworm, with desktop)
install into the Joke Box appliance. Assumes the project lives at
`/home/pi/jokebox` (copy the whole `software/` folder there plus these
deploy files).

## 1. Copy the project & create the venv

```bash
# from your Mac (Pi reachable as raspberrypi.local):
scp -r ~/Documents/Jokebox/software ~/Documents/Jokebox/deploy pi@raspberrypi.local:/home/pi/jokebox/

# then on the Pi:
cd /home/pi/jokebox/software
python3 -m venv venv
./venv/bin/pip install flask requests gpiozero
```

## 2. Flip the production switches

- In `software/server.py`: set `DEV_MODE = False` (hides the simulate buttons).
- Confirm the fonts are self-hosted (`static/fonts/` exists and
  `style.css` uses `@font-face`, not a Google Fonts `@import`) — the bar
  bathroom will not have wifi.

## 3. Install the services

```bash
sudo cp /home/pi/jokebox/deploy/jokebox-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jokebox-server jokebox-gpio jokebox-display
```

Three services, all auto-restarting on crash:
- **jokebox-server** — the Flask app on port 5050
- **jokebox-gpio** — reads the real coin acceptor (GPIO 17) and PIR (GPIO 27)
- **jokebox-display** — cuts the physical backlight when the app sleeps

Check them with `systemctl status jokebox-server` etc.

## 4. Kiosk browser on boot

Raspberry Pi OS Bookworm (labwc/Wayland). Create the autostart entry:

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/jokebox-kiosk.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=Joke Box Kiosk
Exec=chromium-browser --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-infobars --check-for-update-interval=31536000 http://localhost:5050
EOF
```

The `--autoplay-policy=no-user-gesture-required` flag is REQUIRED — it
lets a coin insert play sound even if nobody has touched the screen yet
(browsers otherwise block audio until a first tap).

Also disable screen blanking so the app controls the display, not the OS:
`sudo raspi-config` → Display Options → Screen Blanking → Off.

## 5. Hardware checklist (bench-test before sealing the enclosure)

- Coin acceptor pulse on **GPIO 17** through the opto-isolator — drop 5
  quarters, expect 5 log lines from `journalctl -u jokebox-gpio -f`
- PIR output on **GPIO 27** through the 2-resistor divider — wave a hand,
  expect motion log lines
- Walk-up test: motion → screen wakes (backlight physically on) →
  12s later the barker makes his pitch → coin → menu with laugh
- Sleep test: leave it alone 20s → backlight physically OFF
  (`jokebox-display` journal shows "screen OFF")

## 6. Admin page

From any device on the same network: `http://<pi-address>:5050/admin` —
ratings leaderboard, play counts, quarters/earnings, volume and
free-play settings. Unauthenticated by design; keep the Pi off the
public internet.
