import * as React from 'react'
import type { VariantProps } from 'class-variance-authority'

import { Button } from '@/components/ui/button'
import type { buttonVariants } from '@/components/ui/buttonVariants'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A button whose only content is an icon.
 *
 * `tooltip` is REQUIRED, and it is the single source for both things such a
 * button owes its reader (.claude/rules/design-system.md → Icon-only buttons):
 *
 *   - the tooltip a sighted person hovers or tabs to, for the glyph they do not
 *     recognise, and
 *   - the accessible name a screen reader announces, because a tooltip never
 *     reaches one.
 *
 * They come from one prop so they cannot drift apart, and the type checker
 * refuses the component without it. A written rule is remembered; a required
 * prop is enforced.
 *
 * Wording lives in .claude/rules/copy.md → Icon-button tooltips: the action and
 * its object, as a verb phrase — "Refresh the member list", never "Refresh".
 *
 * A disabled `<button>` swallows pointer events, so hovering it fires nothing
 * and the tooltip never opens. When `disabled`, the trigger is a wrapping
 * `<span>` instead, which still receives hover. Note the rule that goes with
 * it: if the reason a control is disabled is the thing worth saying, say the
 * reason on the screen — a tooltip is not where a blocker gets to hide.
 */
type IconButtonProps = Omit<React.ComponentProps<'button'>, 'aria-label' | 'title'> &
  VariantProps<typeof buttonVariants> & {
    /** What the button does: verb, then object. Becomes the tooltip AND the accessible name. */
    tooltip: string
    /** Which edge the tooltip opens from. Radix's default is `top`. */
    tooltipSide?: React.ComponentProps<typeof TooltipContent>['side']
  }

function IconButton({
  tooltip,
  tooltipSide,
  variant = 'ghost',
  size = 'icon-sm',
  disabled,
  children,
  ...props
}: IconButtonProps) {
  const button = (
    <Button variant={variant} size={size} disabled={disabled} aria-label={tooltip} {...props}>
      {children}
    </Button>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className="inline-flex">{button}</span> : button}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export { IconButton }
