Core Idea
Simulate Stock Market activity in a way that people actually want to engage with it, using vtuber channel performance as the root driver.
1:1 stock market behavior is not required.

Main Goals (the vibe check)
Markets should be predictable enough that there is a “reasonably expected outcome”, but not so predictable that there can’t be surprises.
Players should have multiple outlets for liquid they accumulate.
Players should not be required to log in every day at a specific time in order to stay competitively relevant on leaderboards.
Players should be at regular risk of going into the red at all levels of play.

Adjustments & Valuation
At 4 intervals per day (Open, Lunch, Late, and Close), the market will adjust towards what is determined to be a “base rate” for that coin. The market opens at 9a ET, and the intervals are 6 hour increments (9a, 3p, 9p, 3p).
Market adjustments are determined by a “base rate” that is established internally at Market Open for the day, based on each channels’ metrics in scale to other channels’ metrics in the same bell curve scale (aka: channels that have coins, or “in network” channels). Coins’ baseline prices should NOT be affected by market prices, and should operate independently of the market.
The base rate is NOT updated at each interval. It is ONLY updated at Open.
At Open each day, before Opening adjustments, 4 randomly-generated positive integer values that total to 200, are assigned to each interval, to determine the strength of the adjustment at each interval.
For example, A coin’s market price at Open is $800. The internally-determined base price of the coin is $1200. Before adjusting, the system assigns the intervals as 50-100-20-30. At each interval, the system will adjust that interval’s assigned % towards the base rate. So, at Open, the system would adjust 50% of the difference between the base rate and the current market price, in this case, -$200, adjusting to $1000.
The random strength of each adjustment encourages people to check in multiple times a day if a particularly strong or weak adjustment occurs. Trade Presets can also be assigned to check for specific gaps (more on that later). Thresholds can also be set internally to prevent any single adjustment from accidentally hogging everything (such as requiring each adjustment to be at least 40%).
It is possible to have “overadjustments” with this system, where a value over 100% is generated, and the system adjusts beyond the base rate. Because of this, I would recommend against setting adjustment threshold minimums too high, or threshold maximums too low.
As a bookkeeping/code suggestion, I would suggest having each coin determine adjustments individually, with personal thresholds that can be edited en masse, rather than using a single coded set of variables/thresholds for the entire market. This will allow for more flexibility with the system later, in case thresholds need to be made stronger or weaker, or adjustments for certain categories of coin need to be tinkered with for whatever reason (such as an IPO).

Volume
A coin’s Maximum Shares In Circulation is updated regularly, scaling off of their current Subscriber Count, using a bell curve with internally-determined values for maximum shares in the market.
The intention is to update this weekly, but updating it monthly or even quarterly would also be fine. It should NOT update daily, as that would introduce too many moving parts with the next two bullet points.
If a coin’s shares are all owned by players, you will need to engage in the Options Market to get access to them.
When a coin reaches its maximum shares during a trading day, it locks out all purchases starting at the next adjustment interval. If a buyback (detailed below) would be triggered, the adjustment made at that interval will be the last one.
If a coin reduces its amount of shares, the market price is frozen (no buys can be made, and the coin will stop adjusting at each interval, only updating the base rate), and a buyback is announced, offering players to sell their existing shares at a moderate markup (120%, losing 10% every 4 Intervals that pass while buybacks are still active) from their current market value, until the next weekly evaluation. If there are still too many shares in circulation after the buyback period ends, the system forcibly buys back shares at the base rate, maintaining ownership % among players.
The Broker should always retain a small % buffer of shares for itself in order to help keep players from being reduced to 0 shares just because they own a smaller stake. These shares never go on the market, but still count for share % and are sold first when forced buybacks occur.
It is possible for the amount of a coin’s Maximum Shares to change when the buyback period is over, leaving a larger gap than originally anticipated, and rendering buybacks pointless. This is intentional, and considered an important market risk.
It is also possible for players to oversell shares during the buyback, returning the shares to below the maximum amount before the evaluation period ends. If this occurs, the buyback period is cancelled at the next Open, and shares will unfreeze and return to normal at that point. This is ALSO considered an important market risk.

Credits, Taxes, and Fees
Players start with a large amount of Credit when they make their account. A % of a player’s Credit is converted to Liquid every weekly evaluation.
The intent is that the player will start with a small % of conversion, such as 5% or even less, and need to buy specific licenses to increase the conversion rate. However, it should never be 100% of their Credit. I would suggest a cap of 50%.
When a player issues a Superchat, they gain Credit equal to the amount superchatted.
When a player sells a share, the player gains Credit equal to a small % of that coin’s tax value.
When a player buys a share, they must spend Credit to cover the taxes on that coin, equal to a % of that coin’s value. If they do not have enough credit, it comes out of their Liquid instead.
Dividends are awarded as Credits, not Liquid.
Credits can be used to pay other fees, in the place of Liquid. Licenses, however, require Liquid for purchase in most cases.
Most methods the player obtains money from are rendered as Credit, not Liquid.

Weekly Evaluation & Dividends
Each week (in the current system, 12a ET on Saturday), the system closes all Buybacks, issues Dividends, and adjusts Maximum Shares for each coin. Additionally, a portion of a player’s Credit is converted to Liquid.
Fees & Dividends are issued as a % of the coin’s value, on a bell curve ranking of metric shifts, compared to the previous evaluation’s findings. Coins near the mean shift from week to week offer little to no fees or dividends. Coins shifting below the mean charge fees to players to maintain their ownership of those shares. Coins shifting above the mean award dividends.
For example, if Suisei performed poorly at the previous evaluation, but performed well this week, she would be given a positive ranking, as the shift would be greater. As such, she would likely award dividends.
This does mean that inconsistent performers have very swingy dividends. This is meant to be offset by the weeks where there will be weak dividends or even fees to maintaining shares.
It is recommended that the % never exceed 10% in either direction.
Dividends are awarded as Credit. Share Fees are taken out of Credit first.


