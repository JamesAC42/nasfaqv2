// Market socket fan-out. Events that arrive within `bundleMs` go out together, as one
// { type: "market.bundle", events: [...] } message to sockets that said they understand bundles and
// one message per event to older clients. Sending is the cost that grows with sockets × events.
//
// Each event has a text for everyone and one for staff, which can carry fields behind a staff-only
// feature flag (features.audienceTexts). A socket marked `marketStaff` gets the staff texts, every
// other socket the everyone texts, so a staff-only field never reaches a player's socket.

function createMarketFanout({ clients, send, bundleMs = 100 }) {
  let pending = [];
  let timer = null;

  const bundleOf = (texts) => (texts.length === 1 ? texts[0] : `{"type":"market.bundle","events":[${texts.join(",")}]}`);

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    const events = pending;
    pending = [];
    const sockets = clients();
    if (!events.length || !sockets) return;
    const everyone = events.map((event) => event.text);
    const staff = events.some((event) => event.staffText !== event.text) ? events.map((event) => event.staffText) : everyone;
    const bundles = new Map([[everyone, bundleOf(everyone)]]);
    if (staff !== everyone) bundles.set(staff, bundleOf(staff));
    sockets.forEach((client) => {
      const texts = client.marketStaff ? staff : everyone;
      if (client.marketBundles) send(client, bundles.get(texts));
      else for (const text of texts) send(client, text);
    });
  }

  /** Queues one event: `text` for everyone, `staffText` (the same unless given) for staff sockets. */
  function queue(text, staffText = text) {
    pending.push({ text, staffText });
    if (!timer) timer = setTimeout(flush, bundleMs);
  }

  return { queue, flush };
}

module.exports = { createMarketFanout };
