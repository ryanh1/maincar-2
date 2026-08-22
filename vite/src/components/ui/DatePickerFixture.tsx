import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'

export function DatePickerFixture() {
  const [value, setValue] = useState<Date | undefined>(new Date(2026, 7, 24))
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    return () => document.documentElement.classList.remove('dark')
  }, [theme])

  return (
    <main className="min-h-dvh bg-background p-6 text-foreground">
      <div className="max-w-sm">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold">Date picker</h1>
          <Button type="button" variant="secondary" size="sm" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>
            Use {theme === 'light' ? 'dark' : 'light'} theme
          </Button>
        </div>
        <div className="mt-6">
          <DatePicker value={value} onChange={setValue} ariaLabel="Renewal date" />
        </div>
      </div>
    </main>
  )
}