Onboarding
When a player starts the game, they begin with Credit equal to the total Base Rates of all coins, and with Liquid equal to a % of that amount.
Recommendation is 10%.
The point of this particular ratio is to give a large buffer of Credit to work with, while still keeping options limited for Liquid.
Licenses and Achievements are used to guide players, without overly engaging in front-facing tutorials.
Licenses are primarily meant to give the player goals to drive towards beyond “owning a lot of the oshicoin”. Rather than big jumps in player capability, Licenses should be spread out and offer incremental but tangible upgrades, such as a small increase to Weekly Credit Conversion Rate, or the ability to invest in a specific Index.
Achievements are milestones meant to provide regular early injections of liquid and credit, to help the player’s first week or two with the game. Later achievements should instead award cosmetics, such as hats and icons.
Contract Market
With a License, Players can create Contracts that allow them to temporarily trade using other users’ shares.
Each Contract consists of:
The shares to be traded
The Premium to be paid to the underwriter of the Contract, which has a minimum flat value. This is always paid, regardless of whether the contract executes or not.
The execution window for the contract (X Intervals or X Hours/Days/ect)
Recommendation is less than 72 hours. However, you can use Licenses to set up a short limit (12 hours, for example) and increase it with gradual License upgrades (to, say, a week). It is recommended that a Contract not last for more than a week.
The condition(s) of execution (coin reaches a certain price, for example)
A Contract is added to a player’s Auto-Trader as long as it is in their inventory, and will automatically execute if the condition is met within the execution window.
When the Contract is executed, the shares sold are taken from the underwriter’s inventory. If they do not have enough shares at that time, the contract is cancelled and the underwriter refunds the Premium that was paid to them, along with forfeiting an additional fee equal to 50% of the Premium (this fee goes to the void, not the player with the Contract).
It is possible to trade shares between players using Contracts. However, it will always be cheaper to buy the shares direct if you can, making this primarily a tool for hoarding or trading in coins that are at or near their maximum shares.
It is also possible to “Buy Out” of a Contract, paying an increased Premium to completely nullify the Contract before it executes.

Bond Market
Each week, players can purchase a singular Bond Contract. A Bond Contract allows the player to guarantee that the sale of shares in the listed coin will not give them a lower rate than their Mean Purchase Price in that coin or the coin’s Average Base Rate at the last Weekly Evaluation (whichever is higher).
A player can purchase only one of these contracts a week from the Broker, but they may trade Bond Contracts in the Auction House.
Bond Contracts are tied to specific coins, but do not have locked value. Their value is based on the player’s MPP and the Average of the previous week’s Base Rates for that coin.
This is primarily meant as a way for smart players to insulate against market crashes.

Side Content
Each side content is locked behind a cheap license. Players should reasonably expect to start with access to at least one side mode when they create a new account.
Gacha - Spend Credit to roll the dice and try to get items for cosmetics. Can also award Credits.
Auction House - Put up Items for sale to the highest bidder. Items are bought and sold with Credit. Existing Contracts can also be traded here, but only if you’re not the original issuer.
Gambling - Can bet on Hololive and /vt/ based events using Credit.
Arcade - Spend Credit to play event-specific minigames here (such as the chocolate clicker). Can be left out if there’s no intention to expand minigames.
Superchats - Compete with others to make your oshi the most superchatted, using Liquid to improve their standing. Rankings reset every month. Those that contributed to the top 3 most superchatted coins get little cosmetic trophies they can show off.

Market Gambits (Auto-Trader)
Players can purchase Licences to obtain Gambit Slots, which allow you to give a set of instructions to the broker.
These instructions consist of
What coin or index to buy/sell.
What condition(s) to buy/sell. (“When under $200 per share”, “When I have less than 30% of shares”, ect.)
What condition(s) to stop, if any. (“When my Liquid is less than $1,000,000”, “When the coin is 49% of my wallet.”, “until next adjustment”, ect.)
These instructions will be executed until the player stops them or they meet the conditions to halt.
Gambits are reset at each Weekly Evaluation, unless a “Long Term Gambit” License is purchased.
The intent with this system is to prevent auto-traders from dominating the market excessively. Players should never be able to buy enough slots to cover the entire market without working with Indexes. The suggested cap on Gambit Slots is 40.
Additionally, Long Term Gambit Slots should be exclusively for the player’s favored Index/Coins, as these won’t turn off. Therefore, the suggested cap on Long Term Gambit Slots is 5.
The auto-trader also handles any Contracts that you have, which do not count against your Gambit Slots.

Normal Live Trading
Every execution tick, players may issue Live Orders totaling up to 180 shares. Each Order represents a single transaction, Buy or Sell, in an Index or a Coin. All Orders are executed on the next Tick of 10 minutes after being issued, but are not shown until the next Interval.
Public Update timeframes may need to be adjusted. One Update per 6 hours may be excessive. Perhaps One per Hour instead? Not sure.
The Live Order limit shouldn’t be increased, as it represents the old form of Manual Trading, hitting buttons (or abusing API calls) on cooldown. This allows players to not have to sit in front of the trade menu all day to get ahead, or worse, code API bots that will potentially break the site. At any time during the interval, players can issue their orders.
Live Orders shouldn’t interfere with Market Gambits or the auto trader in general.
