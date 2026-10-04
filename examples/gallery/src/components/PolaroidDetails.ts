import drawerPullUrl from '../assets/polaroid-drawer-pull.svg'
import folderJacketUrl from '../assets/polaroid-folder.svg'

/** Contact-sheet and photographer's desk art direction for Polaroid. */
export const polaroidDetailsCss = `
  &[data-theme-pack='polaroid'] {
    --polaroid-ink: #31261c;
    --polaroid-coral: #d94f45;
    --polaroid-blue: #4f7fa8;
    --polaroid-paper: #fffaf2;
    --polaroid-tape: rgba(235, 202, 139, 0.9);
    --polaroid-desk:
      radial-gradient(ellipse at 50% 0%, #fff7e599, transparent 60%),
      radial-gradient(ellipse at 50% 45%, transparent 55%, #63503b1f 100%),
      repeating-linear-gradient(0deg, #63503b08 0 1px, transparent 1px 3px),
      repeating-linear-gradient(90deg, #fffaf218 0 1px, transparent 1px 4px),
      #d9ceba;
    --polaroid-desk-edge: #31261c40;

    &[data-theme-mode='dark'] {
      --polaroid-desk:
        radial-gradient(ellipse at 50% 0%, #b69e7124, transparent 60%),
        radial-gradient(ellipse at 50% 45%, transparent 55%, #0000004d 100%),
        repeating-linear-gradient(0deg, #fffaf205 0 1px, transparent 1px 3px),
        #292c27;
      --polaroid-desk-edge: #0000004d;
    }

    #gallery-workspace { background: var(--polaroid-desk); }
    main { background: none; }

    #gallery-toolbar {
      min-height: 60px;
      padding-top: 10px;
      padding-bottom: 10px;
      overflow: visible;
      border-bottom-color: var(--border-strong);
      box-shadow: 0 8px 24px var(--shadow);
      position: relative;
    }
    #gallery-toolbar::after {
      content: '';
      position: absolute;
      right: 18px;
      bottom: -3px;
      left: 18px;
      height: 3px;
      background: repeating-linear-gradient(90deg, var(--polaroid-coral) 0 24px, var(--polaroid-blue) 24px 42px, transparent 42px 58px);
      opacity: 0.9;
      pointer-events: none;
    }
    #gallery-brand {
      color: var(--text-primary);
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 25px;
      font-weight: 800;
      letter-spacing: -0.07em;
      text-transform: none;
    }
    #gallery-brand > span:first-child {
      width: 40px;
      height: 40px;
      border-radius: 0;
      background: none;
      box-shadow: none;
      transform: rotate(-5deg);
    }
    #gallery-toolbar input {
      border-color: var(--input-border);
      border-radius: 2px;
      box-shadow: 0 2px 0 var(--shadow);
    }
    #gallery-toolbar input:focus { border-color: var(--polaroid-coral); }

    [data-gap] {
      border-color: var(--card-border);
      box-shadow: 0 8px 16px var(--shadow);
      isolation: isolate;
      transition: transform 220ms cubic-bezier(.2, .8, .2, 1), box-shadow 220ms ease;
    }
    [data-gap]:not([data-gap='none']) {
      display: flex;
      flex-direction: column;
      aspect-ratio: auto;
      background-color: var(--polaroid-paper);
      background-image: linear-gradient(100deg, rgba(255,255,255,.48), transparent 48%);
    }
    [data-gap]:not([data-gap='none']):hover,
    [data-gap]:not([data-gap='none']):focus-within { box-shadow: 0 18px 32px var(--shadow-strong); }
    [data-gap]:not([data-gap='none'])[data-selected='true'] {
      box-shadow: 0 0 0 2px var(--polaroid-coral), 0 18px 32px var(--shadow-strong);
    }
    [data-gap][data-gap='none']::before,
    [data-gap][data-gap='none']::after { display: none; }
    [data-gap]:not([data-gap='none']) > div:first-of-type {
      position: relative;
      inset: auto;
      aspect-ratio: 1;
      flex-shrink: 0;
      border-radius: 1px;
      box-shadow: inset 0 0 0 1px rgba(49, 38, 28, 0.08);
    }
    [data-gap]:not([data-gap='none']) [data-caption] {
      position: static;
      min-height: 44px;
      margin: 0;
      z-index: 2;
      padding: 10px 6px 2px;
      background: transparent;
      color: var(--polaroid-ink);
      text-align: center;
      text-shadow: none;
    }
    [data-gap]:not([data-gap='none']) [data-caption] > div:first-child {
      color: var(--polaroid-ink);
      font-family: 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive;
      font-size: 15px;
      font-weight: 400;
      letter-spacing: 0;
      line-height: 1.25;
    }
    [data-gap]:not([data-gap='none']) [data-caption] > div + div {
      color: rgba(49, 38, 28, 0.58);
      font-family: var(--font-ui);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0;
      margin-top: 2px;
    }
    [data-gap]:not([data-gap='none'])[data-density='compact'] {
      --card-padding: clamp(2px, calc(var(--item-size, 220px) * 0.055), 9px)
        clamp(2px, calc(var(--item-size, 220px) * 0.055), 9px)
        clamp(6px, calc(var(--item-size, 220px) * 0.2), 24px);
    }
    [data-gap]:not([data-gap='none'])[data-density='compact'] [data-caption] {
      min-height: 0;
      padding: 5px 4px 1px;
    }
    [data-gap]:not([data-gap='none'])[data-density='compact'] [data-caption] > div:first-child {
      font-size: 13px;
    }
    [data-gap]:not([data-gap='none'])[data-density='tiny'],
    [data-gap]:not([data-gap='none'])[data-density='micro'] {
      --card-padding: clamp(2px, calc(var(--item-size, 220px) * 0.055), 9px)
        clamp(2px, calc(var(--item-size, 220px) * 0.055), 9px)
        clamp(6px, calc(var(--item-size, 220px) * 0.2), 24px);
      --card-hover-transform: translateY(-1px);
    }
    [data-gap][data-density='tiny'] { box-shadow: 0 3px 6px var(--shadow); }
    [data-gap][data-density='micro'] { box-shadow: 0 1px 3px var(--shadow); }
    [data-gap][data-density='tiny']:hover,
    [data-gap][data-density='tiny']:focus-within { box-shadow: 0 6px 10px var(--shadow-strong); }
    [data-gap][data-density='micro']:hover,
    [data-gap][data-density='micro']:focus-within { box-shadow: 0 3px 6px var(--shadow-strong); }
    [data-gap][data-density='tiny'][data-selected='true'] {
      box-shadow: 0 0 0 2px var(--polaroid-coral), 0 6px 10px var(--shadow-strong);
    }
    [data-gap][data-density='micro'][data-selected='true'] {
      box-shadow: 0 0 0 2px var(--polaroid-coral), 0 3px 6px var(--shadow-strong);
    }
    #gallery-folder-sidebar {
      position: relative;
      padding: 28px 12px 24px;
      background: none;
      backdrop-filter: none;
      border-right: 1px solid color-mix(in srgb, var(--polaroid-desk-edge) 40%, transparent);
      box-shadow: inset -12px 0 18px -14px var(--polaroid-desk-edge);
    }
    #gallery-folder-sidebar [role='tree'] {
      position: relative;
      isolation: isolate;
      padding: 20px 8px 92px;
      background:
        linear-gradient(180deg, #120d09 0, #120d0900 34px),
        repeating-linear-gradient(90deg, #ffe7c00a 0 2px, transparent 2px 9px),
        linear-gradient(90deg, #2a2017, #45362a 50%, #2a2017);
      border: 6px solid #9a7148;
      border-top: 5px solid #c79f6f;
      border-bottom: 0;
      border-radius: 3px 3px 0 0;
      box-shadow:
        inset 12px 0 10px -8px #000a,
        inset -12px 0 10px -8px #000a,
        inset 0 1px #f3d5a640,
        0 14px 22px #31261c38,
        0 2px 3px #31261c30;
    }
    #gallery-folder-sidebar [role='tree']::after {
      content: '';
      position: absolute;
      left: -10px; right: -10px; bottom: -8px;
      height: 92px;
      border: 1px solid #6c4a2c;
      border-radius: 3px 3px 5px 5px;
      background:
        url("${drawerPullUrl}") center bottom 10px / 90px 30px no-repeat,
        linear-gradient(180deg, #fff3dc29, transparent 30%, transparent 70%, #3b220f1f),
        repeating-linear-gradient(1.5deg, transparent 0 3px, #4b301b14 3px 4px, transparent 4px 8px),
        linear-gradient(100deg, #a2764a, #bf935f 45%, #a87c4d);
      box-shadow:
        0 -7px 12px -4px #0007,
        inset 0 3px #e7c08c,
        inset 0 -3px #7a5432,
        inset 2px 0 #cfa574,
        inset -2px 0 #8d6139,
        0 5px 8px #31261c40;
      pointer-events: none;
      z-index: 1;
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem'] {
      position: relative;
      isolation: isolate;
      overflow: visible;
      box-sizing: border-box;
      height: 76px;
      min-height: 0;
      margin: 0 -3px -30px;
      padding: 8px 23% 0 5px;
      align-items: flex-start;
      gap: 3px;
      border: 0;
      border-radius: 0;
      background: none;
      box-shadow: none;
      color: #44351f;
      transform: translateY(var(--folder-lift, 0px));
      transition: transform 160ms ease;
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem']::before {
      content: '';
      position: absolute;
      z-index: -1;
      inset: 0;
      background: url("${folderJacketUrl}") center / 100% 100% no-repeat;
      pointer-events: none;
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem']:hover::before {
      filter: brightness(1.045);
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem'][aria-selected='true'] {
      --folder-lift: -8px;

      &::before { filter: brightness(1.08) drop-shadow(0 -2px 3px #0006); }
      & > span:nth-child(3),
      & > span:nth-child(4) { color: #963d31; }
    }
    @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
      #gallery-folder-sidebar [role='group'] > [role='treeitem']:hover {
        transform: translateY(calc(var(--folder-lift, 0px) - 3px));
      }
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem']:focus-visible {
      outline: none;
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem']:focus-visible::after {
      content: '';
      position: absolute;
      inset: 6px 21% auto 4px;
      height: 26px;
      border: 2px solid #325d77;
      border-radius: 5px;
      pointer-events: none;
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem'] > span:nth-child(2) { display: none; }
    #gallery-folder-sidebar [role='group'] > [role='treeitem'] > span:nth-child(3) {
      flex: 1;
      min-width: 0;
      padding: 0;
      color: #44351f;
      font: 500 14px / 22px 'Helvetica Neue', Arial, sans-serif;
      text-shadow: 0 1px 1px #fff0bc80;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem'] > span:nth-child(4) {
      color: #614a28;
      font: 500 12px / 22px 'Helvetica Neue', Arial, sans-serif;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 1px #f5dda480;
    }
    #gallery-folder-sidebar [role='group'] > [role='treeitem'] button {
      margin-top: 3px;
    }
    #gallery-folder-sidebar [role='tree'] > [role='treeitem'] {
      position: absolute;
      left: 50%; bottom: 40px;
      transform: translateX(-50%);
      z-index: 2;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      background: none;
      box-shadow: none;
      white-space: nowrap;
    }
    #gallery-folder-sidebar [role='tree'] > [role='treeitem']::before,
    #gallery-folder-sidebar [role='tree'] > [role='treeitem'] > span:first-child { display: none; }
    #gallery-folder-sidebar [role='tree'] > [role='treeitem'] > span:last-child {
      display: block;
      min-width: 96px;
      max-width: 160px;
      padding: 2px 14px 1px;
      white-space: nowrap;
      text-align: center;
      border: 3px solid;
      border-image: linear-gradient(180deg, #f6e7bb, #b59c64 45%, #7a6440) 1;
      box-shadow: inset 0 1px 3px #5443254d, 0 1px #f0cf9e66, 0 2px 3px #0005;
      font: 400 15px / 20px 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive;
      color: #31261c;
      background:
        repeating-linear-gradient(180deg, transparent 0 19px, #4f7fa81f 19px 20px),
        linear-gradient(180deg, #fffdf6, #f1e8d4);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #gallery-folder-sidebar [role='tree'] > [role='treeitem'][aria-selected='true'] > span:last-child {
      color: #963d31;
    }
    #gallery-folder-sidebar [role='treeitem'] button { color: #51412a; }
    #gallery-folder-divider { display: none; }
    aside[role='dialog'] { border-left-color: var(--border); }
    aside[role='dialog'] h2 { font-family: Georgia, 'Times New Roman', serif; letter-spacing: -0.04em; }
    aside[role='dialog'] input[type='range'] { accent-color: var(--polaroid-blue); }
    #gallery-pathbar [role='group'][aria-label='Sort by'] {
      gap: 0;

      & > [data-ui='button'] {
        position: relative;
        border-radius: 0;
      }
      & > [data-ui='button'] + [data-ui='button'] {
        margin-left: -1px;
      }
      & > [data-ui='button']:first-child {
        border-radius: 3px 0 0 3px;
      }
      & > [data-ui='button']:last-child {
        border-radius: 0 3px 3px 0;
      }
      & > [data-ui='button']:hover,
      & > [data-ui='button']:focus-visible,
      & > [data-ui='button'][aria-pressed='true'] {
        z-index: 1;
      }
    }

    #gallery-loupe {
      padding: 10px 10px 24px;
      border: 0;
      border-radius: 2px;
      background-color: var(--polaroid-paper);
      background-image: linear-gradient(100deg, rgba(255,255,255,.48), transparent 48%);
      box-shadow: 0 2px 6px var(--shadow), 0 18px 32px var(--shadow-strong);
      --loupe-tilt: -1deg;

      &[data-placement='below'] { --loupe-tilt: 0.8deg; }
      [data-loupe-image] {
        border-radius: 1px;
        background-color: var(--polaroid-paper);
        box-shadow: inset 0 0 0 1px rgba(49, 38, 28, 0.08);
      }
      [data-loupe-name] {
        color: var(--polaroid-ink);
        font-family: 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive;
        font-size: 16px;
        font-weight: 400;
        line-height: 1.25;
        text-align: center;
      }
      [data-loupe-meta] {
        color: rgba(49, 38, 28, 0.58);
        font-family: var(--font-ui);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        text-align: center;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      [data-gap] { transition: none; }
      #gallery-folder-sidebar [role='treeitem'] { transition: none; }
      #gallery-brand > span:first-child { transform: none; }
      [data-gap]:hover,
      [data-gap]:focus-within { transform: none !important; }
    }
    @media (max-width: 600px) {
      #gallery-toolbar::after { right: 12px; left: 12px; }
      #gallery-folder-sidebar { padding: 20px 12px; }
      #gallery-folder-sidebar::after { display: none; }
    }
  }
`
