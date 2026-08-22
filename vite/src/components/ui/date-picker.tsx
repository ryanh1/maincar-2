import * as React from 'react'
import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface DatePickerProps extends Omit<React.ComponentProps<typeof Calendar>, 'mode' | 'onSelect' | 'selected'> {
  value?: Date
  onChange?: (value: Date | undefined) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
}

function DatePicker({
  value,
  onChange,
  placeholder = 'Choose date',
  ariaLabel = 'Choose date',
  disabled = false,
  className,
  ...calendarProps
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn('w-full justify-start', !value && 'text-muted-foreground', className)}
        >
          <CalendarIcon size={16} />
          {value ? format(value, 'PP') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(next) => {
            onChange?.(next)
            setOpen(false)
          }}
          disabled={disabled}
          {...calendarProps}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerProps }
