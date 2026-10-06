export type SpinnerProps = {
  label?: string
  size?: string
}

export const Spinner = ({ label, size = '1.125rem' }: SpinnerProps) => (
  <span
    data-spinner=""
    attr:role={label ? 'img' : null}
    attr:aria-label={label ?? null}
    attr:aria-hidden={label ? null : 'true'}
    css:spinner-size={size}
    css={`
      display: inline-grid;
      place-items: center;
      flex: none;
      width: var(--spinner-size);
      height: var(--spinner-size);
      color: inherit;

      & svg {
        width: 100%;
        height: 100%;
        animation: ui-spin 0.8s linear infinite;
      }

      & circle {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5;
        stroke-linecap: round;
      }

      & [data-track] {
        opacity: 0.2;
      }
    `}
  >
    <svg:svg viewBox="0 0 24 24" aria-hidden="true">
      <svg:circle data-track="" cx="12" cy="12" r="9" />
      <svg:circle
        cx="12"
        cy="12"
        r="9"
        stroke-dasharray="16 60"
      />
    </svg:svg>
  </span>
)
