/**
 * Games that are built but held back. Ticker Tap stays off until runs can't be scripted: the
 * client needs the targets to draw them, so a script reading the page can play a perfect run and
 * take the weekly pool. The API refuses new runs too (catalog status "disabled").
 */
export const TICKER_TAP_ENABLED = false;
