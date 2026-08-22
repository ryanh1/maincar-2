import * as React from 'react'
import { DayPicker, getDefaultClassNames } from 'react-day-picker'

import { buttonVariants } from '@/components/ui/buttonVariants'
import { cn } from '@/lib/utils'

function Calendar({ className, classNames, showOutsideDays = true, ...props }: React.ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('bg-background p-3', className)}
      classNames={{
        root: cn('w-fit', defaults.root),
        months: cn('flex flex-col gap-4', defaults.months),
        month: cn('flex flex-col gap-3', defaults.month),
        month_caption: cn('relative flex h-8 items-center justify-center', defaults.month_caption),
        caption_label: cn('text-sm font-medium', defaults.caption_label),
        nav: cn('absolute inset-x-0 top-0 flex items-center justify-between', defaults.nav),
        button_previous: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), defaults.button_previous),
        button_next: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), defaults.button_next),
        month_grid: cn('w-full border-collapse', defaults.month_grid),
        weekdays: cn('flex', defaults.weekdays),
        weekday: cn('w-8 text-center text-xs font-medium text-muted-foreground', defaults.weekday),
        week: cn('mt-1 flex w-full', defaults.week),
        day: cn('size-8 p-0 text-center', defaults.day),
        day_button: cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'w-8 font-normal', defaults.day_button),
        selected: cn('bg-primary text-primary-foreground', defaults.selected),
        today: cn('bg-accent text-accent-foreground', defaults.today),
        outside: cn('text-muted-foreground', defaults.outside),
        disabled: cn('text-muted-foreground opacity-50', defaults.disabled),
        ...classNames,
      }}
      {...props}
    />
  )
}

export { Calendar }
