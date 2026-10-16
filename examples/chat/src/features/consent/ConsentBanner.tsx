import { consent } from '../../setup'
import { Button } from '../../ui'

const bannerStyles = `
  position: fixed;
  z-index: var(--z-drawer);
  left: max(var(--space-4), env(safe-area-inset-left));
  bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
  width: min(22rem, calc(100vw - var(--space-4) * 2));

  @media (max-width: 760px) {
    right: max(var(--space-4), env(safe-area-inset-right));
    bottom: calc(6rem + env(safe-area-inset-bottom));
    width: auto;
  }
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-3);
  color: var(--text);

  & h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: var(--weight-medium);
    line-height: var(--leading-tight);
  }

  & p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
  }

  & label {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--hit);
    cursor: pointer;
    font-size: var(--text-base);
  }

  & input {
    width: 1.125rem;
    height: 1.125rem;
    margin: 0;
    accent-color: var(--accent);
  }

  & [data-consent-actions] {
    display: flex;
    justify-content: flex-end;
  }
`

const choiceCopy = () =>
  consent.snapshot() === null
    ? 'Analytics stay off until you save.'
    : 'Analytics is off. Save with Analytics checked to grant again.'

const ChoiceForm = () => (
  <form model={consent} css="display: grid; gap: var(--space-3);">
    <p>{choiceCopy}</p>
    <label>
      <input
        type="checkbox"
        data-testid="consent-analytics"
        model:field={consent.fields.analytics}
      />
      Analytics
    </label>
    <div data-consent-actions="">
      <Button
        type="submit"
        size="sm"
        variant="primary"
        data-testid="consent-save"
      >
        Save preferences
      </Button>
    </div>
  </form>
)

const withdrawAnalytics = () => {
  consent.fields.analytics.change(false)
  void consent.submit()
}

const Granted = () => (
  <div css="display: grid; gap: var(--space-3);">
    <p>
      Analytics is on. Withdraw stops analytics collection. New events will not
      carry a visitor id.
    </p>
    <div data-consent-actions="">
      <Button
        type="button"
        size="sm"
        data-testid="consent-withdraw"
        on:click={withdrawAnalytics}
      >
        Withdraw analytics
      </Button>
    </div>
  </div>
)

export const ConsentBanner = () => (
  <section
    data-slot="ConsentBanner"
    data-testid="consent-banner"
    aria-labelledby="consent-banner-title"
    css={bannerStyles}
  >
    <h2 id="consent-banner-title">Privacy preferences</h2>
    {() =>
      consent.snapshot()?.categories.analytics === true ? (
        <Granted />
      ) : (
        <ChoiceForm />
      )
    }
  </section>
)
