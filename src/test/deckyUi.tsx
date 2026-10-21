/**
 * Test double for `@decky/ui`, which only works inside Steam (it looks up
 * Steam's webpack modules at import time). Plain DOM elements stand in for
 * Steam's components, and gamepad buttons become DOM events:
 *
 *   A  (onActivate)        -> click
 *   X  (onSecondaryButton) -> keydown key "GamepadX"
 *   Y  (onOptionsButton)   -> keydown key "GamepadY"
 *   B  (onCancelButton)    -> keydown key "GamepadB"
 *   D-pad focus (onFocus)  -> focus
 *
 * Use the helpers in ./gamepad.ts rather than firing these by hand.
 * A, X and Y go to the innermost Focusable that handles them. B bubbles up
 * through Focusables until a handler calls stopPropagation(), like Steam's.
 */
import {
  ReactElement, ReactNode, act, cloneElement, forwardRef, KeyboardEvent, SyntheticEvent,
} from "react";
import { createRoot, Root } from "react-dom/client";
import { vi } from "vitest";

export const GAMEPAD_KEYS = { X: "GamepadX", Y: "GamepadY", B: "GamepadB" } as const;

/** What our handlers get in place of Steam's GamepadEvent. */
export type GamepadEvent = { stopPropagation: () => void; preventDefault: () => void; currentTarget: EventTarget };
type GamepadHandler = (e: GamepadEvent) => void;

const gamepadEvent = (e: SyntheticEvent): GamepadEvent => ({
  stopPropagation: () => e.stopPropagation(),
  preventDefault: () => e.preventDefault(),
  currentTarget: e.currentTarget,
});

/** Props Steam's components take that mean nothing to a plain DOM element. */
const STEAM_ONLY = new Set([
  "focusClassName", "focusWithinClassName", "noFocusRing", "preferredFocus", "flow-children",
  "focusableIfNoChildren", "autoFocus", "navEntryPreferPosition", "layout", "bAllowFullSize",
  "bDisableBackgroundDismiss", "bHideCloseIcon", "bDestructiveWarning", "focusOnMount", "bIsPassword",
  "onOKButton", "onMenuButton", "onGamepadDirection", "onGamepadFocus", "onGamepadBlur",
]);
function domProps(props: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(props)) {
    if (STEAM_ONLY.has(k) || k.endsWith("ActionDescription")) continue;
    out[k] = v;
  }
  return out;
}

type FocusableProps = {
  children?: ReactNode;
  onActivate?: (e: any) => void;
  onSecondaryButton?: GamepadHandler;
  onOptionsButton?: GamepadHandler;
  onCancelButton?: GamepadHandler;
  onKeyDown?: (e: KeyboardEvent) => void;
  [key: string]: any;
};

function onGamepadKey(p: FocusableProps) {
  return (e: KeyboardEvent<HTMLDivElement>) => {
    p.onKeyDown?.(e);
    const handlers: Record<string, GamepadHandler | undefined> = {
      [GAMEPAD_KEYS.X]: p.onSecondaryButton,
      [GAMEPAD_KEYS.Y]: p.onOptionsButton,
      [GAMEPAD_KEYS.B]: p.onCancelButton,
    };
    const handler = handlers[e.key];
    if (!handler) return;
    // A row's own X/Y is the only one Steam runs; B can bubble to a parent.
    if (e.key !== GAMEPAD_KEYS.B) e.stopPropagation();
    handler(gamepadEvent(e));
  };
}

export const Focusable = forwardRef<HTMLDivElement, FocusableProps>(function Focusable(props, ref) {
  const { children, onActivate, onSecondaryButton, onOptionsButton, onCancelButton, onKeyDown, ...rest } = props;
  void onSecondaryButton;
  void onOptionsButton;
  void onCancelButton;
  void onKeyDown;
  const onClick = onActivate ? (e: SyntheticEvent) => {
    e.stopPropagation();
    onActivate(e);
  } : undefined;
  return (
    <div ref={ref} data-focusable="" tabIndex={0} {...domProps(rest)} onClick={onClick} onKeyDown={onGamepadKey(props)}>
      {children}
    </div>
  );
});

export const DialogButton = forwardRef<HTMLButtonElement, Record<string, any>>(function DialogButton(props, ref) {
  const { children, onClick, ...rest } = props;
  return (
    <button ref={ref} type="button" {...domProps(rest)} onClick={(e) => {
      e.stopPropagation();
      onClick?.(e);
    }}>
      {children}
    </button>
  );
});

export const ButtonItem = (props: Record<string, any>) => {
  const { children, label, ...rest } = props;
  return <div>{label}<DialogButton {...rest}>{children}</DialogButton></div>;
};

type Option = { data: any; label: ReactNode };
type DropdownProps = {
  rgOptions: Option[]; selectedOption?: any; onChange?: (o: Option, i: number) => void;
  strDefaultLabel?: string; disabled?: boolean;
};

/** A <select>; each option's value is its index in rgOptions. */
export function Dropdown({ rgOptions, selectedOption, onChange, strDefaultLabel, disabled }: DropdownProps) {
  const selected = rgOptions.findIndex((o) => o.data === selectedOption);
  return (
    <select disabled={disabled} value={selected < 0 ? "" : String(selected)}
      onChange={(e) => {
        const i = Number(e.target.value);
        if (rgOptions[i]) onChange?.(rgOptions[i], i);
      }}>
      {selected < 0 && <option value="">{strDefaultLabel ?? ""}</option>}
      {rgOptions.map((o, i) => <option key={i} value={String(i)}>{o.label}</option>)}
    </select>
  );
}

