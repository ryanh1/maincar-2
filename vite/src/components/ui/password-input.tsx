import * as React from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { PASSWORD_MIN_LENGTH, PASSWORD_RULE } from '@/lib/passwordPolicy'
import { cn } from '@/lib/utils'

/**
 * A password field with the eye toggle. A drop-in for `<Input type="password" />`.
 *
 * The toggle is a real `<button type="button">`: `type` matters, because a bare
 * button inside a form submits it, so revealing the password would sign you in.
 * It stays in the tab order — reaching it is one Tab from the field and one more
 * Tab leaves it, which is what "keyboard reachable, no trap" means — and its
 * accessible name changes with state so a screen reader announces which way the
 * next press goes.
 *
 * `showRequirement` states the rule BEFORE the person submits. The rule itself
 * lives in `lib/passwordPolicy` and matches what Firebase enforces.
 */
type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, 'type'> & {
  showRequirement?: boolean
}

function PasswordInput({
  className,
  disabled,
  showRequirement = false,
  value,
  id,
  'aria-describedby': describedBy,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false)

  const password = typeof value === 'string' ? value : ''
  const met = password.length >= PASSWORD_MIN_LENGTH
  const ruleId = id ? `${id}-rule` : undefined
  // Joined by hand, not with `cn`: these are ids, and `cn` runs tailwind-merge,
  // which is free to rewrite anything that looks like a class name.
  const describedByIds = [showRequirement ? ruleId : undefined, describedBy]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          disabled={disabled}
          value={value}
          minLength={PASSWORD_MIN_LENGTH}
          // Leave room for the toggle so a long value never slides under it.
          className={cn('pr-10', className)}
          aria-describedby={describedByIds || undefined}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          className={cn(
            'absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 text-muted-foreground transition-colors',
            'hover:text-foreground',
            'focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>

      {showRequirement && (
        <p
          id={ruleId}
          className={cn(
            'flex items-center gap-1.5 text-xs',
            met ? 'text-status-success' : 'text-muted-foreground',
          )}
        >
          {/* Never colour alone: the tick is what carries "done" without it. */}
          {met && <Check size={14} aria-hidden="true" />}
          {PASSWORD_RULE}
        </p>
      )}
    </div>
  )
}

export { PasswordInput }
