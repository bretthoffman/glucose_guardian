import { T } from "../constants/theme";

/** Horizontal space for the Dose/Log segmented control before GlucoseStatusPill (flex-equivalent). */
export function doseScreenToggleMaxWidth(
  layoutWidth: number,
  glucosePillWidth: number,
  horizontalPadding: number = T.tabGlucoseHeader.paddingHorizontal,
  rowGap: number = T.tabGlucoseHeader.rowGap,
): number {
  const inner = layoutWidth - horizontalPadding * 2;
  return Math.max(0, inner - rowGap - glucosePillWidth);
}
