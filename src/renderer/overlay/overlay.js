const frame = document.getElementById('frame');
let currentState = null;
let resolvedTimer = null;
let wasAlerting = false;

function applyState(state) {
  currentState = state;
  // While a resolved flash is in progress, don't clobber it - it'll restore
  // the current state when it ends.
  if (resolvedTimer) return;
  paint(state);
}

function paint(state) {
  const { status, color, pulse } = state || {};
  console.log('[overlay-renderer] paint:', { status, color, pulse, wasAlerting });
  if (status === 'alerting' && color) {
    document.documentElement.style.setProperty('--border-color', color);
    document.documentElement.style.setProperty('--border-width', '6px');
    if (pulse) {
      // Always force-restart the animation on every alerting paint.
      // Trusting `wasAlerting` led to a class of bugs where a missed
      // intermediate state (e.g. snoozed message dropped on the wire)
      // left wasAlerting=true, the if-branch skipped the reflow trick,
      // and the user saw a static border instead of a breathing pulse.
      frame.classList.remove('pulsing');
      void frame.offsetWidth; // force reflow so the animation restarts
      frame.classList.add('pulsing');
    } else {
      frame.classList.remove('pulsing');
    }
    wasAlerting = true;
  } else {
    document.documentElement.style.setProperty('--border-color', 'transparent');
    document.documentElement.style.setProperty('--border-width', '0px');
    frame.classList.remove('pulsing');
    wasAlerting = false;
  }
}

function flashGreen() {
  if (resolvedTimer) clearTimeout(resolvedTimer);
  document.documentElement.style.setProperty('--border-color', '#22c55e');
  document.documentElement.style.setProperty('--border-width', '8px');
  frame.classList.remove('pulsing');
  void frame.offsetWidth;
  frame.classList.add('pulsing');
  resolvedTimer = setTimeout(() => {
    resolvedTimer = null;
    paint(currentState);
  }, 15000);
}

window.overlayApi.onState((state) => applyState(state));
window.overlayApi.onResolved(() => flashGreen());
window.overlayApi.requestInitialState().then(applyState).catch(() => {});
