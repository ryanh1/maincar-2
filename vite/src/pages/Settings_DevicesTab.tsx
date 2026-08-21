import { DeviceCheck } from '@/components/DeviceCheck'

/**
 * The same microphone/speaker check the greenroom shows before a call,
 * reachable any time — a rep should not have to start dialling just to see
 * whether their headset still works.
 */
export function Settings_DevicesTab() {
  return (
    <section>
      <h2 className="text-base font-semibold">Devices</h2>

      <div className="mt-4">
        <DeviceCheck />
      </div>
    </section>
  )
}
