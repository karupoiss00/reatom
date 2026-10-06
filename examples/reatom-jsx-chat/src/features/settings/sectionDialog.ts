import { atom, type Atom, withChangeHook, withComputed } from '@reatom/core'

export const reatomSectionDialog = <Section extends string>(
  route: Atom<Section | null>,
  fallback: Section,
  name: string,
) => {
  const isOpen = atom(false, `${name}.isOpen`).extend(
    withComputed(() => route() !== null),
  )
  const selected = atom<Section>(fallback, `${name}.selected`).extend(
    withComputed((state) => route() ?? state),
    withChangeHook((section) => {
      if (route() !== null) route.set(section)
    }),
  )
  const close = () => route.set(null)
  return { isOpen, selected, close }
}
