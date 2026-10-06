export const SlotStub = ({
  name,
  inline = false,
}: {
  name: string
  inline?: boolean
}) =>
  inline ? (
    <span data-slot={name} css="display: contents;" />
  ) : (
    <div data-slot={name} css="display: contents;" />
  )
