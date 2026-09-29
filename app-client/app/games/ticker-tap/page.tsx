import { TickerTapPage } from "@/app/components/games/ticker-tap/ticker-tap-page";
import { TickerTapPaused } from "@/app/components/games/ticker-tap/paused";
import { TICKER_TAP_ENABLED } from "@/app/lib/games/flags";

export default function Page() {
  return TICKER_TAP_ENABLED ? <TickerTapPage /> : <TickerTapPaused />;
}
