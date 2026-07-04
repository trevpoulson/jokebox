// ============================================================
// JOKE BOX — 3D-printable wall enclosure
// Parametric OpenSCAD model. Edit the numbers in the PARAMETERS
// block below, don't touch anything past "MODEL" unless you're
// comfortable with OpenSCAD.
//
// Prints as 3 separate parts (each fits a small print bed):
//   1) Main box (back shell) — holds Pi, driver board, coin acceptor
//   2) Front panel (bezel) — screen cutout, coin slot, speaker grille
//   3) Wall mount bracket — keyhole-slot plate, screws to studs
//
// Render one part at a time by setting PART below, then
// File > Export > Export as STL.
// ============================================================

// ---------- WHICH PART TO RENDER ----------
// "box"   = main enclosure body
// "front" = front bezel/panel
// "mount" = wall mount bracket
// "all"   = show everything assembled (for previewing only — do NOT print this)
PART = "all";

// ============================================================
// PARAMETERS — measure your actual parts and adjust these
// ============================================================

// --- Official Raspberry Pi 7" touchscreen ---
screen_w        = 194;   // panel width (mm)
screen_h        = 111;   // panel height (mm)
screen_thick    = 20;    // panel depth incl. standoffs (mm)
screen_bezel    = 8;     // how much front-panel lip overlaps the screen edge (mm)

// --- Box body ---
wall            = 3.2;       // wall thickness (mm) — 3-4 perimeters at 0.4mm nozzle
margin          = 14;        // extra space around screen inside the box (mm)
box_w           = screen_w + margin*2;             // ~222mm
box_h           = screen_h + margin*2 + 70;         // extra height at top for coin acceptor bay
box_depth       = 55;        // interior depth — fits screen + driver board + Pi + coin acceptor throat

// --- Coin acceptor (CH-926 / CH-923 style — VERIFY against your actual unit with calipers) ---
coin_acceptor_w      = 40;   // mounting face width (mm)
coin_acceptor_h       = 40;  // mounting face height (mm)
coin_slot_w      = 26;       // coin insertion slot width (mm)
coin_slot_h      = 4.5;      // coin insertion slot height — quarter is ~1.75mm thick, add clearance
coin_bolt_spacing_x = 32;    // horizontal distance between mounting bolt holes (mm)
coin_bolt_spacing_y = 32;    // vertical distance between mounting bolt holes (mm)
coin_bolt_dia    = 4.5;      // M4 clearance hole (mm)

// --- Speaker ---
speaker_dia      = 40;       // speaker diameter (mm)
speaker_hole_dia = 3;        // diameter of each grille hole (mm)
speaker_hole_gap = 6;        // spacing between grille holes (mm)

// --- PIR motion sensor (e.g. HC-SR501 — VERIFY dome diameter against your actual unit) ---
pir_dome_dia     = 25;       // clearance hole for the sensor's dome lens to see through (mm)

// --- Cable/ventilation ---
cable_hole_dia   = 14;       // pass-through for USB-C power + any wires

// --- Assembly ---
screw_boss_dia   = 8;        // diameter of screw bosses joining front panel to box (mm)
screw_hole_dia   = 3;        // self-tapping screw pilot hole (mm), e.g. M3 or #4 wood screw
corner_inset     = 10;       // how far in from each corner the assembly screws sit (mm)

// --- Wall mount (keyhole slots, screws into studs/anchors) ---
mount_w          = box_w * 0.6;
mount_h          = 60;
mount_thick      = 6;
keyhole_big_dia  = 9;    // screw head slides through here
keyhole_slot_dia = 4.5;  // screw shank rests here after sliding down
keyhole_slot_len = 14;

// Fixed print-bed-friendly resolution
$fn = 48;

// ============================================================
// MODEL — you shouldn't need to edit below this line
// ============================================================

module rounded_rect(w, h, r) {
    hull() {
        for (x = [r, w-r])
            for (y = [r, h-r])
                translate([x, y, 0]) circle(r=r);
    }
}

// ---------- MAIN BOX (back shell) ----------
module main_box() {
    difference() {
        union() {
            // outer shell
            linear_extrude(height=box_depth)
                rounded_rect(box_w, box_h, 10);

            // 4x screw bosses on the inside front lip, for attaching the front panel
            for (pos = [
                [corner_inset, corner_inset],
                [box_w-corner_inset, corner_inset],
                [corner_inset, box_h-corner_inset],
                [box_w-corner_inset, box_h-corner_inset]
            ]) {
                translate([pos[0], pos[1], 0])
                    cylinder(d=screw_boss_dia, h=box_depth);
            }
        }

        // hollow out interior, leaving wall thickness on sides/back
        translate([wall, wall, wall])
            linear_extrude(height=box_depth)
                rounded_rect(box_w-wall*2, box_h-wall*2, 7);

        // screw pilot holes down the screw bosses
        for (pos = [
            [corner_inset, corner_inset],
            [box_w-corner_inset, corner_inset],
            [corner_inset, box_h-corner_inset],
            [box_w-corner_inset, box_h-corner_inset]
        ]) {
            translate([pos[0], pos[1], -1])
                cylinder(d=screw_hole_dia, h=box_depth+2);
        }

        // cable pass-through, bottom-center of the back wall
        translate([box_w/2, wall+8, -1])
            rotate([0,0,0])
            translate([0,0,0])
            cylinder(d=cable_hole_dia, h=wall+2, $fn=32);

        // two keyhole-bracket screw pockets on the back wall (mates with wall mount bracket)
        for (x = [box_w*0.3, box_w*0.7]) {
            translate([x, box_h-20, -1])
                cylinder(d=screw_hole_dia+1, h=wall+2, $fn=24);
        }
    }
}

