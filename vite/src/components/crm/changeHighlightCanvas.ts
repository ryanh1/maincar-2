/** At most three dots keep a busy grid scannable while preserving a 3+ signal. */
export function changeDotCount(changeCount: number): number {
  return Math.max(1, Math.min(3, Math.floor(changeCount)))
}

/** Draw the count badge after Glide has rendered the normal cell content. */
export function drawChangeDots(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  changeCount: number,
  color: string,
) {
  const dots = changeDotCount(changeCount)
  const radius = 2
  const gap = 6
  const startX = bounds.x + bounds.width - 8 - (dots - 1) * gap

  ctx.save()
  ctx.fillStyle = color
  for (let index = 0; index < dots; index += 1) {
    ctx.beginPath()
    ctx.arc(startX + index * gap, bounds.y + 8, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Draw the single dot a `dot`-target colour rule contributes (SPEC-CHUNK-2 J2.5 §C). */
export function drawColorRuleDot(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  color: string,
) {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(bounds.x + bounds.width - 8, bounds.y + 8, 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
