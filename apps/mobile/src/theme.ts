// CPF-branded field ops UI — Uber-clean layout with Wierdabrug logo colours.
export const colors = {
  // Logo: royal blue, red, yellow, forest green
  primary: "#0B3D8C",
  primarySoft: "#E8F0FA",
  primaryInk: "#0B1220",
  accent: "#F5C518",
  danger: "#E30613",
  dangerSoft: "#FDE8EA",
  info: "#0B3D8C",
  infoSoft: "#E8F0FA",
  warning: "#F5C518",
  warningSoft: "#FFF8DB",
  success: "#1E7A3A",
  successSoft: "#E8F5EC",
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceMuted: "#F3F6FB",
  text: "#0B1220",
  textMuted: "#5B6B85",
  /** Visible edge on gray cards / fields (was too light on white). */
  border: "#8A9BB5",
  borderSoft: "#D7E0EE",
  // Back-compat
  cardBg: "#F3F6FB",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const radii = { sm: 8, md: 12, lg: 16, xl: 28 };

/** Shared chrome for light-gray cards / search bars / type tiles that sit on white. */
export const mutedCard = {
  backgroundColor: colors.surfaceMuted,
  borderWidth: 1.5,
  borderColor: colors.border,
  borderRadius: radii.lg,
} as const;
