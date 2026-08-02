/**
 * Framework-free lifecycle adapter contract.
 *
 * The eventual native entry point passes the @capacitor/app `App` object to
 * installCapacitorLifecycleBridge. Keeping the adapter dependency-injected
 * lets the web build remain runnable before Capacitor is installed and gives
 * browser QA the same lifecycle semantics as native QA.
 */

export type GameLifecycleState = 'active' | 'background';

export type GameLifecycleSource = 'capacitor' | 'document';

export interface GameLifecycleEvent {
  state: GameLifecycleState;
  source: GameLifecycleSource;
  at: number;
}

export interface LifecycleSink {
  onLifecycle(event: GameLifecycleEvent): void;
}

export interface ListenerHandle {
  remove(): Promise<void>;
}

export interface CapacitorAppLike {
  addListener(
    eventName: 'appStateChange',
    listener: (state: { isActive: boolean }) => void,
  ): Promise<ListenerHandle>;
  addListener(eventName: 'pause' | 'resume', listener: () => void): Promise<ListenerHandle>;
}

/**
 * Install native and browser lifecycle notifications.
 *
 * The sink owns gameplay behavior. On `background` it must stop local input,
 * pause/slow rendering, and suspend or close transport without creating
 * gameplay commands. On `active` it must resume rendering/input, reconnect
 * with the stored identity, and request authoritative resync from the last
 * known server tick/world version.
 */
export async function installCapacitorLifecycleBridge(
  app: CapacitorAppLike,
  sink: LifecycleSink,
): Promise<() => Promise<void>> {
  let lastState: GameLifecycleState | undefined;

  const emit = (state: GameLifecycleState, source: GameLifecycleSource) => {
    if (state === lastState) return;
    lastState = state;
    sink.onLifecycle({ state, source, at: Date.now() });
  };

  const handles = await Promise.all([
    app.addListener('appStateChange', ({ isActive }) => {
      emit(isActive ? 'active' : 'background', 'capacitor');
    }),
    app.addListener('pause', () => emit('background', 'capacitor')),
    app.addListener('resume', () => emit('active', 'capacitor')),
  ]);

  const onVisibilityChange = () => {
    emit(document.visibilityState === 'visible' ? 'active' : 'background', 'document');
  };
  const onPageHide = () => emit('background', 'document');
  const onPageShow = () => emit('active', 'document');

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  return async () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    await Promise.all(handles.map((handle) => handle.remove()));
  };
}
