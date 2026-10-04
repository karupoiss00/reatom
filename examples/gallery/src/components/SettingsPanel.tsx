import { ChoiceButton, Switch, THEME_PACKS } from '../design-system'
import {
  developRawFullSize,
  glassBackgroundAnimation,
  gridColumns,
  gridColumnsLabel,
  gridGap,
  ignoreExifOrientation,
  imageFit,
  imageGrid,
  keepLightboxView,
  setGridGap,
  showFileSizes,
  showImageNames,
  showLightboxScrubber,
  themeMode,
  themePack,
  wrapFolderNavigation,
} from '../model'
import type { GridGap, ImageFit, ThemeMode, ThemePack } from '../types'
import { Panel } from './Panel'
import { settingsPanelWidth } from './panelLayout'
import { settingsPanelOpen } from './panelState'

const GAP_OPTIONS: GridGap[] = ['none', 'small', 'medium', 'large', 'xl']
const FIT_OPTIONS: ImageFit[] = ['contain', 'cover', 'fill', 'none']

const SectionTitle = ({ text }: { text: string }) => (
  <h3
    css={`
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      margin-bottom: 10px;
      margin-top: 20px;
    `}
  >
    {text}
  </h3>
)

const ThemePackButton = ({
  value,
  label,
  description,
  swatches,
}: {
  value: ThemePack
  label: string
  description: string
  swatches: readonly [string, string, string]
}) => (
  <ChoiceButton
    label={`${label}. ${description}`}
    selected={() => themePack() === value}
    onClick={() => themePack.set(value)}
    css={`
      width: 100%;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
      align-items: center;
      text-align: left;
      padding: 10px;
      min-height: 52px;
    `}
  >
    <span css="display: flex; gap: 3px;">
      {swatches.map((color) => (
        <span
          style={{ background: color }}
          css={`
            width: 14px;
            height: 32px;
            border-radius: var(--radius-sm);
            border: var(--border-width) var(--border-style) var(--card-border);
          `}
        />
      ))}
    </span>
    <span css="display: grid; gap: 2px;">
      <span css="font-size: 13px; font-weight: 700;">{label}</span>
      <span css="font-size: 11px; color: inherit; opacity: 0.72;">
        {description}
      </span>
    </span>
  </ChoiceButton>
)

const ThemeModeButton = ({
  mode,
  label,
}: {
  mode: ThemeMode
  label: string
}) => (
  <ChoiceButton
    label={label}
    selected={() => themeMode() === mode}
    onClick={() => themeMode.set(mode)}
    css={`
      flex: 1;
      gap: 6px;
      font-weight: 700;
    `}
  >
    <span
      css={`
        width: 7px;
        height: 7px;
        border-radius: var(--radius-round);
        background: currentColor;
        flex-shrink: 0;
        opacity: 0.55;
      `}
    />
    {label}
  </ChoiceButton>
)

export const SettingsPanel = () => (
  <Panel
    label="Settings"
    closeLabel="Close settings"
    open={settingsPanelOpen}
    onClose={() => settingsPanelOpen.set(false)}
    width={settingsPanelWidth}
    css={`
      padding: 20px calc(20px + var(--shadow-clearance, 0px))
        calc(20px + var(--shadow-clearance, 0px)) 20px;

      [data-ui='button'][aria-pressed='true'] > span:first-child {
        opacity: 1;
      }
    `}
  >
    <SectionTitle text="Grid Columns" />
    <div
      css={`
        display: flex;
        align-items: center;
        gap: 12px;
      `}
    >
      <input
        type="range"
        min="0"
        attr:max={() => String(imageGrid.maxColumnCount())}
        step="1"
        aria-label="Grid columns"
        model:valueAsNumber={gridColumns}
        css={`
          flex: 1;
          accent-color: var(--accent);
        `}
      />
      <span
        css={`
          font-size: 13px;
          color: var(--text-secondary);
          min-width: 32px;
          text-align: center;
        `}
      >
        {gridColumnsLabel}
      </span>
    </div>

    <SectionTitle text="Grid Gap" />
    <div
      css={`
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        gap: calc(6px + var(--shadow-clearance, 0px));
      `}
    >
      {GAP_OPTIONS.map((gap) => (
        <ChoiceButton
          label={gap}
          selected={() => gridGap() === gap}
          onClick={() => setGridGap(gap)}
          bracket
          css="padding-inline: 6px; min-width: 0;"
        />
      ))}
    </div>

    <SectionTitle text="Image Fit" />
    <div
      css={`
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        gap: calc(6px + var(--shadow-clearance, 0px));
      `}
    >
      {FIT_OPTIONS.map((fit) => (
        <ChoiceButton
          label={fit}
          selected={() => imageFit() === fit}
          onClick={() => imageFit.change(fit)}
          bracket
          css="padding-inline: 6px; min-width: 0;"
        />
      ))}
    </div>

    <SectionTitle text="UI Options" />
    <Switch
      label="Show Image Names"
      checked={showImageNames}
      onToggle={showImageNames.toggle}
    />
    <Switch
      label="Show File Sizes"
      checked={showFileSizes}
      onToggle={showFileSizes.toggle}
    />
    <Switch
      label="Ignore EXIF Orientation"
      checked={ignoreExifOrientation}
      onToggle={ignoreExifOrientation.toggle}
    />
    <Switch
      label="Develop RAW at Full Size"
      checked={developRawFullSize}
      onToggle={developRawFullSize.toggle}
    />

    <SectionTitle text="Lightbox Navigation" />
    <Switch
      label="Wrap at Folder Ends"
      checked={wrapFolderNavigation}
      onToggle={wrapFolderNavigation.toggle}
    />
    <Switch
      label="Keep Zoom While Navigating"
      checked={keepLightboxView}
      onToggle={keepLightboxView.toggle}
    />
    <Switch
      label="Show Folder Scrubber"
      checked={showLightboxScrubber}
      onToggle={showLightboxScrubber.toggle}
    />

    <SectionTitle text="Theme" />
    <div
      css={`
        display: flex;
        gap: calc(6px + var(--shadow-clearance, 0px));
        margin-bottom: calc(12px + var(--shadow-clearance, 0px));
      `}
    >
      <ThemeModeButton mode="light" label="Light" />
      <ThemeModeButton mode="dark" label="Dark" />
      <ThemeModeButton mode="system" label="System" />
    </div>
    {() =>
      themePack() === 'glass' && (
        <div>
          <Switch
            label="Animate Glass Background"
            checked={glassBackgroundAnimation}
            onToggle={glassBackgroundAnimation.toggle}
          />
          <p css="font-size: 12px; color: var(--text-secondary); margin: 0 0 12px;">
            Uses more power. Pauses when the tab is hidden and respects reduced
            motion.
          </p>
        </div>
      )
    }

    <div css="display: grid; gap: calc(8px + var(--shadow-clearance, 0px));">
      {THEME_PACKS.map((pack) => (
        <ThemePackButton
          value={pack.value}
          label={pack.label}
          description={pack.description}
          swatches={pack.swatches}
        />
      ))}
    </div>
  </Panel>
)
