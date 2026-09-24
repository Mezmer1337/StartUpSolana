//! Palette generation — port of backend/src/services/colorService.ts.

use serde::Serialize;

use crate::catalog::Harmony;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Palette {
    pub base_hue: u32,
    pub harmony: Harmony,
    pub primary: String,
    pub secondary: String,
    pub pattern_color: String,
    pub accent: String,
    pub outline: String,
}

/// HSV-style color to "#rrggbb", same math as hslToHex() in colorService.ts.
fn hsl_to_hex(h: f64, s: f64, v: f64) -> String {
    // `%` on f64 is a truncated remainder in both Rust and JS.
    let h = ((h % 360.0) + 360.0) % 360.0;
    let c = (v / 100.0) * (s / 100.0);
    let x = c * (1.0 - (((h / 60.0) % 2.0) - 1.0).abs());
    let m = v / 100.0 - c;
    let (r, g, b) = if h < 60.0 {
        (c, x, 0.0)
    } else if h < 120.0 {
        (x, c, 0.0)
    } else if h < 180.0 {
        (0.0, c, x)
    } else if h < 240.0 {
        (0.0, x, c)
    } else if h < 300.0 {
        (x, 0.0, c)
    } else {
        (c, 0.0, x)
    };
    // Channels are always >= 0 here, where Rust's round() (half away from
    // zero) and JS Math.round() (half toward +inf) agree.
    let to_hex = |n: f64| format!("{:02x}", ((n + m) * 255.0).round() as u8);
    format!("#{}{}{}", to_hex(r), to_hex(g), to_hex(b))
}

fn darken(h: f64, s: f64, v: f64) -> String {
    hsl_to_hex(h, (s + 10.0).min(100.0), (v - 30.0).max(10.0))
}

pub fn generate_palette(base_hue: u32, harmony: Harmony, saturation: f64, value: f64) -> Palette {
    let hue = f64::from(base_hue);
    let (secondary_hue, accent_hue) = match harmony {
        Harmony::Complementary => (hue + 180.0, hue + 150.0),
        Harmony::Triadic => (hue + 120.0, hue + 240.0),
        Harmony::SplitComplementary => (hue + 150.0, hue + 210.0),
        Harmony::Analogous => (hue + 30.0, hue - 30.0),
    };

    Palette {
        base_hue,
        harmony,
        primary: hsl_to_hex(hue, saturation, value),
        secondary: hsl_to_hex(secondary_hue, saturation, value),
        pattern_color: hsl_to_hex(secondary_hue, (saturation - 15.0).max(20.0), (value + 10.0).min(95.0)),
        accent: hsl_to_hex(accent_hue, (saturation + 10.0).min(100.0), value),
        outline: darken(hue, saturation, value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_valid_hex_colors() {
        for harmony in Harmony::ALL {
            let p = generate_palette(200, harmony, 60.0, 70.0);
            for color in [&p.primary, &p.secondary, &p.pattern_color, &p.accent, &p.outline] {
                assert_eq!(color.len(), 7);
                assert!(color.starts_with('#'));
                assert!(color[1..].bytes().all(|b| b.is_ascii_hexdigit()));
            }
        }
    }

    #[test]
    fn wraps_negative_hues() {
        // analogous accent = base - 30 -> -30 must wrap to 330
        assert_eq!(hsl_to_hex(-30.0, 50.0, 50.0), hsl_to_hex(330.0, 50.0, 50.0));
    }
}
