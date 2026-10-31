import { z } from "zod";

export const colourLabels = {
  accent: "Accent",
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  maintenance: "Maintenance",
};
export type Colour = keyof typeof colourLabels;
export type Appearance = Record<Colour, string> & { mode: "light" | "dark" };

export const surfaces = {
  light: {
    canvas: "#f5f6f8",
    surface: "#ffffff",
    soft: "#eef1f5",
    text: "#202a38",
    muted: "#566273",
    line: "#dce1e8",
    control: "#8591a3",
  },
  dark: {
    canvas: "#10151e",
    surface: "#19212e",
    soft: "#222d3d",
    text: "#edf2f7",
    muted: "#b6c0cf",
    line: "#38485e",
    control: "#8190a6",
  },
};
export const presets: { name: string; appearance: Appearance }[] = [
  {
    name: "Slate",
    appearance: {
      mode: "light",
      accent: "#3454b4",
      operational: "#176347",
      degraded: "#875208",
      outage: "#b42335",
      maintenance: "#315da3",
    },
  },
  {
    name: "Forest",
    appearance: {
      mode: "light",
      accent: "#25634f",
      operational: "#25634f",
      degraded: "#875208",
      outage: "#aa3646",
      maintenance: "#6550a1",
    },
  },
  {
    name: "Midnight",
    appearance: {
      mode: "dark",
      accent: "#a6bcff",
      operational: "#79d4ac",
      degraded: "#edc275",
      outage: "#ff9da8",
      maintenance: "#b7a8ff",
    },
  },
];
export const defaultAppearance = presets[2].appearance;
export const hexColour = /^#[0-9a-f]{6}$/i;

export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((i) => {
      const value = parseInt(hex.slice(i, i + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const colourSchema = z
  .string()
  .regex(hexColour, "Use a six-digit hex colour, such as #3454b4.");
export const appearanceSchema = z
  .object({
    mode: z.enum(["light", "dark"]),
    accent: colourSchema,
    operational: colourSchema,
    degraded: colourSchema,
    outage: colourSchema,
    maintenance: colourSchema,
  })
  .superRefine((value, ctx) => {
    const { canvas, surface, soft } = surfaces[value.mode];
    for (const key of Object.keys(colourLabels) as Colour[]) {
      if (
        hexColour.test(value[key]) &&
        [canvas, surface, soft].some(
          (background) => contrast(value[key], background) < 4.5,
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${colourLabels[key]} needs more contrast. Choose a ${value.mode === "light" ? "darker" : "lighter"} colour.`,
        });
      }
    }
  });

export function appearanceStyle(value: Appearance): Record<string, string> {
  const colours = Object.fromEntries(
    (Object.keys(colourLabels) as Colour[]).map((key) => [
      key,
      hexColour.test(value[key]) ? value[key] : defaultAppearance[key],
    ]),
  );
  return {
    ...Object.fromEntries(
      Object.entries({ ...surfaces[value.mode], ...colours }).map(
        ([key, colour]) => [`--${key}`, colour],
      ),
    ),
    "--on-accent":
      contrast(colours.accent, "#ffffff") >= contrast(colours.accent, "#10151e")
        ? "#ffffff"
        : "#10151e",
    colorScheme: value.mode,
  };
}