export const DropdownItem = ({ label, ...rest }: DropdownProps & { label?: ReactNode }) => (
  <label>{label}<Dropdown {...rest} /></label>
);

export const TextField = forwardRef<HTMLInputElement, Record<string, any>>(function TextField(props, ref) {
  const { label, description, bIsPassword, ...rest } = props;
  return (
    <label>
      {label}
      <input ref={ref} type={bIsPassword ? "password" : "text"} {...domProps(rest)} />
      {description}
    </label>
  );
});

export const ToggleField = ({ label, checked, onChange, disabled }: {
  label?: ReactNode; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean;
}) => (
  <label>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
    {label}
  </label>
);

type Tab = { id: string; title: ReactNode; content: ReactNode };
/** Tab titles as role="tab" buttons, then the active tab's content. */
export function Tabs({ tabs, activeTab, onShowTab }: { tabs: Tab[]; activeTab: string; onShowTab: (id: string) => void }) {
  const active = tabs.find((t) => t.id === activeTab);
  return (
    <div>
      <div role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === activeTab}
            onClick={() => onShowTab(t.id)}>{t.title}</button>
        ))}
      </div>
      <div role="tabpanel">{active?.content}</div>
    </div>
  );
}

export const Spinner = () => <span data-spinner="" />;

export const ProgressBar = ({ nProgress, indeterminate }: { nProgress?: number; indeterminate?: boolean }) => (
  <div role="progressbar" aria-valuenow={indeterminate ? undefined : nProgress} />
);

export const PanelSection = ({ title, children }: { title?: ReactNode; children?: ReactNode }) => (
  <section>{title && <h3>{title}</h3>}{children}</section>
);
export const PanelSectionRow = ({ children }: { children?: ReactNode }) => <div>{children}</div>;

/** B inside a modal: onCancel if given, else close (like Steam's ModalRoot). */
export function ModalRoot({ children, closeModal, onCancel }: {
  children?: ReactNode; closeModal?: () => void; onCancel?: () => void;
}) {
  return (
    <div role="dialog" onKeyDown={(e) => {
      if (e.key !== GAMEPAD_KEYS.B) return;
      e.stopPropagation();
      (onCancel ?? closeModal)?.();
    }}>
      {children}
    </div>
  );
}

type ConfirmProps = {
  strTitle?: ReactNode; strDescription?: ReactNode; strOKButtonText?: ReactNode; strCancelButtonText?: ReactNode;
  bOKDisabled?: boolean; onOK?: () => void; onCancel?: () => void; closeModal?: () => void; children?: ReactNode;
};
/** Title, description, children, then OK and Cancel. Both buttons close the modal. */
export function ConfirmModal(p: ConfirmProps) {
  return (
    <ModalRoot closeModal={p.closeModal} onCancel={() => {
      p.onCancel?.();
      p.closeModal?.();
    }}>
      <h2>{p.strTitle}</h2>
      {p.strDescription && <div>{p.strDescription}</div>}
      {p.children}
      <button type="button" disabled={p.bOKDisabled} onClick={() => {
        p.onOK?.();
        p.closeModal?.();
      }}>{p.strOKButtonText ?? "OK"}</button>
      <button type="button" onClick={() => {
        p.onCancel?.();
        p.closeModal?.();
      }}>{p.strCancelButtonText ?? "Cancel"}</button>
    </ModalRoot>
  );
}

// ---------- showModal ----------

export type ShowModalResult = { Close: () => void; Update: (el: ReactElement) => void };
type OpenModal = { root: Root; host: HTMLElement; result: ShowModalResult };
const openModals: OpenModal[] = [];

/** act() when React expects it. Testing Library turns act off while a findBy/waitFor
 * polls, and renders flush on their own then. */
function maybeAct(fn: () => void) {
  if ((globalThis as any).IS_REACT_ACT_ENVIRONMENT) act(fn);
  else fn();
}

/** Renders the modal into its own container in document.body, with closeModal wired in. */
export function showModal(el: ReactElement, _parent?: unknown, options?: { fnOnClose?: () => void }): ShowModalResult {
  const host = document.createElement("div");
  host.setAttribute("data-modal", "");
  document.body.appendChild(host);
  const root = createRoot(host);
  let open = true;
  const Close = () => {
    if (!open) return;
    open = false;
    maybeAct(() => root.render(null));
    options?.fnOnClose?.();
  };
  const withClose = (e: ReactElement) => cloneElement(e as ReactElement<any>, { closeModal: Close });
  const Update = (e: ReactElement) => {
    if (open) maybeAct(() => root.render(withClose(e)));
  };
  maybeAct(() => root.render(withClose(el)));
  const result = { Close, Update };
  openModals.push({ root, host, result });
  return result;
}

/** How many modals showModal has open now. */
export const openModalCount = () => openModals.filter((m) => m.host.childElementCount > 0).length;

/** afterEach: close (running fnOnClose) and remove every modal. */
export function closeAllModals() {
  for (const m of openModals.splice(0)) {
    m.result.Close();
    maybeAct(() => m.root.unmount());
    m.host.remove();
  }
}

// ---------- the rest ----------

export const Navigation = {
  Navigate: vi.fn(),
  NavigateBack: vi.fn(),
  NavigateToExternalWeb: vi.fn(),
  CloseSideMenus: vi.fn(),
};

export const staticClasses = { Title: "title" } as Record<string, string>;
