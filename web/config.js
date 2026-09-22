// Site-level switches for forks and deployments.
// Promo links are off by default for this fork. Set
// globalThis.SUPPORT_FINS_SHOW_PROMO_LINKS = true before loading app.js, or edit
// this value in a deployment-specific copy, to show donation/advertising links.
export const SHOW_PROMO_LINKS = globalThis.SUPPORT_FINS_SHOW_PROMO_LINKS === true;