// ---------- FRONT PANEL / BEZEL ----------
module front_panel() {
    difference() {
        linear_extrude(height=wall)
            rounded_rect(box_w, box_h, 10);

        // screen cutout (leaves a bezel_lip overlap around the glass)
        translate([(box_w-screen_w)/2 + screen_bezel, (box_h-screen_h)/2 - 20, -1])
            linear_extrude(height=wall+2)
                square([screen_w - screen_bezel*2, screen_h - screen_bezel*2]);

        // coin slot, centered in the top bay
        translate([box_w/2 - coin_slot_w/2, box_h - 40, -1])
            linear_extrude(height=wall+2)
                rounded_rect(coin_slot_w, coin_slot_h, coin_slot_h/2);

        // "INSERT QUARTER" text above slot
        translate([box_w/2, box_h - 25, wall-0.6])
            linear_extrude(height=0.8)
                text("INSERT QUARTER", size=6, halign="center", font="Arial:style=Bold");

        // PIR motion sensor dome — top-right of the top bay, clear of the
        // coin slot/text and the corner screw boss
        translate([box_w - 30, box_h - 25, -1])
            cylinder(d=pir_dome_dia, h=wall+2, $fn=32);

        // speaker grille — hex-ish hole pattern, bottom-left of panel
        speaker_cx = margin + speaker_dia/2 + 4;
        speaker_cy = margin + speaker_dia/2 - 6;
        translate([speaker_cx, speaker_cy, -1]) {
            for (r = [0 : speaker_hole_gap : speaker_dia/2]) {
                n = max(6, floor(2*PI*r / speaker_hole_gap));
                for (a = [0 : 360/n : 359]) {
                    if (r > 0 || a == 0)
                        translate([r*cos(a), r*sin(a), 0])
                            cylinder(d=speaker_hole_dia, h=wall+2, $fn=12);
                }
            }
        }

        // 4x mounting screw clearance holes (align with box's screw bosses)
        for (pos = [
            [corner_inset, corner_inset],
            [box_w-corner_inset, corner_inset],
            [corner_inset, box_h-corner_inset],
            [box_w-corner_inset, box_h-corner_inset]
        ]) {
            translate([pos[0], pos[1], -1])
                cylinder(d=screw_hole_dia+0.8, h=wall+2, $fn=24);
        }
    }
}

// ---------- COIN ACCEPTOR MOUNTING BRACKET (prints as part of box top bay) ----------
// Sits inside the box, screen-side, behind the coin slot — holds the coin
// acceptor's mounting flange with its own bolt pattern.
module coin_bracket() {
    difference() {
        translate([box_w/2 - coin_acceptor_w/2 - 5, box_h - 55, wall])
            cube([coin_acceptor_w + 10, coin_acceptor_h + 10, wall]);

        translate([box_w/2 - coin_bolt_spacing_x/2, box_h - 55 + (coin_acceptor_h+10-coin_bolt_spacing_y)/2, wall-1])
            cylinder(d=coin_bolt_dia, h=wall+2, $fn=20);
        translate([box_w/2 + coin_bolt_spacing_x/2, box_h - 55 + (coin_acceptor_h+10-coin_bolt_spacing_y)/2, wall-1])
            cylinder(d=coin_bolt_dia, h=wall+2, $fn=20);
        translate([box_w/2 - coin_bolt_spacing_x/2, box_h - 55 + (coin_acceptor_h+10-coin_bolt_spacing_y)/2 + coin_bolt_spacing_y, wall-1])
            cylinder(d=coin_bolt_dia, h=wall+2, $fn=20);
        translate([box_w/2 + coin_bolt_spacing_x/2, box_h - 55 + (coin_acceptor_h+10-coin_bolt_spacing_y)/2 + coin_bolt_spacing_y, wall-1])
            cylinder(d=coin_bolt_dia, h=wall+2, $fn=20);
    }
}

// ---------- WALL MOUNT BRACKET ----------
module wall_mount() {
    difference() {
        linear_extrude(height=mount_thick)
            rounded_rect(mount_w, mount_h, 6);

        // two keyhole slots for hanging on wall screws (screw heads slide up into the narrow slot)
        for (x = [mount_w*0.25, mount_w*0.75]) {
            translate([x, mount_h*0.3, -1]) {
                cylinder(d=keyhole_big_dia, h=mount_thick+2, $fn=24);
                translate([-keyhole_slot_dia/2, 0, 0])
                    cube([keyhole_slot_dia, keyhole_slot_len, mount_thick+2]);
                translate([0, keyhole_slot_len, -0.001])
                    cylinder(d=keyhole_slot_dia, h=mount_thick+2, $fn=20);
            }
        }

        // two holes that align with the box's rear mounting pockets
        for (x = [mount_w*0.3/0.6*0.3 , mount_w - mount_w*0.3/0.6*0.3]) {
            // (kept simple: just two holes near top edge, hand-align with box pockets when installing)
        }
        translate([mount_w*0.3, mount_h - 15, -1])
            cylinder(d=screw_hole_dia+1, h=mount_thick+2, $fn=20);
        translate([mount_w*0.7, mount_h - 15, -1])
            cylinder(d=screw_hole_dia+1, h=mount_thick+2, $fn=20);
    }
}

// ============================================================
// RENDER SELECTION
// ============================================================
if (PART == "box") {
    union() {
        main_box();
        coin_bracket();
    }
} else if (PART == "front") {
    front_panel();
} else if (PART == "mount") {
    wall_mount();
} else if (PART == "all") {
    // preview only — parts shown separated for visual sanity check
    color("SteelBlue") union() { main_box(); coin_bracket(); }
    color("Orange", 0.85) translate([0, 0, box_depth]) front_panel();
    color("Gray") translate([box_w*0.2, -mount_h-10, 0]) wall_mount();
}
