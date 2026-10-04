import type { ControlThemeOverrides } from '../themeTypes'

const viewer = {
  rest: {
    foreground: '#f4ebd8',
    background: '#272823',
    border: 'transparent',
    shadow: 'none',
  },
  hover: {
    foreground: '#f4ebd8',
    background: '#f4ebd81c',
    border: '#f4ebd84d',
    shadow: 'none',
  },
  press: {
    foreground: '#f4ebd8',
    background: '#f4ebd828',
    border: '#f4ebd84d',
    shadow: 'none',
  },
  selected: {
    foreground: '#272823',
    background: '#fff8e9',
    border: '#fff8e9',
    shadow: 'none',
  },
  selectedHover: {
    foreground: '#272823',
    background: '#fff3d6',
    border: '#fff3d6',
    shadow: 'none',
  },
  selectedPress: {
    foreground: '#272823',
    background: '#f0e2c4',
    border: '#f0e2c4',
    shadow: 'none',
  },
}

const coralSelected = {
  foreground: '#fffaf2',
  background: 'var(--polaroid-coral)',
  border: 'var(--polaroid-coral)',
  shadow: 'none',
}

const blueSelected = {
  foreground: '#fffaf2',
  background: 'var(--polaroid-blue)',
  border: 'var(--polaroid-blue)',
  shadow: 'none',
}

const coralActionHover = {
  foreground: '#ffffff',
  background: 'color-mix(in srgb, var(--polaroid-coral) 86%, #31261c)',
  border: 'color-mix(in srgb, var(--polaroid-coral) 86%, #31261c)',
  shadow: 'none',
}

const coralActionPress = {
  foreground: '#ffffff',
  background: 'color-mix(in srgb, var(--polaroid-coral) 74%, #31261c)',
  border: 'color-mix(in srgb, var(--polaroid-coral) 74%, #31261c)',
  shadow: 'none',
}

export const polaroidControlOverrides = {
  app: {
    action: {
      hover: coralActionHover,
      press: coralActionPress,
      selectedHover: coralActionHover,
      selectedPress: coralActionPress,
    },
    quiet: {
      selected: blueSelected,
      selectedHover: {
        ...blueSelected,
        background: 'color-mix(in srgb, var(--polaroid-blue) 82%, #fffaf2)',
      },
      selectedPress: {
        ...blueSelected,
        background: 'color-mix(in srgb, var(--polaroid-blue) 70%, #31261c)',
      },
    },
    choice: {
      selected: blueSelected,
      selectedHover: {
        ...blueSelected,
        background: 'color-mix(in srgb, var(--polaroid-blue) 82%, #fffaf2)',
      },
      selectedPress: {
        ...blueSelected,
        background: 'color-mix(in srgb, var(--polaroid-blue) 70%, #31261c)',
      },
    },
    switch: {
      rest: { border: 'var(--border-strong)' },
      selected: blueSelected,
      selectedHover: {
        ...blueSelected,
        background: 'color-mix(in srgb, var(--polaroid-blue) 82%, #fffaf2)',
      },
      selectedPress: {
        ...blueSelected,
        background: 'color-mix(in srgb, var(--polaroid-blue) 70%, #31261c)',
      },
      switch: { knob: '#fffaf2', knobChecked: '#fffaf2' },
    },
  },
  viewer: {
    action: viewer,
    quiet: viewer,
    choice: viewer,
  },
  overlay: {
    rest: {
      foreground: '#31261c',
      background: '#fffaf2',
      border: 'rgba(49, 38, 28, 0.18)',
      shadow: '0 1px 3px rgba(49, 38, 28, 0.24)',
    },
    hover: {
      foreground: '#31261c',
      background: '#f6ecdc',
      border: 'var(--polaroid-coral)',
      shadow: '0 1px 3px rgba(49, 38, 28, 0.24)',
    },
    press: {
      foreground: '#31261c',
      background: '#ecdfca',
      border: 'var(--polaroid-coral)',
      shadow: 'none',
    },
    selected: coralSelected,
    selectedHover: {
      ...coralSelected,
      background: 'color-mix(in srgb, var(--polaroid-coral) 82%, #fffaf2)',
    },
    selectedPress: {
      ...coralSelected,
      background: 'color-mix(in srgb, var(--polaroid-coral) 70%, #31261c)',
    },
  },
} satisfies ControlThemeOverrides
