# Joke Box — 3D-Printed Enclosure

## What's here

- `enclosure.scad` — the parametric source model. Open this in [OpenSCAD](https://openscad.org) (free) if you ever want to tweak a measurement.
- `box.stl` — main enclosure body (holds the Pi, driver board, coin acceptor)
- `front.stl` — front bezel (screen window, coin slot, speaker grille, PIR motion sensor dome, "INSERT QUARTER")
- `mount.stl` — wall mount bracket (keyhole slots, screws to studs/anchors)
- `preview_assembled.png` — render for reference

All three STLs are verified watertight/manifold — they will slice and print without repair.

## Sizes (so you can check against your print service's bed limit)

| Part | Footprint | Height |
|---|---|---|
| box.stl | 222 × 209 mm | 55 mm |
| front.stl | 222 × 209 mm | 3.2 mm (flat) |
| mount.stl | 133 × 60 mm | 6 mm |

The box is right at the edge of a small hobby printer's bed (e.g. 220×220mm), so if you're using a print service, ask for something with at least a 250×250mm bed — very standard, not a special request.

## Print settings

- **Material: PETG, not PLA.** This lives above a urinal — heat/humidity in a bathroom will warp PLA over time. PETG (or ABS) holds up much better. If your print service asks, request PETG.
- Layer height: 0.2mm is fine, this isn't a precision part.
- Infill: 15–20%.
- Supports: **none needed** — `box.stl` prints open-face-up with no overhangs, `front.stl` is flat, `mount.stl` is flat.
- Orientation: print each part as-is (don't rotate) — that's already their best orientation.

## ⚠️ Before you actually print

The coin acceptor cutout (mounting bolt pattern, slot size) is based on typical CH-926/CH-923-style units, **but coin acceptors vary between sellers.** Once you've ordered the actual coin acceptor:

1. Measure its mounting-flange bolt spacing and the coin slot opening with calipers.
2. Tell me the numbers (or edit `coin_bolt_spacing_x`, `coin_bolt_spacing_y`, `coin_slot_w`, `coin_slot_h` near the top of `enclosure.scad` yourself).
3. Re-render before printing.

Printing before that check risks a mismatch you'd have to file/drill by hand. Everything else (screen cutout, speaker, box size) is built from the official Raspberry Pi 7" touchscreen's real dimensions, so that part is safe to print as-is.

## Assembly hardware you'll need

- 4× M3×12mm self-tapping screws — front panel into the box's corner bosses
- 2× M3×12mm self-tapping screws — wall mount bracket into the box's back pockets
- 2× wall screws (into studs) or 2× drywall anchors + screws — hanging the mount bracket
- The coin acceptor's own mounting bolts (usually included with the unit)

## If you want to change anything

Open `enclosure.scad` in OpenSCAD, edit a number in the **PARAMETERS** block at the top (every value is commented), then:
`File → Export → Export as STL`. Nothing below the "MODEL" divider needs to be touched.

## Power

For a proof-of-concept, battery power (rather than running a cord to a bathroom outlet) is the right call. Use **one battery, not two**:

- **A 5V/3A USB-C power bank (~20,000mAh)** powers the Pi and touchscreen directly over USB-C.
- **A small 5V→12V USB boost converter module (~$8)** runs off the *same* power bank and supplies the coin acceptor, which needs 12V. This keeps everything on a single battery your dad only has to charge one way.
- The motion sensor below is what makes this actually last a reasonable time on battery — the screen is the biggest power draw, and it's now off most of the time.

## Motion sensor (screen sleep/wake)

A PIR motion sensor (e.g. **HC-SR501**, ~$5) wakes the screen when someone walks up, and lets it go back to sleep (screen off) when no one's there — this is already built into the software (see `software/PREVIEW.md` and `software/gpio_listener.py`). The enclosure's front panel now has a **25mm clearance hole** (top-right, see `pir_dome_dia` in `enclosure.scad`) for the sensor's dome lens to see through — verify that number against your actual sensor's dome before printing, same caveat as the coin slot.

**Wiring note:** the HC-SR501's output pin can swing to 5V, but Raspberry Pi GPIO pins are only safe up to 3.3V. Unlike the coin acceptor (which needs a full opto-isolator because it also carries 12V power), the motion sensor is just a low-current logic signal — a simple 2-resistor voltage divider (e.g. 1kΩ + 2kΩ) between the sensor's OUT pin and the Pi's GPIO pin is enough to bring it down to a safe level. No extra board to buy.
