import { Toaster as Sonner, type ToasterProps } from 'sonner'

// The stock shadcn wrapper pulls in `next-themes`, which this app does not use —
// dark mode is a `.dark` class on <html>, and the CSS variables below already
// follow it. So the toast inherits the app theme with no extra dependency.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      richColors
      toastOptions={{ className: '!rounded-md !border-border !font-sans' }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
